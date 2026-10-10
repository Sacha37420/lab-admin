import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap, tap } from 'rxjs';
import { EngineService } from '../../core/engine.service';
import { KeycloakService } from '../../core/keycloak.service';
import {
  APP_NAME_RE, DevSummary, EngineError, Group, InitStep, Job, Me, NameCheck, Profile, Project, ProjectType,
  profileOf, stateLabel, toEngineError, verdictLabel,
} from '../../core/engine.client';
import { JobSuiviComponent } from '../../shared/job-suivi/job-suivi.component';

/**
 * Accueil des développeurs : « Mes projets » (contrat multi-dev I6 v6).
 * Tout vient du moteur (`/mcp/api`, `core/engine.client.ts`) — lab-admin n'a
 * aucun privilège propre. Selon le profil rendu par `GET /me` :
 *
 *  - superuser  : tous les projets, choix d'un dev (`?as=`) ;
 *  - dev        : initialisation à la première connexion, étape GitHub, ses projets ;
 *  - admin_only : RIEN ici (l'accueil d'administration est rendu par le parent) ;
 *  - none       : un message qui dit pourquoi.
 */
@Component({
  selector: 'app-mes-projets',
  standalone: true,
  imports: [FormsModule, RouterLink, JobSuiviComponent],
  templateUrl: './mes-projets.component.html',
})
export class MesProjetsComponent implements OnInit {
  private engine = inject(EngineService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  protected kc = inject(KeycloakService);

  readonly stateLabel = stateLabel;
  readonly verdictLabel = verdictLabel;

  loading = signal(true);
  /** Erreur bloquante (moteur injoignable…). */
  fatal = signal<EngineError | null>(null);
  /** Le compte connecté. */
  self = signal<Me | null>(null);
  profile = signal<Profile | null>(null);
  /** Le compte affiché : `self`, ou le dev choisi par le superutilisateur. */
  shown = signal<Me | null>(null);
  viewError = signal('');

  initRunning = signal(false);
  initSteps = signal<InitStep[]>([]);
  initError = signal<EngineError | null>(null);
  recheckingGithub = signal(false);

  projects = signal<Project[]>([]);
  projectsLoading = signal(false);
  projectsError = signal('');
  devs = signal<DevSummary[]>([]);

  /** `?as=` actif : lecture seule, pas de création au nom d'un autre. */
  viewingOther = computed(() => !!this.shown()?.viewed_as && this.shown()?.viewed_as !== this.self()?.uid);
  githubStep = computed(() => this.shown()?.remaining.find(s => s.step === 'link_github') ?? null);
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
    if (!me.initialized) { this.init(); return; }
    this.ready();
  }

  /** Première connexion : tout ce qui ne demande pas le dev, fait par le moteur. */
  init(): void {
    if (this.initRunning()) return;
    this.initRunning.set(true);
    this.initError.set(null);
    this.engine.meInit().subscribe({
      next: me => {
        this.initRunning.set(false);
        this.initSteps.set(me.steps ?? []);
        this.self.set(me);
        this.shown.set(me);
        this.profile.set(profileOf(me, this.kc.isAdmin));
        if (me.initialized) this.ready();
      },
      error: err => { this.initRunning.set(false); this.initError.set(toEngineError(err)); },
    });
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

  loadProjects(asUid: string | null = this.viewingOther() ? this.shown()?.viewed_as ?? null : null): void {
    this.projectsLoading.set(true);
    this.projectsError.set('');
    this.engine.projects(asUid).subscribe({
      next: r => { this.projects.set(r.projects ?? []); this.projectsLoading.set(false); },
      error: err => { this.projects.set([]); this.projectsError.set(toEngineError(err).detail); this.projectsLoading.set(false); },
    });
  }

  selectDev(uid: string): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { as: uid && uid !== this.self()?.uid ? uid : null },
      queryParamsHandling: 'merge',
    });
  }

  /** Après le passage dans oauth-hub : relire l'état de la liaison. */
  recheckGithub(): void {
    this.recheckingGithub.set(true);
    this.engine.me().subscribe({
      next: me => { this.self.set(me); if (!this.viewingOther()) this.shown.set(me); this.recheckingGithub.set(false); },
      error: () => this.recheckingGithub.set(false),
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

  get canCreate(): boolean {
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

  stateClass(p: Project): string {
    return p.state === 'running' ? 'pj-ok' : p.state === 'partial' || p.state === 'unknown' ? 'pj-warn'
      : p.state === 'stopped' ? 'pj-ko' : '';
  }
}
