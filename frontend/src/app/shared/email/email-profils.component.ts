import { Component, ElementRef, Input, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EngineService } from '../../core/engine.service';
import { KeycloakService } from '../../core/keycloak.service';
import { SmtpStaleService } from '../../core/smtp-stale.service';
import {
  EngineError, SMTP_DEFAULT_PORT, SmtpInput, SmtpProfile, SmtpSecurity, smtpBody, smtpProblems, toEngineError,
} from '../../core/engine.client';

const SECURITY_LABELS: Record<SmtpSecurity, string> = {
  starttls: 'STARTTLS (587, recommandé)',
  ssl: 'SSL/TLS (465)',
  none: 'Aucune — serveur sans authentification',
};

function emptyForm(): SmtpInput {
  return { label: '', host: '', port: SMTP_DEFAULT_PORT.starttls, security: 'starttls', username: '', from_email: '', password: '' };
}

/**
 * Carte « Email » de la page Services (contrat multi-dev I6/I10 v9) : les
 * comptes d'envoi d'email du développeur. Il les définit librement — aucun
 * n'est proposé ni prérempli.
 *
 * Le mot de passe est EN ÉCRITURE SEULE : il va du champ au moteur et n'en
 * revient jamais. Il n'est lu dans aucune réponse, il est vidé dès l'envoi du
 * formulaire (réussi ou non), et ne touche ni le stockage du navigateur ni une
 * URL. La liste ne dit que « enregistré » ou « aucun », sans longueur.
 */
@Component({
  selector: 'app-email-profils',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './email-profils.component.html',
})
export class EmailProfilsComponent implements OnInit {
  private engine = inject(EngineService);
  private stale = inject(SmtpStaleService);
  protected kc = inject(KeycloakService);

  /** Sans cadre ni titre : le parent fournit la carte (page Services). */
  @Input() bare = false;

  readonly securities: SmtpSecurity[] = ['starttls', 'ssl', 'none'];
  readonly securityLabel = (s: SmtpSecurity) => SECURITY_LABELS[s] ?? s;
  readonly max = 10;

  loading = signal(true);
  /** Le moteur en service n'a pas encore ces routes. */
  unavailable = signal(false);
  loadError = signal('');
  profiles = signal<SmtpProfile[]>([]);

  // Formulaire (ajout ou modification)
  formOpen = signal(false);
  editing = signal<SmtpProfile | null>(null);
  form: SmtpInput = emptyForm();
  /** Le port a été saisi à la main : changer de sécurité ne l'écrase plus. */
  private portTouched = false;
  saving = signal(false);
  problems = signal<string[]>([]);
  saveError = signal<EngineError | null>(null);
  notice = signal('');
  staleAfterSave = signal<string[]>([]);

  // Actions sur une ligne
  busyId = signal('');
  rowError = signal<{ id: string; error: EngineError } | null>(null);
  rowNotice = signal<{ id: string; text: string } | null>(null);

  ngOnInit(): void { this.load(); }

  load(): void {
    this.engine.smtpList().subscribe({
      next: r => { this.profiles.set(r.profiles ?? []); this.loading.set(false); this.unavailable.set(false); },
      error: err => {
        const e = toEngineError(err);
        this.loading.set(false);
        if (e.code === 'no_engine') this.unavailable.set(true); else this.loadError.set(e.detail);
      },
    });
  }

  // ── Formulaire ─────────────────────────────────────────────────────────────

  add(): void {
    this.editing.set(null);
    this.form = emptyForm();
    this.portTouched = false;
    this.openForm();
  }

  edit(p: SmtpProfile): void {
    this.editing.set(p);
    // Le mot de passe n'est jamais relu : le champ repart vide (= inchangé).
    this.form = { label: p.label, host: p.host, port: p.port, security: p.security, username: p.username, from_email: p.from_email, password: '' };
    this.portTouched = p.port !== SMTP_DEFAULT_PORT[p.security];
    this.openForm();
  }

  private openForm(): void {
    this.problems.set([]); this.saveError.set(null); this.notice.set(''); this.staleAfterSave.set([]);
    this.formOpen.set(true);
  }

  cancel(): void {
    this.form = emptyForm();
    this.formOpen.set(false);
    this.editing.set(null);
  }

  onPort(value: number | string): void {
    this.form.port = Number(value);
    this.portTouched = true;
  }

  onSecurity(value: SmtpSecurity): void {
    this.form.security = value;
    if (!this.portTouched) this.form.port = SMTP_DEFAULT_PORT[value];
    if (value === 'none') { this.form.username = ''; this.form.password = ''; }
  }

  save(): void {
    if (this.saving()) return;
    const problems = smtpProblems(this.form);
    this.problems.set(problems);
    if (problems.length) return;
    const body = smtpBody(this.form);
    const current = this.editing();
    this.saving.set(true);
    this.saveError.set(null);
    // Vidé dès l'envoi, que le moteur accepte ou refuse.
    this.form.password = '';
    (current ? this.engine.smtpUpdate(current.id, body) : this.engine.smtpCreate(body)).subscribe({
      next: saved => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.editing.set(null);
        this.form = emptyForm();
        this.notice.set(current ? `Compte d'envoi « ${saved.label} » modifié.` : `Compte d'envoi « ${saved.label} » ajouté.`);
        const stale = saved.stale_projects ?? [];
        this.staleAfterSave.set(stale);
        this.stale.mark(stale, saved.label);
        this.load();
      },
      error: err => { this.saving.set(false); this.saveError.set(toEngineError(err)); },
    });
  }

  // ── Lignes ─────────────────────────────────────────────────────────────────

  // ── Email d'essai : annonce AVANT l'envoi, dans un dialogue de l'app ───────
  // <dialog> natif ouvert par showModal() : le focus y est enfermé, Échap le
  // ferme, l'arrière-plan est inerte. Pas de window.confirm (bloquable, hors charte).

  @ViewChild('testDialog') private testDialog?: ElementRef<HTMLDialogElement>;
  /** Le profil concerné, et ce qu'on s'apprête à faire : envoyer l'essai ou supprimer. */
  testTarget = signal<SmtpProfile | null>(null);
  dialogMode = signal<'test' | 'delete'>('test');
  private testOrigin: HTMLElement | null = null;

  askDelete(p: SmtpProfile, origin: HTMLElement): void { this.ask('delete', p, origin); }
  askTest(p: SmtpProfile, origin: HTMLElement): void { this.ask('test', p, origin); }

  private ask(mode: 'test' | 'delete', p: SmtpProfile, origin: HTMLElement): void {
    if (this.busyId()) return;
    this.dialogMode.set(mode);
    this.testTarget.set(p);
    this.testOrigin = origin;
    const dialog = this.testDialog?.nativeElement;
    if (dialog && !dialog.open) dialog.showModal();
  }

  /** Fermeture par bouton, Échap ou clic hors du cadre : le focus revient au bouton d'origine. */
  closeTest(): void {
    const dialog = this.testDialog?.nativeElement;
    if (dialog?.open) dialog.close();
  }

  onTestClosed(): void {
    this.testTarget.set(null);
    // Après une confirmation, le bouton d'origine est désactivé le temps de
    // l'appel : le focus lui est rendu à la fin (refocus), pas ici.
    if (this.keepOrigin) { this.keepOrigin = false; return; }
    this.refocus();
  }

  private keepOrigin = false;
  @ViewChild('cardRoot') private cardRoot?: ElementRef<HTMLElement>;

  /** Rend le focus au bouton d'origine ; s'il a disparu (profil supprimé), à la carte. */
  private refocus(): void {
    const origin = this.testOrigin;
    this.testOrigin = null;
    setTimeout(() => {
      if (origin?.isConnected && !(origin as HTMLButtonElement).disabled) origin.focus();
      else this.cardRoot?.nativeElement.focus();
    });
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === this.testDialog?.nativeElement) this.closeTest();
  }

  confirmTest(): void {
    const p = this.testTarget();
    if (!p || this.busyId()) { this.closeTest(); return; }
    this.keepOrigin = true;
    this.closeTest();
    this.busyId.set(p.id);
    this.rowError.set(null); this.rowNotice.set(null);
    this.engine.smtpTest(p.id).subscribe({
      next: r => { this.busyId.set(''); this.rowNotice.set({ id: p.id, text: `Email d'essai envoyé à ${r.to}. Vérifiez votre boîte (et les indésirables).` }); this.refocus(); },
      error: err => { this.busyId.set(''); this.rowError.set({ id: p.id, error: toEngineError(err) }); this.refocus(); },
    });
  }

  confirmDelete(): void {
    const p = this.testTarget();
    if (!p || this.busyId()) { this.closeTest(); return; }
    this.keepOrigin = true;
    this.closeTest();
    this.busyId.set(p.id);
    this.rowError.set(null); this.rowNotice.set(null);
    this.engine.smtpDelete(p.id).subscribe({
      next: () => { this.busyId.set(''); this.notice.set(`Compte d'envoi « ${p.label} » supprimé.`); this.testOrigin = null; this.load(); this.refocus(); },
      error: err => { this.busyId.set(''); this.rowError.set({ id: p.id, error: toEngineError(err) }); this.refocus(); },
    });
  }

  rowMessage(e: EngineError): string {
    switch (e.code) {
      case 'smtp_in_use':
        return `Ce compte d'envoi est utilisé par ${e.projects.length ? e.projects.join(', ') : 'un ou plusieurs projets'} : détachez-le d'abord, sur la page de chaque projet.`;
      case 'smtp_error': return `Le serveur d'envoi a refusé : ${e.detail}`;
      case 'rate_limited': return "Un essai vient d'être fait : attendez 30 secondes avant le suivant.";
      case 'no_engine': return "Cette fonction n'est pas encore disponible sur le lab.";
      default: return e.detail;
    }
  }
}
