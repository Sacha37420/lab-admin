import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { EngineService } from '../../core/engine.service';
import { shortSha } from '../../core/format';
import {
  DeployTests, EngineError, Job, JobTestCase, cloisonnementLabel, deployVerdicts, runAllSummary, testCases, toEngineError, verdictLabel,
} from '../../core/engine.client';

const KIND_LABELS: Record<Job['kind'], string> = { create: 'Création', deploy: 'Déploiement', tests: 'Tests', tests_all: 'Test de tous les projets', preview: 'Essai' };
const STATE_LABELS: Record<Job['state'], string> = {
  queued: 'en file d\'attente', running: 'en cours', succeeded: 'réussi', failed: 'échoué',
};

/**
 * Suivi d'un job du moteur (création, déploiement, tests) : état, étape,
 * journal, puis résultat. Interroge `GET /jobs/<id>` toutes les 2 s et s'arrête
 * à `terminal: true` (API.md §4).
 */
@Component({
  selector: 'app-job-suivi',
  standalone: true,
  template: `
    @if (job(); as j) {
      <div class="pj-job" [class.pj-ok]="good(j)" [class.pj-ko]="bad(j)" aria-live="polite">
        <div class="pj-job-head">
          <strong>{{ kindLabel(j) }} {{ stateLabel(j) }}</strong>
          @if (j.state === 'queued' && j.jobs_ahead > 0) { <span>— {{ j.jobs_ahead }} job(s) devant</span> }
          @if (j.step && !j.terminal) { <span>— étape « {{ j.step }} »</span> }
        </div>

        @if (j.result; as r) {
          @if (r.error) { <p class="pj-error">{{ r.error }}@if (r.step) { (étape « {{ r.step }} »)}</p> }
          @if (r.reasons?.length) {
            <ul class="pj-reasons">@for (reason of r.reasons; track $index) { <li>{{ reason }}</li> }</ul>
          }
          @if (r.sha) { <p class="pj-hint">Commit : <code>{{ shortSha(r.sha) }}</code></p> }
          @if (verdicts(j); as v) {
            <p class="pj-hint">
              Tests backend : <strong [class.pj-error]="v.backend === 'ko'">{{ verdict(v.backend) }}</strong>
              · test de cloisonnement :
              <strong [class.pj-error]="v.cloisonnement === 'ko'">{{ verdict(v.cloisonnement) }}</strong>
            </p>
            @if (r.ok && v.cloisonnement === 'ko') {
              <p class="pj-error">Déployé, mais le test de cloisonnement a échoué : l'app n'est peut-être pas correctement réservée à ses groupes.</p>
            }
          }
          @if (r.summary) { <p [class.pj-error]="!r.ok" class="pj-hint">{{ r.summary }}</p> }
          @if (j.kind === 'tests' && r.found === false) {
            <p class="pj-error">Aucun test trouvé : ce n'est pas un succès. Le projet doit contenir <code>frontend/e2e/cloisonnement.spec.ts</code>.</p>
          }
          @if (cases(j).length) {
            <ul class="pj-list">
              @for (t of cases(j); track $index) {
                <li>
                  <span>{{ t.title }}@if (t.message) { — <span class="pj-hint">{{ t.message }}</span> }</span>
                  <span class="pj-badge" [class.pj-ok]="t.status === 'PASSED'" [class.pj-ko]="t.status !== 'PASSED'">{{ t.status }}</span>
                </li>
              }
            </ul>
          }
          @if (r.results; as results) {
            <!-- « Tout tester » : un verdict par app. Aucun test trouvé n'est pas un succès. -->
            @if (results.length === 0) {
              <p class="pj-error">Aucun projet n'a été testé : ce n'est pas un succès.</p>
            } @else {
              <p [class]="summary(results).allOk ? 'pj-success' : 'pj-error'">
                {{ summary(results).ok }} vérifié(s), {{ summary(results).ko }} en échec, {{ summary(results).absent }} sans test{{ summary(results).other ? ', ' + summary(results).other + ' autre(s)' : '' }}.
              </p>
              <ul class="pj-list">
                @for (res of results; track res.app) {
                  <li>
                    <div class="pj-item-main">
                      <span class="pj-item-name">{{ res.app }}</span>
                      @if (res.cases?.length) {
                        <details>
                          <summary>{{ res.cases?.length }} cas</summary>
                          <ul class="pj-reasons pj-cases">@for (c of res.cases ?? []; track $index) { <li [class.pj-case-ok]="c.status === 'PASSED'">{{ c.status }} — {{ c.title }}</li> }</ul>
                        </details>
                      }
                    </div>
                    <span [class]="'pj-badge ' + tone(res.verdict)">{{ cloisonnement(res.verdict) }}</span>
                  </li>
                }
              </ul>
            }
          }
          @if (r.rollback?.length) {
            <p class="pj-hint">Retour arrière {{ r.rollback_complete ? 'complet' : 'INCOMPLET — reste à faire à la main' }} :</p>
            <ul class="pj-reasons">@for (line of r.rollback; track $index) { <li>{{ line }}</li> }</ul>
          }
        }

        @if (j.log.length) {
          <details [open]="!j.terminal || j.state === 'failed'">
            <summary>Journal ({{ j.log_lines_total }} ligne(s))</summary>
            <pre class="pj-pre">{{ j.log.join('\\n') }}</pre>
          </details>
        }
      </div>
    } @else if (error(); as e) {
      <p class="pj-error" role="alert">
        @if (e.code === 'not_found') {
          Ce job n'est plus connu du moteur (il a pu redémarrer). L'état réel du projet est celui affiché sur sa page.
        } @else { {{ e.detail }} }
      </p>
    } @else {
      <p class="pj-hint">Suivi du job…</p>
    }
  `,
})
export class JobSuiviComponent implements OnChanges, OnDestroy {
  private engine = inject(EngineService);

  @Input({ required: true }) jobId!: string;
  /** Émis une fois, quand le job est terminé (réussi ou non) ou perdu. */
  @Output() fini = new EventEmitter<Job | null>();

  job = signal<Job | null>(null);
  error = signal<EngineError | null>(null);
  private sub?: Subscription;

  ngOnChanges(): void {
    this.sub?.unsubscribe();
    this.job.set(null);
    this.error.set(null);
    if (!this.jobId) return;
    this.sub = this.engine.watchJob(this.jobId).subscribe({
      next: j => { this.job.set(j); if (j.terminal) this.fini.emit(j); },
      error: err => { this.error.set(toEngineError(err)); this.fini.emit(null); },
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  readonly shortSha = shortSha;
  readonly summary = runAllSummary;
  cloisonnement(v: string): string { return cloisonnementLabel(v).label; }
  tone(v: string): string { const t = cloisonnementLabel(v).tone; return t ? `pj-${t}` : ''; }

  kindLabel(j: Job): string { return KIND_LABELS[j.kind] ?? j.kind; }
  /**
   * « Tout tester » : le job peut s'achever sans erreur alors que des projets sont en échec ou
   * sans test. Il n'est alors NI dit « réussi » NI montré en vert : seul compte le bilan par app.
   */
  private mixed(j: Job): boolean {
    return j.kind === 'tests_all' && j.state === 'succeeded' && !runAllSummary(j.result?.results).allOk;
  }
  good(j: Job): boolean { return j.state === 'succeeded' && !this.mixed(j); }
  bad(j: Job): boolean { return j.state === 'failed' || this.mixed(j); }
  stateLabel(j: Job): string {
    return this.mixed(j) ? 'terminé — tout n\'est pas vérifié' : STATE_LABELS[j.state] ?? j.state;
  }
  verdicts(j: Job): DeployTests | null { return deployVerdicts(j.result); }
  cases(j: Job): JobTestCase[] { return testCases(j.result); }
  verdict(v: string): string { return verdictLabel(v); }
}
