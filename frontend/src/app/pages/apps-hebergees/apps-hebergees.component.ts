import { Component, inject, signal, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

interface HostedApp {
  name: string;
  backend_port: number | null;
  frontend_port: number | null;
  frontend_url: string | null;
  backend_url: string | null;
}
interface EnvWindow { __env?: { apiUrl?: string } }

@Component({
  selector: 'app-apps-hebergees',
  standalone: true,
  templateUrl: './apps-hebergees.component.html',
})
export class AppsHebergeesComponent implements OnInit {
  private http = inject(HttpClient);

  apps    = signal<HostedApp[]>([]);
  loading = signal(true);
  error   = signal('');

  private get apiUrl(): string {
    return (window as unknown as EnvWindow).__env?.apiUrl ?? 'http://localhost:8083';
  }

  ngOnInit(): void {
    this.http.get<{ apps: HostedApp[] }>(`${this.apiUrl}/api/infrastructure/`).subscribe({
      next:  res => { this.apps.set(res.apps ?? []); this.loading.set(false); },
      error: ()  => { this.error.set('Impossible de charger la liste des apps.'); this.loading.set(false); },
    });
  }

  hasUrl(app: HostedApp): boolean {
    return !!(app.frontend_url || app.backend_url);
  }
}
