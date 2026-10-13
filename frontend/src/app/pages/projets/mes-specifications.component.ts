import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { EngineService } from '../../core/engine.service';
import { HandoffService } from '../../core/handoff.service';
import { EngineError, Job, Project, toEngineError } from '../../core/engine.client';
import {
  HandoffContext, HandoffError, HandoffSpec, HandoffSpecDetail, LaunchPlan,
  appTypeLabel, contextSummary, existingProject, launchPlan, planAllowsCreation, seededProject, toHandoffError, toListError,
} from '../../core/handoff.client';
import { JobSuiviComponent } from '../../shared/job-suivi/job-suivi.component';
import { DATE_FORMAT } from '../../core/format';

/**
 * Bloc « Mes spécifications » de la page Projets (chantier app-builder-lab) :
 * les spécifications qu'a écrites LE COMPTE CONNECTÉ dans App Builder, et, pour
 * celles qui sont prêtes, « Lancer la construction » — le projet est créé par
 * le moteur avec la feuille de route et le cahier des charges de la
 * spécification dans son premier commit.
 *
 * Rien ne passe par le backend de lab-admin : le navigateur lit App Builder
 * (`core/handoff.client.ts`, I1) puis écrit au moteur (`core/engine.client.ts`,
 * I2), avec le jeton de l'utilisateur. Le bloc n'est donc jamais monté quand
 * on regarde les projets d'un autre (`?as=`) : ce ne seraient pas les siennes.
 *
 * App Builder injoignable, refus ou adresse non configurée : un message dans
 * le bloc, rien d'autre de la page n'en dépend.
 *
 * Tout texte venu d'App Builder est rendu en texte brut (interpolation).
 */
@Component({
  selector: 'app-mes-specifications',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, JobSuiviComponent],
  templateUrl: './mes-specifications.component.html',
})
export class MesSpecificationsComponent implements OnInit {
  private handoff = inject(HandoffService);
  private engine = inject(EngineService);

  /** Les projets du compte connecté (jamais ceux d'un autre) : sert à reconnaître une spécification déjà construite. */
  @Input() projects: Project[] = [];
  /** L'uid du compte connecté. */
  @Input() uid: string | null = null;
  /** Le compte peut-il créer un projet (développeur initialisé, moteur joignable) ? */
  @Input() canLaunch = false;
  /** `false` : compte GitHub non relié — la création échouerait. */
  @Input() githubLinked: boolean | null = null;
  @Input() githubUrl = '';
  /** Un projet vient d'être créé (ou la création a échoué) : la page relit sa liste. */
  @Output() created = new EventEmitter<void>();

  readonly dateFormat = DATE_FORMAT;
  readonly typeLabel = appTypeLabel;
  readonly appBuilderUrl = this.handoff.appBuilderUrl;

  loading = signal(true);
  error = signal<HandoffError | null>(null);
  specs = signal<HandoffSpec[]>([]);

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.handoff.specs().subscribe({
      next: specs => { this.specs.set(specs); this.loading.set(false); },
      error: err => { this.specs.set([]); this.error.set(toListError(err)); this.loading.set(false); },
    });
  }

  project(s: HandoffSpec): Project | null { return existingProject(s, this.projects, this.uid); }

  context(c: HandoffContext) { return contextSummary(c); }

  // ── Détail (description, estimations de contexte) ──────────────────────────

  detailId = signal<number | null>(null);
  detail = signal<HandoffSpecDetail | null>(null);
  detailError = signal<HandoffError | null>(null);
  private detailSub?: Subscription;

  toggleDetail(s: HandoffSpec): void {
    this.detailSub?.unsubscribe();
    this.detail.set(null);
    this.detailError.set(null);
    if (this.detailId() === s.id) { this.detailId.set(null); return; }
    this.detailId.set(s.id);
    this.detailSub = this.handoff.spec(s.id).subscribe({
      next: d => this.detail.set(d),
      error: err => this.detailError.set(toHandoffError(err)),
    });
  }

  // ── Lancer la construction ─────────────────────────────────────────────────

  /** La spécification en cours de lancement (une seule à la fois). */
  launchId = signal<number | null>(null);
  preparing = signal(false);
  plan = signal<LaunchPlan | null>(null);
  planError = signal<HandoffError | null>(null);
  visibility: 'private' | 'public' = 'private';
  sending = signal(false);
  createError = signal<EngineError | null>(null);
  jobId = signal('');
  createdApp = signal('');
  private planSub?: Subscription;

  readonly allows = planAllowsCreation;

  /** Un lancement est engagé (envoi ou job) : on n'en commence pas un autre. */
  get busy(): boolean { return this.sending() || (!!this.jobId() && !this.jobDone()); }
  jobDone = signal(false);

  /** Lit le kit, fait contrôler le nom par le moteur ; RIEN n'est créé avant la confirmation. */
  launch(s: HandoffSpec): void {
    if (!this.canLaunch || !s.ready || this.busy || this.project(s)) return;
    this.closeLaunch();
    this.launchId.set(s.id);
    this.preparing.set(true);
    this.planSub = launchPlan(this.handoff, this.engine, s.id).subscribe({
      next: plan => { this.plan.set(plan); this.preparing.set(false); },
      error: err => {
        const e = toHandoffError(err);
        this.planError.set(e);
        this.preparing.set(false);
        // La spécification a changé depuis l'affichage : la liste est relue (le panneau reste ouvert).
        if (e.code === 'not_ready' || e.code === 'not_found') this.load();
      },
    });
  }

  confirm(): void {
    const plan = this.plan();
    if (!plan || !planAllowsCreation(plan)) return;
    if (!this.canLaunch || this.githubLinked === false || this.sending() || this.jobId()) return;
    this.sending.set(true);
    this.createError.set(null);
    this.engine.createProject(seededProject(plan.kit, this.visibility)).subscribe({
      next: ticket => { this.sending.set(false); this.jobDone.set(false); this.jobId.set(ticket.job_id); },
      error: err => {
        const e = toEngineError(err);
        this.sending.set(false);
        this.createError.set(e);
        // Un job tourne déjà pour ce nom : on le suit plutôt que d'en rester à l'erreur.
        if (e.code === 'job_exists' && e.jobId) { this.jobDone.set(false); this.jobId.set(e.jobId); }
      },
    });
  }

  onJobDone(job: Job | null): void {
    this.jobDone.set(true);
    if (job?.result?.ok) this.createdApp.set(job.result.app ?? job.app);
    this.created.emit();
  }

  /** Ferme le panneau de lancement. Sans effet sur un job déjà parti : il continue côté moteur. */
  closeLaunch(): void {
    this.planSub?.unsubscribe();
    this.launchId.set(null);
    this.preparing.set(false);
    this.plan.set(null);
    this.planError.set(null);
    this.visibility = 'private';
    this.sending.set(false);
    this.createError.set(null);
    this.jobId.set('');
    this.jobDone.set(false);
    this.createdApp.set('');
  }
}
