import { Component, ElementRef, HostListener, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EngineService } from '../../core/engine.service';
import { ENV_KEY_RE, EngineError, EnvRow, envRows, toEngineError } from '../../core/engine.client';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';

/**
 * Variables d'environnement d'un projet.
 *
 * La liste ne porte que des NOMS (`envRows` jette toute valeur qu'un ancien
 * moteur renverrait encore). Une valeur est un secret possible (clé d'API) :
 *  - demandée au moteur AU CLIC, une variable à la fois (`GET …/env/<CLÉ>`) ;
 *  - gardée dans un signal de CE composant et nulle part ailleurs — ni
 *    stockage du navigateur, ni URL, ni console, ni service partagé ;
 *  - effacée en quittant la page, quand l'onglet passe à l'arrière-plan, au
 *    bouton « Masquer », et d'elle-même après 2 minutes.
 * Modifier ou supprimer ne demande pas d'afficher : le champ de valeur du
 * formulaire part toujours vide.
 *
 * `canAct = false` (projet d'un autre, vu par le superutilisateur) : les noms,
 * rien d'autre — ni affichage, ni modification, ni suppression.
 */
@Component({
  selector: 'app-env-vars',
  standalone: true,
  imports: [FormsModule, ConfirmDialogComponent],
  template: `
    <div class="pj-card" #card tabindex="-1">
      <h2>Variables d'environnement</h2>
      @if (!loaded()) {
        <div><button type="button" class="btn-secondary" (click)="load()">Afficher la liste des variables</button></div>
      } @else {
        @if (rows().length === 0) {
          <p class="pj-hint">Aucune variable.</p>
        } @else {
          <ul class="pj-list">
            @for (v of rows(); track v.key) {
              <li>
                <div class="pj-item-main">
                  <code>{{ v.key }}</code>
                  @if (v.managed) {
                    <span class="pj-hint">gérée par le lab — non lisible, non modifiable</span>
                  } @else if (shown()?.key === v.key) {
                    <code class="pj-env-value">{{ shown()?.value }}</code>
                  } @else if (v.hasValue === false) {
                    <span class="pj-hint">vide</span>
                  } @else {
                    <span class="pj-hint">valeur masquée</span>
                  }
                  @if (rowError()?.key === v.key) { <span class="pj-error" role="alert">{{ message(rowError()!.error) }}</span> }
                </div>
                @if (!v.managed && canAct) {
                  <div class="pj-row pj-actions">
                    @if (shown()?.key === v.key) {
                      <button type="button" class="btn-secondary" (click)="copy()" [attr.aria-label]="'Copier la valeur de ' + v.key">{{ copied() ? 'Copié ✓' : 'Copier' }}</button>
                      <button type="button" class="btn-secondary" (click)="hide()" [attr.aria-label]="'Masquer ' + v.key">Masquer</button>
                    } @else if (v.hasValue !== false) {
                      <button type="button" class="btn-secondary" (click)="reveal(v)" [disabled]="revealing() === v.key"
                              [attr.aria-label]="'Afficher la valeur de ' + v.key">{{ revealing() === v.key ? 'Lecture…' : 'Afficher' }}</button>
                    }
                    <button type="button" class="btn-secondary" (click)="edit(v)" [attr.aria-label]="'Modifier ' + v.key">Modifier</button>
                    <button type="button" class="pj-danger" #del (click)="askRemove(v, del)" [disabled]="busy()"
                            [attr.aria-label]="'Supprimer ' + v.key">Supprimer</button>
                  </div>
                }
              </li>
            }
          </ul>
        }

        @if (canAct) {
          @if (shown()) {
            <p class="pj-hint">La valeur affichée se masque en quittant la page ou en changeant d'onglet, et d'elle-même après 2 minutes. Chaque affichage est journalisé.</p>
          }
          <form class="pj-form" (ngSubmit)="save()" autocomplete="off">
            <div class="pj-row">
              <label class="pj-fld">
                <span>Clé</span>
                <input type="text" name="envKey" #keyInput [(ngModel)]="key" maxlength="64" autocomplete="off" spellcheck="false" placeholder="MA_CLE_API">
              </label>
              <label class="pj-fld">
                <span>{{ editing() ? 'Nouvelle valeur' : 'Valeur' }}</span>
                <input type="text" name="envValue" #valueInput [(ngModel)]="value" maxlength="4096" autocomplete="off" spellcheck="false">
              </label>
            </div>
            @if (editing()) { <p class="pj-hint">La valeur actuelle n'est pas reprise ici : saisissez la nouvelle, elle remplacera l'ancienne.</p> }
            @if (key && !keyOk) { <p class="pj-hint">Clé : majuscules, chiffres et « _ », en commençant par une lettre.</p> }
            <div><button type="submit" class="btn-primary" [disabled]="!keyOk || busy()">Enregistrer</button></div>
          </form>
          <p class="pj-hint">Toute modification prend effet au prochain déploiement.</p>
        } @else {
          <p class="pj-hint">Seul le propriétaire du projet lit et modifie ses variables ; vous n'en voyez que les noms.</p>
        }
      }
      @if (notice()) { <p class="pj-success" role="status">{{ notice() }}</p> }
      @if (error()) { <p class="pj-error" role="alert">{{ error() }}</p> }
    </div>
    <app-confirm #confirm />
  `,
})
export class EnvVarsComponent implements OnChanges, OnDestroy {
  private engine = inject(EngineService);

  @Input({ required: true }) app = '';
  /** Le projet est celui de la personne connectée. */
  @Input() canAct = false;

  @ViewChild('card') private card?: ElementRef<HTMLElement>;
  @ViewChild('confirm') private confirm?: ConfirmDialogComponent;
  @ViewChild('valueInput') private valueInput?: ElementRef<HTMLInputElement>;

  rows = signal<EnvRow[]>([]);
  loaded = signal(false);
  error = signal('');
  notice = signal('');
  busy = signal(false);

  /** LA valeur affichée — une seule à la fois. Voir l'en-tête avant d'y toucher. */
  shown = signal<{ key: string; value: string } | null>(null);
  revealing = signal('');
  copied = signal(false);
  rowError = signal<{ key: string; error: EngineError } | null>(null);
  private hideTimer?: ReturnType<typeof setTimeout>;

  key = '';
  value = '';
  editing = signal(false);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['app'] && !changes['app'].firstChange) {
      this.hide(); this.rows.set([]); this.loaded.set(false); this.error.set(''); this.notice.set('');
      this.key = ''; this.value = ''; this.editing.set(false);
    }
    if (changes['canAct'] && !this.canAct) this.hide();
  }

  ngOnDestroy(): void { this.hide(); }

  @HostListener('document:visibilitychange')
  onVisibility(): void { if (document.hidden) this.hide(); }

  @HostListener('window:pagehide')
  onPageHide(): void { this.hide(); }

  load(): void {
    this.error.set('');
    this.engine.envList(this.app).subscribe({
      // envRows ne garde que le nom, « gérée » et « a une valeur » : rien d'autre n'entre ici.
      next: r => { this.rows.set(envRows(r?.variables)); this.loaded.set(true); },
      error: err => this.error.set(toEngineError(err).detail),
    });
  }

  reveal(v: EnvRow): void {
    if (!this.canAct || v.managed || this.revealing()) return;
    this.hide();
    this.revealing.set(v.key);
    this.rowError.set(null);
    this.engine.envGet(this.app, v.key).subscribe({
      next: r => {
        this.revealing.set('');
        if (!this.canAct || document.hidden) return;
        this.shown.set({ key: v.key, value: typeof r?.value === 'string' ? r.value : '' });
        this.hideTimer = setTimeout(() => this.hide(), 120_000);
      },
      error: err => { this.revealing.set(''); this.rowError.set({ key: v.key, error: toEngineError(err) }); },
    });
  }

  hide(): void {
    clearTimeout(this.hideTimer);
    this.shown.set(null);
    this.copied.set(false);
  }

  copy(): void {
    const value = this.shown()?.value;
    if (value === undefined) return;
    navigator.clipboard?.writeText(value).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }, () => {});
  }

  get keyOk(): boolean { return ENV_KEY_RE.test(this.key); }

  /** Modifier : le nom est repris, la valeur NON — on n'affiche rien pour remplacer. */
  edit(v: EnvRow): void {
    if (v.managed || !this.canAct) return;
    this.key = v.key;
    this.value = '';
    this.editing.set(true);
    setTimeout(() => this.valueInput?.nativeElement.focus());
  }

  save(): void {
    if (!this.canAct || !this.keyOk || this.busy()) return;
    this.busy.set(true);
    this.error.set(''); this.notice.set('');
    const key = this.key;
    this.engine.envSet(this.app, key, this.value).subscribe({
      next: () => {
        this.busy.set(false);
        this.notice.set(`${key} enregistrée — prise en compte au prochain déploiement.`);
        this.key = ''; this.value = ''; this.editing.set(false);
        if (this.shown()?.key === key) this.hide();
        this.load();
      },
      error: err => { this.busy.set(false); this.error.set(toEngineError(err).detail); },
    });
  }

  askRemove(v: EnvRow, origin: HTMLElement): void {
    if (v.managed || !this.canAct || this.busy()) return;
    this.confirm?.ask({
      title: 'Supprimer cette variable ?',
      text: `La variable ${v.key} sera retirée de l'application au prochain déploiement.`,
      confirmLabel: 'Supprimer', danger: true,
    }, origin, () => this.remove(v), this.card?.nativeElement);
  }

  private remove(v: EnvRow): void {
    this.busy.set(true);
    this.error.set(''); this.notice.set('');
    this.engine.envUnset(this.app, v.key).subscribe({
      next: () => {
        this.busy.set(false);
        if (this.shown()?.key === v.key) this.hide();
        this.notice.set(`${v.key} supprimée — prise en compte au prochain déploiement.`);
        this.load();
      },
      error: err => { this.busy.set(false); this.error.set(toEngineError(err).detail); },
    });
  }

  message(e: EngineError): string {
    switch (e.code) {
      case 'managed_key': return 'Cette variable est gérée par le lab : sa valeur ne se lit pas.';
      case 'forbidden': return 'Seul le propriétaire du projet peut lire cette valeur.';
      case 'no_engine': return "L'affichage d'une valeur n'est pas encore disponible sur le lab.";
      default: return e.detail;
    }
  }
}
