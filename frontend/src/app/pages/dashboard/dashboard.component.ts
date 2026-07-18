import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';

interface AppSpec {
  id: number;
  name: string;
  description: string;
  updated_at: string;
  data_models: unknown[];
  endpoint_groups: unknown[];
  pages: unknown[];
}

interface EnvWindow { __env?: { apiUrl?: string; appBuilderUrl?: string; codeServerUrl?: string } }

function env() { return (window as unknown as EnvWindow).__env ?? {}; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private http = inject(HttpClient);

  specs   = signal<AppSpec[]>([]);
  loading = signal(true);
  error   = signal('');

  get appBuilderUrl() { const u = env().appBuilderUrl ?? 'http://localhost:4205'; return u.endsWith('/') ? u : u + '/'; }
  get codeServerUrl() { const u = env().codeServerUrl ?? 'http://localhost:8091'; return u.endsWith('/') ? u : u + '/'; }
  get apiUrl() { return env().apiUrl ?? 'http://localhost:8083'; }

  ngOnInit() {
    // Lu directement depuis le backend de lab-admin (catalogue app-builder en
    // lecture seule cross-schema) — plus d'appel HTTP à app-builder.
    this.http.get<AppSpec[]>(`${this.apiUrl}/api/apps/public/`).subscribe({
      next:  specs => { this.specs.set(specs); this.loading.set(false); },
      error: ()    => { this.error.set("Impossible de charger le catalogue des apps"); this.loading.set(false); },
    });
  }

  timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60)  return `il y a ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `il y a ${h} h`;
    return `il y a ${Math.floor(h / 24)} j`;
  }
}
