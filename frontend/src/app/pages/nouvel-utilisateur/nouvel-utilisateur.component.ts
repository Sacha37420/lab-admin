import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

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

interface EnvWindow { __env?: { apiUrl?: string } }

@Component({
  selector: 'app-nouvel-utilisateur',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './nouvel-utilisateur.component.html',
  styleUrl: './nouvel-utilisateur.component.scss',
})
export class NouvelUtilisateurComponent implements OnInit {
  private http = inject(HttpClient);

  private get apiUrl(): string {
    return (window as unknown as EnvWindow).__env?.apiUrl ?? 'http://localhost:8083';
  }

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
  result = signal<CreateUserResult | null>(null);

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
        this.result.set(res);
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
    this.result.set(null);
    this.submitError.set('');
  }

  copyPassword(): void {
    const pwd = this.result()?.password;
    if (pwd) navigator.clipboard.writeText(pwd);
  }
}
