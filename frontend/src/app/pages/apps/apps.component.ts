import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';

interface AppSpec {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  data_models: unknown[];
  endpoint_groups: unknown[];
  pages: unknown[];
}

interface EnvWindow { __env?: { apiUrl?: string; appBuilderUrl?: string } }
function env() { return (window as unknown as EnvWindow).__env ?? {}; }

@Component({
  selector: 'app-apps',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './apps.component.html',
  styleUrl: './apps.component.scss',
})
export class AppsComponent implements OnInit {
  private http = inject(HttpClient);

  specs   = signal<AppSpec[]>([]);
  loading = signal(true);
  error   = signal('');
  search  = signal('');

  filtered = computed(() => {
    const q = this.search().toLowerCase();
    return this.specs().filter(s => !q || s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q));
  });

  get appBuilderUrl() { const u = env().appBuilderUrl ?? 'http://localhost:4205'; return u.endsWith('/') ? u : u + '/'; }
  get apiUrl() { return env().apiUrl ?? 'http://localhost:8083'; }

  ngOnInit() {
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
