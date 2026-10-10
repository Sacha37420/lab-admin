import { Component, HostListener, Input, OnChanges, OnDestroy, SimpleChanges, inject, signal } from '@angular/core';
import { EngineService } from '../../core/engine.service';
import {
  DatabaseInfo, DatabasePassword, EngineError, PgadminServer, isPgadminUrl, toEngineError,
} from '../../core/engine.client';
import { preopenTab, sendTab } from '../../core/tool-tab';

/**
 * Bloc « Ma base » (contrat multi-dev I6/I9 v7) : coordonnées de la base du
 * développeur, mot de passe À LA DEMANDE, pgAdmin personnel.
 *
 * Règles du mot de passe — c'est le seul secret que lab-admin affiche :
 *  - demandé au moteur AU CLIC seulement (`GET /me/database-password`), jamais
 *    au chargement ;
 *  - gardé dans un signal de CE composant et nulle part ailleurs : ni
 *    localStorage/sessionStorage, ni URL, ni console, ni service partagé ;
 *  - effacé en quittant la page (destruction du composant), quand l'onglet
 *    passe à l'arrière-plan, au bouton « Masquer », et de lui-même après 2 min.
 *
 * `actions = false` (vue `?as=` du superutilisateur, projet d'un autre) : ni
 * mot de passe ni pgAdmin — les routes du moteur ne concernent que soi-même.
 */
@Component({
  selector: 'app-ma-base',
  standalone: true,
  template: `
    <div class="pj-card">
      <h2>{{ actions ? 'Ma base' : 'Base de données' }}</h2>
      @if (database; as db) {
        <dl class="pj-dl">
          <dt>Hôte</dt><dd><code>{{ db.host }}</code></dd>
          <dt>Base</dt><dd><code>{{ db.name }}</code></dd>
          <dt>Rôle</dt><dd><code>{{ db.user }}</code></dd>
          @if (db.schema) { <dt>Schéma</dt><dd><code>{{ db.schema }}</code></dd> }
          @if (secret(); as s) {
            <dt>Mot de passe</dt>
            <dd class="pj-row">
              <code>{{ s.password }}</code>
              <button type="button" class="btn-secondary" (click)="copy('pg', s.password)">{{ copied() === 'pg' ? 'Copié ✓' : 'Copier' }}</button>
            </dd>
            @if (s.gis; as gis) {
              <dt>Base SIG</dt><dd><code>{{ gis.name }}</code> sur <code>{{ gis.host }}</code>, rôle <code>{{ gis.user }}</code></dd>
              @if (s.gis_password; as gp) {
                <dt>Mot de passe SIG</dt>
                <dd class="pj-row">
                  <code>{{ gp }}</code>
                  <button type="button" class="btn-secondary" (click)="copy('gis', gp)">{{ copied() === 'gis' ? 'Copié ✓' : 'Copier' }}</button>
                </dd>
              }
            }
          }
        </dl>

        @if (actions) {
          <div class="pj-row">
            @if (secret()) {
              <button type="button" class="btn-secondary" (click)="hide()">Masquer le mot de passe</button>
            } @else {
              <button type="button" class="btn-secondary" (click)="reveal()" [disabled]="revealing()">
                {{ revealing() ? 'Lecture…' : 'Afficher le mot de passe' }}
              </button>
            }
            <button type="button" class="btn-primary" (click)="openPgadmin()" [disabled]="pgBusy()">
              {{ pgBusy() ? 'Démarrage de pgAdmin…' : 'Ouvrir pgAdmin' }}
            </button>
            @if (pgOpen()) {
              <button type="button" class="pj-danger" (click)="closePgadmin()" [disabled]="pgBusy()">Fermer pgAdmin</button>
            }
          </div>
          @if (secret()) {
            <p class="pj-hint">Ce mot de passe donne accès à toutes les données de vos projets. Il se masque en quittant la page ou en changeant d'onglet ; chaque affichage est journalisé.</p>
          }
          @if (secretError(); as e) { <p class="pj-error" role="alert">{{ message(e) }}</p> }

          @if (servers().length) {
            <p class="pj-hint">pgAdmin s'ouvre dans un nouvel onglet. Il vous demandera le mot de passe de la base à la connexion au serveur (il n'y est pas enregistré) :</p>
            <ul class="pj-list">
              @for (s of servers(); track s.name) {
                <li><span class="pj-item-name">{{ s.name }}</span><span class="pj-meta"><code>{{ s.database }}</code> sur <code>{{ s.host }}</code>, rôle <code>{{ s.user }}</code></span></li>
              }
            </ul>
          }
          @if (pgNotice()) { <p class="pj-hint" role="status">{{ pgNotice() }}</p> }
          @if (pgError(); as e) { <p class="pj-error" role="alert">{{ message(e) }}</p> }
        } @else {
          <p class="pj-hint">Le mot de passe et pgAdmin ne sont proposés qu'au titulaire de la base.</p>
        }
      } @else {
        <p class="pj-hint">La base n'est pas encore provisionnée.</p>
      }
    </div>
  `,
})
export class MaBaseComponent implements OnChanges, OnDestroy {
  private engine = inject(EngineService);

  @Input() database: DatabaseInfo | null = null;
  /** Mot de passe et pgAdmin proposés : seulement pour sa propre base. */
  @Input() actions = false;
  /** `pgadmin.open` de `GET /me`, si le moteur le rend. */
  @Input() pgadminOpen: boolean | null | undefined = null;

  /** Le secret. Voir l'en-tête du fichier avant d'y toucher. */
  secret = signal<DatabasePassword | null>(null);
  revealing = signal(false);
  secretError = signal<EngineError | null>(null);
  copied = signal('');
  private hideTimer?: ReturnType<typeof setTimeout>;

  pgBusy = signal(false);
  pgOpen = signal(false);
  pgError = signal<EngineError | null>(null);
  pgNotice = signal('');
  servers = signal<PgadminServer[]>([]);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['pgadminOpen']) this.pgOpen.set(!!this.pgadminOpen);
    // Changement de compte affiché ou perte du droit d'agir : on ne garde rien.
    if (changes['actions'] || changes['database']) {
      if (!this.actions) this.hide();
    }
  }

  ngOnDestroy(): void { this.hide(); }

  @HostListener('document:visibilitychange')
  onVisibility(): void { if (document.hidden) this.hide(); }

  @HostListener('window:pagehide')
  onPageHide(): void { this.hide(); }

  reveal(): void {
    if (!this.actions || this.revealing()) return;
    this.revealing.set(true);
    this.secretError.set(null);
    this.engine.databasePassword().subscribe({
      next: s => {
        this.revealing.set(false);
        if (!this.actions) return;
        this.secret.set(s);
        clearTimeout(this.hideTimer);
        this.hideTimer = setTimeout(() => this.hide(), 120_000);
      },
      error: err => { this.revealing.set(false); this.secretError.set(toEngineError(err)); },
    });
  }

  hide(): void {
    clearTimeout(this.hideTimer);
    this.secret.set(null);
    this.copied.set('');
  }

  copy(what: string, text: string): void {
    const done = () => {
      this.copied.set(what);
      setTimeout(() => { if (this.copied() === what) this.copied.set(''); }, 2000);
    };
    navigator.clipboard?.writeText(text).then(done, () => {});
  }

  openPgadmin(): void {
    if (!this.actions || this.pgBusy()) return;
    this.pgBusy.set(true);
    this.pgError.set(null);
    this.pgNotice.set('');
    const tab = preopenTab('Ouverture de pgAdmin…');
    this.engine.pgadminOpen().subscribe({
      next: opened => {
        this.pgBusy.set(false);
        if (!isPgadminUrl(opened.url, window.location.origin)) {
          tab?.close();
          this.pgNotice.set("Le moteur a rendu une adresse de pgAdmin inattendue : elle n'a pas été ouverte.");
          return;
        }
        this.pgOpen.set(true);
        this.servers.set(opened.servers ?? []);
        if (!sendTab(tab, opened.url)) {
          this.pgNotice.set('Le navigateur a bloqué le nouvel onglet : autorisez les fenêtres surgissantes pour ce site, puis cliquez de nouveau.');
        }
      },
      error: err => { this.pgBusy.set(false); tab?.close(); this.pgError.set(toEngineError(err)); },
    });
  }

  closePgadmin(): void {
    if (this.pgBusy()) return;
    this.pgBusy.set(true);
    this.pgError.set(null);
    this.engine.pgadminClose().subscribe({
      next: () => { this.pgBusy.set(false); this.pgOpen.set(false); this.servers.set([]); this.pgNotice.set('pgAdmin fermé.'); },
      error: err => { this.pgBusy.set(false); this.pgError.set(toEngineError(err)); },
    });
  }

  /** Messages propres à I9 ; pour le reste, la phrase du moteur. */
  message(e: EngineError): string {
    switch (e.code) {
      case 'pg_trust_enabled':
        return "pgAdmin n'est pas encore disponible : il le sera une fois la base du lab verrouillée (les connexions sans mot de passe y sont encore acceptées, et un pgAdmin personnel y donnerait trop de droits). Rien à faire de votre côté.";
      case 'pgadmin_limit':
        return 'Trop de pgAdmin sont ouverts sur le lab en ce moment. Réessayez dans quelques minutes : ils se ferment seuls après 30 minutes sans activité.';
      case 'not_initialized':
        return "Votre espace n'est pas encore initialisé : revenez à l'accueil, l'initialisation s'y lance toute seule.";
      default:
        return e.detail;
    }
  }
}
