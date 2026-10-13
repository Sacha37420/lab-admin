import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { EngineService } from '../../core/engine.service';
import { DATE_FORMAT } from '../../core/format';
import {
  EngineError, Job, PREVIEW_UNAVAILABLE_TEXT, Preview, isPreviewUrl, previewErrorText, previewOtherApp,
  previewServiceTone, previewShowsThis, previewStateLabel, previewUnavailable, toEngineError, toPreview,
} from '../../core/engine.client';
import { JobSuiviComponent } from '../job-suivi/job-suivi.component';

/**
 * Bloc « Adresse d'essai » de la page d'un projet (chantier essai-dev, I2).
 *
 * L'adresse est celle du PROPRIÉTAIRE du projet (`/dev-<uid>/`) et ne montre
 * qu'un de ses projets à la fois. Le bloc lit son état, lance la construction
 * (un job, suivi par `app-job-suivi`) et l'arrêt.
 *
 * `canAct = false` (projet d'un autre, vu par le superutilisateur) : l'état
 * reste lisible, aucun bouton — comme « Ma base », « Email » et les variables.
 *
 * Rien de ce que rend le moteur n'est interprété comme du HTML ; `url` et
 * `api_url` ne deviennent des liens que s'ils passent `isPreviewUrl`.
 */
@Component({
  selector: 'app-essai-projet',
  standalone: true,
  imports: [DatePipe, RouterLink, JobSuiviComponent],
  template: `
    <div class="pj-card">
      <h2>Adresse d'essai</h2>
      <p class="pj-hint">
        L'essai sert le dossier de travail tel qu'il est dans l'espace du projet : non commité, sans
        passer les tests, avec sa propre base, vide au départ. Ce n'est pas le déploiement — il ne le
        remplace pas et n'y touche pas. Une seule adresse par personne, pour un projet à la fois.
      </p>

      @if (unavailable(); as why) {
        <p class="pj-hint" role="status">{{ unavailableText[why] }}</p>
        <div><button type="button" class="btn-secondary" (click)="load()" [disabled]="loading()">Réessayer</button></div>
      } @else if (loading() && !preview()) {
        <p class="pj-hint" role="status">Lecture de l'état de l'essai…</p>
      } @else {
        @if (loadError(); as e) { <p class="pj-error" role="alert">{{ e.detail }}</p> }

        @if (preview(); as v) {
          @if (shows(v)) {
            <dl class="pj-dl">
              <dt>État</dt>
              <dd><span [class]="'pj-badge ' + toneClass(stateLabel(v.state).tone)">{{ stateLabel(v.state).label }}</span></dd>
              <dt>Adresse</dt>
              <dd>
                @if (!v.url) { — (ce projet n'a pas d'interface) }
                @else if (isLink(v.url)) { <a [href]="v.url" target="_blank" rel="noopener">{{ v.url }}</a> }
                @else { {{ v.url }} }
              </dd>
              @if (v.api_url; as api) {
                <dt>API</dt>
                <dd>@if (isLink(api)) { <a [href]="api" target="_blank" rel="noopener">{{ api }}</a> } @else { {{ api }} }</dd>
              }
              <dt>Peuvent l'ouvrir</dt>
              <dd>{{ v.groups.length ? 'les membres de : ' + v.groups.join(', ') : 'aucun groupe indiqué' }}</dd>
              <dt>Construit le</dt><dd>@if (v.built_at; as d) { {{ d | date: dateFormat }} } @else { — }</dd>
              <dt>Expire le</dt>
              <dd>@if (v.expires_at; as d) { {{ d | date: dateFormat }} — l'essai est alors arrêté, sa base est gardée } @else { — }</dd>
            </dl>
            @if (v.services.length) {
              <ul class="pj-list">
                @for (s of v.services; track s.service) {
                  <li>
                    <span class="pj-item-name">{{ s.service }}</span>
                    <span [class]="'pj-badge pj-' + serviceTone(s.state)">{{ s.state }}</span>
                  </li>
                }
              </ul>
            }
          } @else if (other(v); as autre) {
            <p class="pj-warn-text" role="status">
              L'adresse montre actuellement <a [routerLink]="['/projets', autre]">{{ autre }}</a>
              ({{ stateLabel(v.state).label }}).
              @if (canAct) { Construire l'essai ici le remplacera : une seule adresse par personne. }
            </p>
          } @else {
            <p class="pj-hint">Aucun essai en ce moment : l'adresse ne montre rien.</p>
          }
        }

        @if (canAct) {
          <div class="pj-row">
            <button type="button" class="btn-primary" (click)="build()" [disabled]="busy() || !!jobId()">
              {{ launching() ? 'Envoi…' : "Construire l'essai" }}
            </button>
            @if (preview(); as v) {
              @if (shows(v)) {
                <button type="button" class="pj-danger" (click)="stop()" [disabled]="busy() || !!jobId()">
                  {{ stopping() ? 'Arrêt…' : 'Arrêter' }}
                </button>
              }
            }
            <button type="button" class="btn-secondary" (click)="load()" [disabled]="loading()">Actualiser l'état</button>
          </div>
        } @else {
          <p class="pj-hint">Seul le propriétaire du projet construit ou arrête son essai depuis cette page.</p>
        }

        @if (notice()) { <p class="pj-hint" role="status">{{ notice() }}</p> }
        @if (error(); as e) {
          <p class="pj-error" role="alert">{{ errorText(e) }}</p>
          @if (e.reasons.length) { <ul class="pj-reasons">@for (r of e.reasons; track $index) { <li>{{ r }}</li> }</ul> }
        }
        @if (jobId()) {
          <app-job-suivi [jobId]="jobId()" (fini)="onJobDone($event)" />
          <div><button type="button" class="btn-secondary" (click)="jobId.set(''); error.set(null)">Fermer le suivi</button></div>
        }
      }
    </div>
  `,
})
export class EssaiProjetComponent implements OnChanges {
  private engine = inject(EngineService);

  @Input({ required: true }) app = '';
  @Input() canAct = false;

  readonly dateFormat = DATE_FORMAT;
  readonly unavailableText = PREVIEW_UNAVAILABLE_TEXT;
  readonly stateLabel = previewStateLabel;
  readonly serviceTone = previewServiceTone;
  readonly shows = previewShowsThis;
  readonly other = previewOtherApp;
  readonly errorText = previewErrorText;

  preview = signal<Preview | null>(null);
  loading = signal(false);
  loadError = signal<EngineError | null>(null);
  unavailable = signal<'no_domain' | 'not_served' | null>(null);
  launching = signal(false);
  stopping = signal(false);
  jobId = signal('');
  notice = signal('');
  error = signal<EngineError | null>(null);
  private reading?: Subscription;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['app']) return;
    this.reading?.unsubscribe();
    this.preview.set(null); this.loadError.set(null); this.unavailable.set(null);
    this.launching.set(false); this.stopping.set(false);
    this.jobId.set(''); this.notice.set(''); this.error.set(null);
    this.load();
  }

  busy(): boolean { return this.launching() || this.stopping(); }
  isLink(url: string): boolean { return isPreviewUrl(url, window.location.origin); }
  toneClass(tone: string): string { return tone ? `pj-${tone}` : ''; }

  /** Lecture seule côté moteur (aucun verrou) : peut être rejouée à volonté. */
  load(): void {
    if (!this.app) return;
    const app = this.app;
    this.reading?.unsubscribe();
    this.loading.set(true);
    this.loadError.set(null);
    this.reading = this.engine.previewStatus(app).subscribe({
      next: raw => { this.preview.set(toPreview(raw)); this.unavailable.set(null); this.loading.set(false); },
      error: err => {
        const e = toEngineError(err);
        this.loading.set(false);
        const why = previewUnavailable(e);
        if (why) { this.unavailable.set(why); this.preview.set(null); } else this.loadError.set(e);
      },
    });
  }

  build(): void {
    if (!this.canAct || this.busy() || this.jobId()) return;
    this.launching.set(true);
    this.notice.set('');
    this.error.set(null);
    this.engine.previewDeploy(this.app).subscribe({
      next: ticket => { this.launching.set(false); this.jobId.set(ticket.job_id); },
      error: err => {
        const e = toEngineError(err);
        this.launching.set(false);
        if (e.code === 'unavailable') { this.unavailable.set('no_domain'); return; }
        this.error.set(e);
        // Un job tourne déjà pour ce projet : on le suit, quel qu'il soit.
        if (e.code === 'job_exists' && e.jobId) this.jobId.set(e.jobId);
      },
    });
  }

  /** Réussi, échoué ou perdu : l'état affiché est toujours RELU au moteur, jamais déduit du job. */
  onJobDone(_job: Job | null): void { this.load(); }

  stop(): void {
    if (!this.canAct || this.busy() || this.jobId()) return;
    this.stopping.set(true);
    this.notice.set('');
    this.error.set(null);
    this.engine.previewStop(this.app).subscribe({
      next: r => {
        this.stopping.set(false);
        this.notice.set(r?.stopped === true
          ? "Essai arrêté. Sa base est gardée : le prochain essai de ce projet la retrouvera."
          : "L'adresse ne montrait pas ce projet : rien n'a été arrêté.");
        this.load();
      },
      error: err => { this.stopping.set(false); this.error.set(toEngineError(err)); this.load(); },
    });
  }
}
