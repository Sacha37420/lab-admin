import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { KeycloakService } from '../../core/keycloak.service';
import { apiUrl, labEnv } from '../../core/env';
import { DATE_FORMAT } from '../../core/format';

interface AppSpec {
  id: number;
  name: string;
  description: string;
  updated_at: string;
  data_models: unknown[];
  endpoint_groups: unknown[];
  pages: unknown[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private http = inject(HttpClient);
  protected kc = inject(KeycloakService);

  specs   = signal<AppSpec[]>([]);
  loading = signal(true);
  error   = signal('');

  readonly dateFormat = DATE_FORMAT;

  get appBuilderUrl(): string { const u = labEnv().appBuilderUrl ?? 'http://localhost:4205'; return u.endsWith('/') ? u : u + '/'; }

  ngOnInit() {
    // Le catalogue app-builder est une vue d'admin : un développeur non-admin
    // n'en voit rien (et l'API lui répondrait 403).
    if (!this.kc.isAdmin) { this.loading.set(false); return; }
    // Lu directement depuis le backend de lab-admin (catalogue app-builder en
    // lecture seule cross-schema) — plus d'appel HTTP à app-builder.
    this.http.get<AppSpec[]>(`${apiUrl()}/api/apps/public/`).subscribe({
      next:  specs => { this.specs.set(specs); this.loading.set(false); },
      error: ()    => { this.error.set("Impossible de charger le catalogue des apps"); this.loading.set(false); },
    });
  }
}
