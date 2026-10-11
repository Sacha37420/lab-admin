import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EngineService } from '../../core/engine.service';
import {
  Commits, ENV_KEY_RE, EngineError, EnvVar, Job, Logs, Me, ProjectDetail, SqlCell, SqlResult,
  Ticket, WorkspaceOpened, isWorkspaceUrl, repoPage, stateLabel, toEngineError, verdictLabel,
} from '../../core/engine.client';
import { preopenTab, sendTab } from '../../core/tool-tab';
import { JobSuiviComponent } from '../../shared/job-suivi/job-suivi.component';
import { MaBaseComponent } from '../../shared/ma-base/ma-base.component';
import { EmailProjetComponent } from '../../shared/email/email-projet.component';

/**
 * Page d'un projet (`/projets/<app>`, contrat multi-dev I6 v6) : tout ce qu'un
 * développeur fait sur son app SANS IA — déployer, lire les journaux, régler
 * les variables, lancer les tests, ouvrir un ticket, ouvrir l'éditeur, interroger
 * sa base. Chaque action est un appel au moteur ; c'est lui qui vérifie que le
 * projet appartient à l'appelant (sinon `404`, indistinct d'un projet inconnu).
 */
@Component({
  selector: 'app-projet',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, JobSuiviComponent, MaBaseComponent, EmailProjetComponent],
  templateUrl: './projet.component.html',
})
export class ProjetComponent implements OnInit {
  protected engine = inject(EngineService);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  readonly stateLabel = stateLabel;
  readonly verdictLabel = verdictLabel;
  readonly repoPage = repoPage;

  app = '';
  project = signal<ProjectDetail | null>(null);
  loading = signal(true);
  fatal = signal<EngineError | null>(null);
  /** Le compte connecté : « Ma base » n'agit que si le projet est le sien. */
  me = signal<Me | null>(null);

  // Déploiement
  commits = signal<Commits | null>(null);
  commitsLoading = signal(false);
  commitsError = signal<EngineError | null>(null);
  chosenSha = '';
  deployJobId = signal('');
  deployError = signal<EngineError | null>(null);
  launching = signal(false);

  // Tests
  testsJobId = signal('');
  testsError = signal<EngineError | null>(null);

  // Journaux
  logService = '';
  logTail = 200;
  logs = signal<Logs | null>(null);
  logsLoading = signal(false);
  logsError = signal('');

  // Variables
  env = signal<EnvVar[]>([]);
  envLoaded = signal(false);
  envError = signal('');
  envNotice = signal('');
  envKey = '';
  envValue = '';
  envBusy = signal(false);

  // SQL
  query = '';
  sqlRunning = signal(false);
  sqlResult = signal<SqlResult | null>(null);
  sqlError = signal<EngineError | null>(null);

  // Ticket
  ticketTitle = '';
  ticketBody = '';
  ticketScope: 'app' | 'lab' = 'app';
  ticketBusy = signal(false);
  ticket = signal<Ticket | null>(null);
  ticketError = signal<EngineError | null>(null);

  // Déploiement automatique
  autoBusy = signal(false);
  autoError = signal<EngineError | null>(null);

  // Espace de travail
  wsBusy = signal(false);
  wsOpened = signal<WorkspaceOpened | null>(null);
  wsError = signal<EngineError | null>(null);
  wsNotice = signal('');

  ngOnInit(): void {
    this.engine.me().subscribe({ next: me => this.me.set(me), error: () => this.me.set(null) });
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.app = params.get('app') ?? '';
      this.reset();
      this.reload(true);
    });
  }

  private reset(): void {
    this.project.set(null); this.fatal.set(null); this.loading.set(true);
    this.commits.set(null); this.commitsError.set(null); this.chosenSha = '';
    this.deployJobId.set(''); this.deployError.set(null);
    this.testsJobId.set(''); this.testsError.set(null);
    this.logs.set(null); this.logsError.set(''); this.logService = '';
    this.env.set([]); this.envLoaded.set(false); this.envError.set(''); this.envNotice.set('');
    this.sqlResult.set(null); this.sqlError.set(null);
    this.ticket.set(null); this.ticketError.set(null);
    this.wsOpened.set(null); this.wsError.set(null); this.wsNotice.set('');
  }

  /** Relit l'état réel du projet (seule source fiable, cf. API.md §4). */
  reload(first = false): void {
    this.engine.project(this.app).subscribe({
      next: p => { this.project.set(p); this.loading.set(false); },
      error: err => {
        // Un rafraîchissement raté ne doit pas faire disparaître la page.
        if (first || !this.project()) this.fatal.set(toEngineError(err));
        this.loading.set(false);
      },
    });
  }

  stateClass(state: string): string {
    return state === 'running' ? 'pj-ok' : state === 'partial' || state === 'unknown' ? 'pj-warn'
      : state === 'stopped' ? 'pj-ko' : '';
  }

  // ── Déploiement ────────────────────────────────────────────────────────────

  loadCommits(): void {
    this.commitsLoading.set(true);
    this.commitsError.set(null);
    this.engine.commits(this.app).subscribe({
      next: c => { this.commits.set(c); this.commitsLoading.set(false); },
      error: err => { this.commitsError.set(toEngineError(err)); this.commitsLoading.set(false); },
    });
  }

  deploy(): void {
    if (this.launching() || this.deployJobId()) return;
    this.launching.set(true);
    this.deployError.set(null);
    this.engine.deploy(this.app, this.chosenSha || null).subscribe({
      next: ticket => { this.launching.set(false); this.deployJobId.set(ticket.job_id); },
      error: err => this.onJobRefused(toEngineError(err), 'deploy'),
    });
  }

  /** `job_exists` : un job tourne déjà pour ce projet — on le suit, quel qu'il soit. */
  private onJobRefused(e: EngineError, wanted: 'deploy' | 'tests'): void {
    this.launching.set(false);
    (wanted === 'deploy' ? this.deployError : this.testsError).set(e);
    if (e.code === 'job_exists' && e.jobId) {
      (wanted === 'deploy' ? this.deployJobId : this.testsJobId).set(e.jobId);
    }
  }

  onDeployDone(_job: Job | null): void {
    this.reload();
    if (this.commits()) this.loadCommits();
  }

  // ── Tests ──────────────────────────────────────────────────────────────────

  runTests(): void {
    if (this.testsJobId()) return;
    this.testsError.set(null);
    this.engine.runTests(this.app).subscribe({
      next: ticket => this.testsJobId.set(ticket.job_id),
      error: err => this.onJobRefused(toEngineError(err), 'tests'),
    });
  }

  // ── Journaux ───────────────────────────────────────────────────────────────

  loadLogs(): void {
    this.logsLoading.set(true);
    this.logsError.set('');
    this.engine.logs(this.app, this.logService || null, Number(this.logTail)).subscribe({
      next: l => { this.logs.set(l); this.logsLoading.set(false); },
      error: err => { this.logs.set(null); this.logsError.set(toEngineError(err).detail); this.logsLoading.set(false); },
    });
  }

  // ── Variables d'environnement ──────────────────────────────────────────────

  loadEnv(): void {
    this.envError.set('');
    this.engine.envList(this.app).subscribe({
      next: r => { this.env.set(r.variables ?? []); this.envLoaded.set(true); },
      error: err => this.envError.set(toEngineError(err).detail),
    });
  }

  get envKeyOk(): boolean { return ENV_KEY_RE.test(this.envKey); }

  editVar(v: EnvVar): void {
    if (v.managed) return;
    this.envKey = v.key;
    this.envValue = v.value ?? '';
  }

  saveVar(): void {
    if (!this.envKeyOk || this.envBusy()) return;
    this.envBusy.set(true);
    this.envError.set(''); this.envNotice.set('');
    const key = this.envKey;
    this.engine.envSet(this.app, key, this.envValue).subscribe({
      next: () => {
        this.envBusy.set(false);
        this.envNotice.set(`${key} enregistrée — prise en compte au prochain déploiement.`);
        this.envKey = ''; this.envValue = '';
        this.loadEnv();
      },
      error: err => { this.envBusy.set(false); this.envError.set(toEngineError(err).detail); },
    });
  }

  removeVar(v: EnvVar): void {
    if (v.managed || this.envBusy()) return;
    if (!window.confirm(`Supprimer la variable ${v.key} ?`)) return;
    this.envBusy.set(true);
    this.envError.set(''); this.envNotice.set('');
    this.engine.envUnset(this.app, v.key).subscribe({
      next: () => {
        this.envBusy.set(false);
        this.envNotice.set(`${v.key} supprimée — prise en compte au prochain déploiement.`);
        this.loadEnv();
      },
      error: err => { this.envBusy.set(false); this.envError.set(toEngineError(err).detail); },
    });
  }

  // ── Console SQL ────────────────────────────────────────────────────────────

  runSql(): void {
    if (this.sqlRunning() || !this.query.trim()) return;
    this.sqlRunning.set(true);
    this.sqlError.set(null);
    this.engine.sql(this.app, this.query).subscribe({
      next: r => { this.sqlResult.set(r); this.sqlRunning.set(false); },
      error: err => { this.sqlResult.set(null); this.sqlError.set(toEngineError(err)); this.sqlRunning.set(false); },
    });
  }

  cell(value: SqlCell): string {
    if (value === null) return 'NULL';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  // ── Ticket ─────────────────────────────────────────────────────────────────

  sendTicket(): void {
    if (this.ticketBusy() || !this.ticketTitle.trim()) return;
    this.ticketBusy.set(true);
    this.ticketError.set(null);
    this.ticket.set(null);
    this.engine.openTicket(this.app, { title: this.ticketTitle.trim(), body: this.ticketBody, scope: this.ticketScope }).subscribe({
      next: t => { this.ticket.set(t); this.ticketBusy.set(false); this.ticketTitle = ''; this.ticketBody = ''; },
      error: err => { this.ticketError.set(toEngineError(err)); this.ticketBusy.set(false); },
    });
  }

  // ── Déploiement automatique ────────────────────────────────────────────────

  setAutoDeploy(enabled: boolean): void {
    if (this.autoBusy()) return;
    this.autoBusy.set(true);
    this.autoError.set(null);
    this.engine.setAutoDeploy(this.app, enabled).subscribe({
      next: r => {
        this.autoBusy.set(false);
        this.project.update(p => p ? { ...p, auto_deploy: { enabled: r.enabled, available: r.available } } : p);
      },
      error: err => { this.autoBusy.set(false); this.autoError.set(toEngineError(err)); this.reload(); },
    });
  }

  // ── Espace de travail (VS Code) ────────────────────────────────────────────

  /**
   * L'onglet est ouvert TOUT DE SUITE, dans le geste du clic (sinon le
   * navigateur le bloque : la réponse du moteur peut prendre ~30 s), puis
   * dirigé vers l'URL à ticket dès qu'elle arrive. Le ticket est à usage
   * unique et ne vit que 60 s : l'URL n'est ni gardée ni réaffichée.
   */
  openWorkspace(): void {
    if (this.wsBusy()) return;
    this.wsBusy.set(true);
    this.wsError.set(null);
    this.wsNotice.set('');
    const tab = preopenTab('Ouverture de l\'éditeur…');
    this.engine.workspaceOpen(this.app).subscribe({
      next: opened => {
        this.wsBusy.set(false);
        if (!isWorkspaceUrl(opened.url, window.location.origin)) {
          tab?.close();
          this.wsNotice.set("Le moteur a rendu une adresse d'éditeur inattendue : elle n'a pas été ouverte.");
          return;
        }
        this.wsOpened.set(opened);
        this.project.update(p => p ? { ...p, workspace: { open: true } } : p);
        if (!sendTab(tab, opened.url)) {
          this.wsNotice.set('Le navigateur a bloqué le nouvel onglet : autorisez les fenêtres surgissantes pour ce site, puis cliquez de nouveau.');
        }
      },
      error: err => {
        this.wsBusy.set(false);
        tab?.close();
        this.wsError.set(toEngineError(err));
      },
    });
  }

  closeWorkspace(): void {
    if (this.wsBusy()) return;
    this.wsBusy.set(true);
    this.wsError.set(null);
    this.engine.workspaceClose(this.app).subscribe({
      next: r => {
        this.wsBusy.set(false);
        this.wsOpened.set(null);
        this.wsNotice.set(r.closed ? 'Éditeur fermé. Rien n\'est perdu : sources et réglages sont sur disque.' : 'L\'éditeur n\'était pas ouvert sur ce projet.');
        this.project.update(p => p ? { ...p, workspace: { open: false } } : p);
      },
      error: err => { this.wsBusy.set(false); this.wsError.set(toEngineError(err)); },
    });
  }
}
