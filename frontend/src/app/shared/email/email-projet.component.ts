import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EngineService } from '../../core/engine.service';
import { SmtpStaleService } from '../../core/smtp-stale.service';
import { EngineError, ProjectSmtp, SmtpProfile, smtpIsStale, toEngineError } from '../../core/engine.client';

/**
 * Bloc « Email » de la page d'un projet (contrat multi-dev I6/I10 v9) : quel
 * compte d'envoi l'application utilise, et quand le changement prend effet.
 *
 * `canAct = false` (projet d'un autre, vu par le superutilisateur) : lecture
 * seule — on ne rattache à un projet qu'un profil à soi, et seulement si le
 * projet est le sien ; les profils du propriétaire ne sont alors pas demandés.
 */
@Component({
  selector: 'app-email-projet',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="pj-card">
      <h2>Email</h2>
      @if (smtp === undefined) {
        <p class="pj-hint" role="status">L'envoi d'email par compte personnel n'est pas encore disponible sur le lab.</p>
      } @else {
        <p class="pj-hint">
          Compte d'envoi de cette application :
          <strong>{{ smtp?.profile ? (smtp?.label || smtp?.profile) : 'aucun' }}</strong>.
          L'application doit lire les variables <code>EMAIL_*</code> (c'est le cas de tout projet créé par le lab) ; elle envoie alors ses emails sans autre réglage.
        </p>
        @if (isStale()) {
          <p class="pj-error" role="status">
            Ce compte d'envoi a été modifié depuis sa mise en place ici : l'application tourne encore avec l'ancienne version.
            {{ canAct ? 'Appliquez-le de nouveau ci-dessous.' : '' }}
          </p>
        }

        @if (!canAct) {
          <p class="pj-hint">Seul le propriétaire du projet choisit son compte d'envoi.</p>
        } @else if (unavailable()) {
          <p class="pj-hint" role="status">Cette fonction n'est pas encore disponible sur le lab.</p>
        } @else if (loadError()) {
          <p class="pj-error" role="alert">{{ loadError() }}</p>
        } @else {
          @if (profiles().length === 0 && !smtp?.profile) {
            <p class="pj-hint">Vous n'avez encore aucun compte d'envoi. <a routerLink="/services">Ajoutez-en un sur la page Services</a>, puis revenez le choisir ici.</p>
          } @else {
            <form class="pj-form" (ngSubmit)="save()">
              <label class="pj-fld">
                <span>Compte d'envoi</span>
                <select name="smtpProfile" [(ngModel)]="chosen">
                  <option value="">Aucun — l'application n'envoie pas d'email par ce moyen</option>
                  @for (p of profiles(); track p.id) { <option [value]="p.id">{{ p.label }} — {{ p.from_email }}</option> }
                </select>
              </label>
              <fieldset class="pj-fld">
                <span>Quand ?</span>
                <label class="pj-check">
                  <input type="radio" name="smtpApply" value="next_deploy" [(ngModel)]="apply">
                  Au prochain déploiement
                </label>
                <label class="pj-check">
                  <input type="radio" name="smtpApply" value="now" [(ngModel)]="apply">
                  Maintenant — l'application redémarre sans être reconstruite : quelques secondes de coupure
                </label>
              </fieldset>
              <div><button type="submit" class="btn-primary" [disabled]="saving()">{{ saving() ? (apply === 'now' ? 'Redémarrage…' : 'Enregistrement…') : (apply === 'now' ? 'Appliquer maintenant' : 'Enregistrer pour le prochain déploiement') }}</button></div>
            </form>
          }
          @if (notice()) { <p class="pj-success" role="status">{{ notice() }}</p> }
          @if (error(); as e) { <p class="pj-error" role="alert">{{ e.code === 'no_engine' ? "Cette fonction n'est pas encore disponible sur le lab." : e.detail }}</p> }
        }
      }
    </div>
  `,
})
export class EmailProjetComponent implements OnChanges {
  private engine = inject(EngineService);
  private stale = inject(SmtpStaleService);

  @Input({ required: true }) app = '';
  /** `smtp` du détail du projet ; `undefined` = le moteur en service ne le rend pas encore. */
  @Input() smtp: ProjectSmtp | null | undefined = undefined;
  @Input() canAct = false;
  /** Émis après un changement enregistré : la page relit l'état du projet. */
  /** Pas « change » : ce nom capterait aussi l'événement natif du <select> interne. */
  @Output() applique = new EventEmitter<void>();

  profiles = signal<SmtpProfile[]>([]);
  unavailable = signal(false);
  loadError = signal('');
  chosen = '';
  apply: 'now' | 'next_deploy' = 'next_deploy';
  saving = signal(false);
  notice = signal('');
  error = signal<EngineError | null>(null);
  private loadedFor = '';

  /** `smtp.stale` du moteur ; à défaut du champ, ce que cette session a retenu (voir SmtpStaleService). */
  isStale(): boolean { return smtpIsStale(this.smtp, this.stale.of(this.app) !== null); }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['smtp'] || changes['app']) this.chosen = this.smtp?.profile ?? '';
    // Les profils ne sont demandés que pour SON projet, et une seule fois par projet.
    if (this.canAct && this.smtp !== undefined && this.loadedFor !== this.app) {
      this.loadedFor = this.app;
      this.engine.smtpList().subscribe({
        next: r => this.profiles.set(r.profiles ?? []),
        error: err => {
          const e = toEngineError(err);
          if (e.code === 'no_engine') this.unavailable.set(true); else this.loadError.set(e.detail);
        },
      });
    }
  }

  save(): void {
    if (!this.canAct || this.saving()) return;
    const apply = this.apply;
    this.saving.set(true);
    this.notice.set('');
    this.error.set(null);
    this.engine.projectSmtp(this.app, this.chosen || null, apply).subscribe({
      next: r => {
        this.saving.set(false);
        if (r.applied) {
          this.stale.clear(this.app);
          this.notice.set(r.profile ? "C'est appliqué : l'application a redémarré avec ce compte d'envoi." : "C'est appliqué : l'application a redémarré sans compte d'envoi.");
        } else {
          this.notice.set(apply === 'now'
            ? "Enregistré, mais pas encore appliqué : ce sera pris en compte au prochain déploiement."
            : 'Enregistré : ce sera pris en compte au prochain déploiement.');
        }
        this.applique.emit();
      },
      error: err => { this.saving.set(false); this.error.set(toEngineError(err)); },
    });
  }
}
