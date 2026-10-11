import { Component, inject, signal, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { apiUrl } from '../../core/env';

interface HostedApp {
  name: string;
  /** Nom lisible depuis .app-descriptions ; retombe sur `name` si l'app n'y figure pas. */
  label: string;
  /** Vide pour une app absente de .app-descriptions (donc hors vitrine publique). */
  description: string;
  backend_port: number | null;
  frontend_port: number | null;
  frontend_url: string | null;
  backend_url: string | null;
}

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

  ngOnInit(): void {
    this.http.get<{ apps: HostedApp[] }>(`${apiUrl()}/api/infrastructure/`).subscribe({
      next:  res => { this.apps.set(res.apps ?? []); this.loading.set(false); },
      error: ()  => { this.error.set('Impossible de charger la liste des apps.'); this.loading.set(false); },
    });
  }
}
