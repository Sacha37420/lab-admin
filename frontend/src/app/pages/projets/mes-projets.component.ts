import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap, tap } from 'rxjs';
import { EngineService } from '../../core/engine.service';
import { KeycloakService } from '../../core/keycloak.service';
import {
  APP_NAME_RE, DevSummary, EngineError, Group, Job, Me, NameCheck, Profile, Project, ProjectType,
  githubGapLabel, isWorkspaceUrl, projectSections,
  profileOf, stateLabel, toEngineError,
} from '../../core/engine.client';
import { JobSuiviComponent } from '../../shared/job-suivi/job-suivi.component';
import { preopenTab, sendTab } from '../../core/tool-tab';
import { DATE_FORMAT, shortSha } from '../../core/format';
import { DashboardComponent } from '../dashboard/dashboard.component';

/**
 * Page « Projets » (`/projets`, contrat multi-dev I6 v8) : une ligne par projet
 * — état, version en service, écart avec GitHub, lien vers l'app, VS Code,
 * détail — et « Nouveau projet ». Tout vient du moteur (`core/engine.client.ts`).
 *
 *  - superuser  : tous les projets du lab avec leur propriétaire, `?as=<uid>` ;
 *  - dev        : ses projets ;
 *  - admin_only / none : un message, aucune liste (ils n'ont pas de projets).
 *
 * La première connexion (`me/init`) se joue sur l'accueil, pas ici.
 *
 * v10 : la liste est en deux sections d'après `kind`, et la page porte en bas,
 * POUR LES ADMINS SEULEMENT, le bloc de conception de l'ancienne `/conception`.
 */
@Component({
  selector: 'app-mes-projets',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, JobSuiviComponent, DashboardComponent],
  templateUrl: './mes-projets.component.html',
})
export class MesProjetsComponent implements OnInit {
  private engine = inject(EngineService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  protected kc = inject(KeycloakService);

  readonly stateLabel = stateLabel;
  readonly dateFormat = DATE_FORMAT;
  readonly shortSha = shortSha;

  loading = signal(true);
  /** Erreur bloquante (moteur injoignable…). */
  fatal = signal<EngineError | null>(null);
  /** Le compte connecté. */
  self = signal<Me | null>(null);
  profile = signal<Profile | null>(null);
  /** Le compte affiché : `self`, ou le dev choisi par le superutilisateur. */
  shown = signal<Me | null>(null);
  viewError = signal('');

  projects = signal<Project[]>([]);
  projectsLoading = signal(false);
  refreshing = signal(false);
  private refreshTimer?: ReturnType<typeof setTimeout>;
  projectsError = signal('');
  devs = signal<DevSummary[]>([]);

  /** `?as=` actif : lecture seule, pas de création au nom d'un autre. */
  viewingOther = computed(() => !!this.shown()?.viewed_as && this.shown()?.viewed_as !== this.self()?.uid);
  /** Le superutilisateur sans `?as=` voit les projets de tout le lab. */
  showOwner = computed(() => !!this.self()?.is_superuser && !this.viewingOther());

  // ── Nouveau projet ─────────────────────────────────────────────────────────
  formOpen = signal(false);
  groups = signal<Group[]>([]);
  groupsError = signal('');
  newName = '';
  newType: ProjectType = 'django-angular';
  newVisibility: 'private' | 'public' = 'private';
  selectedGroups = signal<string[]>([]);
  nameCheck = signal<NameCheck | null>(null);
  nameChecking = signal(false);
  creating = signal(false);
  createError = signal<EngineError | null>(null);
  createJobId = signal('');
  createdApp = signal('');
  private nameInput = new Subject<string>();

  ngOnInit(): void {
    this.nameInput.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      tap(() => { this.nameCheck.set(null); this.nameChecking.set(true); }),
      switchMap(name => name
        ? this.engine.checkName(name).pipe(catchError(err => of<NameCheck>({ ok: false, reasons: [toEngineError(err).detail] })))
        : of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(check => { this.nameCheck.set(check); this.nameChecking.set(false); });

    this.engine.me().subscribe({
      next: me => this.onSelf(me),
      error: err => { this.fatal.set(toEngineError(err)); this.loading.set(false); },
    });
  }

  private onSelf(me: Me): void {
    this.self.set(me);
    this.shown.set(me);
    const profile = profileOf(me, this.kc.isAdmin);
    this.profile.set(profile);
    this.loading.set(false);
    if (profile === 'admin_only' || profile === 'none') return;
    // Pas encore initialisé : l'accueil s'en charge (et le dit).
    if (!me.initialized) return;
    this.ready();
  }

  private ready(): void {
    if (this.self()?.is_superuser) {
      this.engine.devs().subscribe({ next: r => this.devs.set(r.devs ?? []), error: () => this.devs.set([]) });
    }
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => this.show(params.get('as')));
  }

  private show(asUid: string | null): void {
    const me = this.self();
    if (!me) return;
    this.viewError.set('');
    if (!asUid || asUid === me.uid || !me.is_superuser) {
      this.shown.set(me);
      this.loadProjects(null);
      return;
    }
    this.formOpen.set(false);
    this.engine.me(asUid).subscribe({
      next: other => { this.shown.set(other); this.loadProjects(asUid); },
      error: err => {
        this.viewError.set(`Impossible d'afficher « ${asUid} » : ${toEngineError(err).detail}`);
        this.shown.set(me);
        this.loadProjects(null);
      },
    });
  }

  private currentAs(): string | null {
    return this.viewingOther() ? this.shown()?.viewed_as ?? null : null;
  }

  /** `refresh` : demande au lab de relire GitHub ; la liste rendue est celle qu'il connaît déjà. */
  loadProjects(asUid: string | null = this.currentAs(), refresh = false): void {
    this.projectsLoading.set(!refresh);
    this.refreshing.set(refresh);
    this.projectsError.set('');
    this.engine.projects(asUid, refresh).subscribe({
      next: r => { this.projects.set(r.projects ?? []); this.projectsLoading.set(false); this.refreshing.set(false); },
      error: err => {
        if (!refresh) this.projects.set([]);
        this.projectsError.set(toEngineError(err).detail);
        this.projectsLoading.set(false); this.refreshing.set(false);
      },
    });
  }

  /** Relit GitHub, puis relit la liste quelques secondes après (le lab rafraîchit en arrière-plan). */
  refresh(): void {
    if (this.refreshing()) return;
    this.loadProjects(this.currentAs(), true);
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.loadProjects(this.currentAs(), false), 4000);
  }

  // ── Affichage d'une ligne ──────────────────────────────────────────────────

  readonly gap = githubGapLabel;

  /** Filtre de confort : utile au superutilisateur, qui a une vingtaine de lignes. */
  filter = signal('');
  visible = computed(() => {
    const q = this.filter().trim().toLowerCase();
    const list = this.projects();
    return q ? list.filter(p => p.name.toLowerCase().includes(q) || p.owner.toLowerCase().includes(q)) : list;
  });
  /** « Applications déployées » / « Outils du lab », ou une seule liste si le moteur ne dit pas la nature. */
  sections = computed(() => projectSections(this.visible()));

  // ── VS Code depuis la liste ────────────────────────────────────────────────

  wsBusy = signal('');
  wsError = signal<{ app: string; error: EngineError } | null>(null);
  wsNotice = signal<{ app: string; text: string } | null>(null);

  /** Même ouverture sécurisée que sur la page du projet (voir core/tool-tab.ts). */
  openWorkspace(p: Project): void {
    if (this.wsBusy()) return;
    this.wsBusy.set(p.name);
    this.wsError.set(null);
    this.wsNotice.set(null);
    const tab = preopenTab("Ouverture de l'éditeur… (jusqu'à 30 secondes)");
    this.engine.workspaceOpen(p.name).subscribe({
      next: opened => {
        this.wsBusy.set('');
        if (!isWorkspaceUrl(opened.url, window.location.origin)) {
          tab?.close();
          this.wsNotice.set({ app: p.name, text: "Adresse d'éditeur inattendue : elle n'a pas été ouverte." });
          return;
        }
        this.projects.update(list => list.map(x => ({ ...x, workspace: { open: x.name === p.name && x.owner === p.owner } })));
        if (!sendTab(tab, opened.url)) {
          this.wsNotice.set({ app: p.name, text: 'Le navigateur a bloqué le nouvel onglet : autorisez les fenêtres surgissantes pour ce site, puis recommencez.' });
        }
      },
      error: err => { this.wsBusy.set(''); tab?.close(); this.wsError.set({ app: p.name, error: toEngineError(err) }); },
    });
  }

  /** Messages en clair pour les refus attendus ; sinon la phrase du lab. */
  wsMessage(e: EngineError): string {
    switch (e.code) {
      case 'github_not_linked': return "Reliez d'abord votre compte GitHub : l'éditeur en a besoin pour pousser votre code.";
      case 'workspace_limit':
        return `Trop d'éditeurs sont ouverts sur le lab en ce moment${e.max !== null ? ` (${e.open}/${e.max})` : ''}. Ils se ferment seuls après 30 minutes sans activité : réessayez un peu plus tard.`;
      default: return e.detail;
    }
  }

  selectDev(uid: string): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { as: uid && uid !== this.self()?.uid ? uid : null },
      queryParamsHandling: 'merge',
    });
  }

  // ── Nouveau projet ─────────────────────────────────────────────────────────

  openForm(): void {
    this.formOpen.set(true);
    this.createError.set(null);
    if (this.groups().length) return;
    this.engine.groups().subscribe({
      next: r => this.groups.set(r.groups ?? []),
      error: err => this.groupsError.set(toEngineError(err).detail),
    });
  }

  onName(value: string): void {
    this.newName = value.trim().toLowerCase();
    this.nameInput.next(this.newName);
  }

  /** Forme du nom : confort de saisie seulement — `check-name` fait foi. */
  get nameShapeOk(): boolean { return APP_NAME_RE.test(this.newName) && !this.newName.includes('--'); }

  toggleGroup(name: string, checked: boolean): void {
    this.selectedGroups.update(list => checked ? [...new Set([...list, name])] : list.filter(g => g !== name));
  }

  /** Où relier GitHub : le lien du lab pour ce compte, sinon l'accueil d'OAuth Hub. */
  githubUrl = computed(() => {
    const me = this.self();
    return me?.remaining.find(s => s.step === 'link_github')?.url ?? me?.github?.connect_url ?? me?.oauth_hub_url ?? this.engine.oauthHubUrl;
  });
  recheckingGithub = signal(false);

  /** Après le passage dans OAuth Hub : relire l'état de la liaison. */
  recheckGithub(): void {
    this.recheckingGithub.set(true);
    this.engine.me().subscribe({
      next: me => { this.self.set(me); if (!this.viewingOther()) this.shown.set(me); this.recheckingGithub.set(false); },
      error: () => this.recheckingGithub.set(false),
    });
  }

  get canCreate(): boolean {
    // Sans GitHub relié, le formulaire n'est pas rendu ; la garde reste ici pour le clavier.
    if (this.self()?.github_linked === false) return false;
    return !this.creating() && !this.createJobId() && !!this.nameCheck()?.ok && !this.nameChecking()
      && this.selectedGroups().length > 0;
  }

  create(): void {
    if (!this.canCreate) return;
    this.creating.set(true);
    this.createError.set(null);
    this.createdApp.set('');
    this.engine.createProject({
      name: this.newName, type: this.newType, visibility: this.newVisibility,
      required_groups: this.selectedGroups(),
    }).subscribe({
      next: ticket => { this.creating.set(false); this.createJobId.set(ticket.job_id); },
      error: err => {
        const e = toEngineError(err);
        this.creating.set(false);
        this.createError.set(e);
        // Un job tourne déjà pour ce nom : on le suit plutôt que d'en rester à l'erreur.
        if (e.code === 'job_exists' && e.jobId) this.createJobId.set(e.jobId);
      },
    });
  }

  onCreateDone(job: Job | null): void {
    this.loadProjects();
    if (job?.result?.ok) {
      this.createdApp.set(job.result.app ?? job.app);
      this.newName = '';
      this.nameCheck.set(null);
    }
  }

  resetCreate(): void {
    this.createJobId.set('');
    this.createdApp.set('');
    this.createError.set(null);
  }

  toneClass(tone: string): string { return tone ? `pj-${tone}` : ''; }

  stateClass(p: Project): string {
    return p.state === 'running' ? 'pj-ok' : p.state === 'partial' || p.state === 'unknown' ? 'pj-warn'
      : p.state === 'stopped' ? 'pj-ko' : '';
  }
}
