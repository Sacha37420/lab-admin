import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { apiUrl } from '../../core/env';

interface LabGroup { id: string; name: string; required_by: string[] }
interface AppRequirement { name: string; required_groups: string[] }
interface GroupsResponse { groups: LabGroup[]; apps: AppRequirement[] }

interface CreateUserResult {
  username: string;
  email: string;
  groups: string[];
  failed_groups: string[];
  base_url: string;
  password: string;
  email_sent: boolean;
  email_error: string | null;
}


@Component({
  selector: 'app-nouvel-utilisateur',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './nouvel-utilisateur.component.html',
  styleUrl: './nouvel-utilisateur.component.scss',
})
export class NouvelUtilisateurComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);

  private get apiUrl(): string { return apiUrl(); }

  // ── Groupes ──────────────────────────────────────────────────────────────
  groups     = signal<LabGroup[]>([]);
  apps       = signal<AppRequirement[]>([]);
  groupsLoading = signal(true);
  groupsError   = signal('');

  // ── Formulaire ───────────────────────────────────────────────────────────
  username  = signal('');
  firstName = signal('');
  lastName  = signal('');
  email     = signal('');
  selectedGroups = signal<Set<string>>(new Set());

  // ── Soumission ───────────────────────────────────────────────────────────
  submitting = signal(false);
  submitError = signal('');
  /** Le récapitulatif — SANS le mot de passe, tenu à part ci-dessous. */
  result = signal<Omit<CreateUserResult, 'password'> | null>(null);

  // ── Mot de passe du compte créé : même politique que « Ma base » ──────────
  // Gardé dans ce composant seulement, masqué par défaut, affiché à la demande,
  // remasqué après 2 min et au changement d'onglet, effacé en quittant la page.
  // Jamais dans le stockage du navigateur ni dans une URL.
  password = signal('');
  shown = signal(false);
  copied = signal(false);
  private hideTimer?: ReturnType<typeof setTimeout>;

  show(): void {
    if (!this.password()) return;
    this.shown.set(true);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), 120_000);
  }

  hide(): void {
    clearTimeout(this.hideTimer);
    this.shown.set(false);
  }

  private forget(): void {
    this.hide();
    this.password.set('');
    this.copied.set(false);
  }

  @HostListener('document:visibilitychange')
  onVisibility(): void { if (document.hidden) this.hide(); }

  @HostListener('window:pagehide')
  onPageHide(): void { this.forget(); }

  ngOnDestroy(): void { this.forget(); }

  formValid = computed(() =>
    this.username().trim().length > 0 &&
    this.firstName().trim().length > 0 &&
    this.lastName().trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email().trim())
  );

  ngOnInit(): void {
    this.http.get<GroupsResponse>(`${this.apiUrl}/api/lab-users/groups/`).subscribe({
      next: res => {
        this.groups.set(res.groups ?? []);
        this.apps.set(res.apps ?? []);
        this.groupsLoading.set(false);
      },
      error: () => {
        this.groupsError.set('Impossible de charger la liste des groupes.');
        this.groupsLoading.set(false);
      },
    });
  }

  toggleGroup(name: string): void {
    const next = new Set(this.selectedGroups());
    next.has(name) ? next.delete(name) : next.add(name);
    this.selectedGroups.set(next);
  }

  isSelected(name: string): boolean {
    return this.selectedGroups().has(name);
  }

  submit(): void {
    if (!this.formValid() || this.submitting()) return;
    this.submitting.set(true);
    this.submitError.set('');

    this.http.post<CreateUserResult>(`${this.apiUrl}/api/lab-users/`, {
      username: this.username().trim(),
      first_name: this.firstName().trim(),
      last_name: this.lastName().trim(),
      email: this.email().trim(),
      groups: [...this.selectedGroups()],
    }).subscribe({
      next: res => {
        const { password, ...summary } = res;
        this.password.set(password ?? '');
        this.shown.set(false);
        this.result.set(summary);
        this.submitting.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.submitError.set(err.error?.error ?? "Erreur lors de la création de l'utilisateur.");
        this.submitting.set(false);
      },
    });
  }

  reset(): void {
    this.username.set('');
    this.firstName.set('');
    this.lastName.set('');
    this.email.set('');
    this.selectedGroups.set(new Set());
    this.forget();
    this.result.set(null);
    this.submitError.set('');
  }

  /** Copie sans afficher. */
  copyPassword(): void {
    const pwd = this.password();
    if (!pwd) return;
    navigator.clipboard?.writeText(pwd).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }, () => {});
  }
}
