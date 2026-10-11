import { Component, ElementRef, ViewChild, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  text: string;
  confirmLabel: string;
  /** Action destructrice : bouton de confirmation en style « danger ». */
  danger?: boolean;
}

let nextId = 0;

/**
 * Demande de confirmation aux couleurs de Foyer — remplace `window.confirm`
 * (bloquable par le navigateur, hors charte). `<dialog>` natif ouvert par
 * `showModal()` : le focus y est enfermé, Échap le ferme, l'arrière-plan est
 * inerte. À la fermeture, le focus revient à l'élément d'origine ; s'il a
 * disparu ou est désactivé (ligne supprimée), à `fallback`.
 */
@Component({
  selector: 'app-confirm',
  standalone: true,
  template: `
    <dialog #dlg class="pj-dialog" [attr.aria-labelledby]="titleId" (close)="onClosed()" (click)="onBackdrop($event)">
      @if (request(); as r) {
        <div class="pj-dialog-body">
          <h3 [id]="titleId">{{ r.title }}</h3>
          <p>{{ r.text }}</p>
          <div class="pj-row pj-dialog-actions">
            <button type="button" class="btn-secondary" (click)="close()">Annuler</button>
            <button type="button" [class]="r.danger ? 'pj-danger' : 'btn-primary'" (click)="confirm()">{{ r.confirmLabel }}</button>
          </div>
        </div>
      }
    </dialog>
  `,
})
export class ConfirmDialogComponent {
  @ViewChild('dlg') private dlg?: ElementRef<HTMLDialogElement>;
  readonly titleId = `pj-confirm-${nextId++}`;
  request = signal<ConfirmRequest | null>(null);

  private origin: HTMLElement | null = null;
  private fallback: HTMLElement | null = null;
  private onConfirm: (() => void) | null = null;
  private confirmed = false;

  ask(request: ConfirmRequest, origin: HTMLElement, onConfirm: () => void, fallback?: HTMLElement | null): void {
    const dialog = this.dlg?.nativeElement;
    if (!dialog || dialog.open) return;
    this.request.set(request);
    this.origin = origin;
    this.fallback = fallback ?? null;
    this.onConfirm = onConfirm;
    this.confirmed = false;
    dialog.showModal();
  }

  close(): void {
    const dialog = this.dlg?.nativeElement;
    if (dialog?.open) dialog.close();
  }

  confirm(): void {
    this.confirmed = true;
    this.close();
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === this.dlg?.nativeElement) this.close();
  }

  /** Fermeture par bouton, Échap ou clic hors du cadre. */
  onClosed(): void {
    const { origin, fallback, onConfirm, confirmed } = this;
    this.origin = this.fallback = this.onConfirm = null;
    this.request.set(null);
    if (confirmed) onConfirm?.();
    // Après l'action : le bouton d'origine peut avoir disparu ou être désactivé.
    setTimeout(() => {
      if (origin?.isConnected && !(origin as HTMLButtonElement).disabled) origin.focus();
      else fallback?.focus();
    }, confirmed ? 250 : 0);
  }
}
