import { Component, Input, OnChanges, inject, signal } from '@angular/core';
import { Subscription, catchError, forkJoin, of } from 'rxjs';
import { EngineService } from '../../core/engine.service';
import { HandoffService } from '../../core/handoff.service';
import { SpecLinkService } from '../../core/spec-link.service';
import { EngineError, Ticket, toEngineError } from '../../core/engine.client';
import {
  HandoffError, OriginSpec, SpecLinkRef, TransmitError, originSpec, specChanged, toHandoffError, toListError, transmitSpec,
} from '../../core/handoff.client';
import { appBuilderApiUrl } from '../../core/env';

/**
 * Bloc « Spécification d'origine » de la page d'un projet (chantier
 * app-builder-v2, P2/P3).
 *
 * Retrouve, parmi les spécifications App Builder DE L'APPELANT, celle dont le
 * projet est né : par le lien enregistré par lab-admin (I8) d'abord, sinon par
 * le nom de projet. Si l'empreinte enregistrée et l'empreinte actuelle (I7)
 * diffèrent, le dit ; « Transmettre au projet » ouvre alors un ticket dans le
 * dépôt par la route existante du moteur (`POST /projects/<app>/tickets`), puis
 * met à jour le lien. Rien n'est écrit dans le dépôt ni dans App Builder.
 *
 * Monté seulement sur un projet de l'appelant (`canAct`) : rapprocher une de
 * SES spécifications du projet d'un autre n'aurait pas de sens. Sans App Builder
 * configuré, ou sans spécification d'origine, le bloc ne montre rien.
 */
@Component({
  selector: 'app-spec-origine',
  standalone: true,
  templateUrl: './spec-origine.component.html',
})
export class SpecOrigineComponent implements OnChanges {
  private handoff = inject(HandoffService);
  private engine = inject(EngineService);
  private links = inject(SpecLinkService);

  @Input({ required: true }) app = '';
  /** Le projet est celui du compte connecté. */
  @Input() canAct = false;

  readonly configured = appBuilderApiUrl() !== null;
  readonly appBuilderUrl = this.handoff.appBuilderUrl;

  loading = signal(false);
  error = signal<HandoffError | null>(null);
  origin = signal<OriginSpec | null>(null);
  link = signal<SpecLinkRef | null>(null);
  changed = signal(false);

  sending = signal(false);
  sent = signal<Ticket | null>(null);
  sendError = signal<{ detail: string; connectUrl: string | null; blockers: string[] } | null>(null);
  linkFailed = signal(false);
  private sub?: Subscription;

  ngOnChanges(): void { this.load(); }

  load(): void {
    this.sub?.unsubscribe();
    this.origin.set(null); this.link.set(null); this.changed.set(false); this.error.set(null);
    if (!this.configured || !this.canAct || !this.app) return;
    this.loading.set(true);
    this.sub = forkJoin({
      // Un lien illisible ne doit pas cacher la spécification : on retombe sur le nom.
      link: this.links.get(this.app).pipe(catchError(() => of(null))),
      specs: this.handoff.specs(),
    }).subscribe({
      next: ({ link, specs }) => {
        const o = originSpec(this.app, specs, link);
        this.link.set(link);
        this.origin.set(o);
        this.changed.set(specChanged(link, o.spec));
        this.loading.set(false);
      },
      error: err => { this.error.set(toListError(err)); this.loading.set(false); },
    });
  }

  specUrl(id: number): string | null { return this.appBuilderUrl ? `${this.appBuilderUrl}?spec=${id}` : null; }

  /** Ouvre le ticket « spécification modifiée » puis met à jour le lien. */
  transmit(): void {
    const s = this.origin()?.spec;
    if (!s || this.sending() || !this.canAct) return;
    this.sending.set(true);
    this.sent.set(null);
    this.sendError.set(null);
    this.linkFailed.set(false);
    transmitSpec(this.handoff, this.engine, this.links, this.app, s.id, this.appBuilderUrl).subscribe({
      next: r => {
        this.sending.set(false);
        this.sent.set(r.ticket);
        if (r.link) {
          this.link.set({ ...r.link });
          this.origin.update(o => o ? { ...o, via: 'link' } : o);
          this.changed.set(false);
        } else {
          this.linkFailed.set(true);
        }
      },
      error: (err: TransmitError) => {
        this.sending.set(false);
        // Erreur d'App Builder (kit, dont « pas prête ») ou du moteur (ticket) : sa phrase.
        if (err?.stage === 'kit') {
          const e = toHandoffError(err.cause);
          this.sendError.set({ detail: e.detail, connectUrl: null, blockers: e.blockers.map(b => b.message) });
        } else {
          const e: EngineError = toEngineError(err?.cause);
          this.sendError.set({ detail: e.detail, connectUrl: e.connectUrl, blockers: e.reasons });
        }
      },
    });
  }
}
