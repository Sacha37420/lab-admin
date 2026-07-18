import { Component, inject, signal, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

interface Tool { name: string; url: string; description: string }
interface EnvWindow { __env?: { apiUrl?: string } }

@Component({
  selector: 'app-outils',
  standalone: true,
  templateUrl: './outils.component.html',
})
export class OutilsComponent implements OnInit {
  private http = inject(HttpClient);

  tools   = signal<Tool[]>([]);
  loading = signal(true);
  error   = signal('');

  private get apiUrl(): string {
    return (window as unknown as EnvWindow).__env?.apiUrl ?? 'http://localhost:8083';
  }

  ngOnInit(): void {
    this.http.get<{ tools: Tool[] }>(`${this.apiUrl}/api/tools/`).subscribe({
      next:  res => { this.tools.set(res.tools ?? []); this.loading.set(false); },
      error: ()  => { this.error.set('Impossible de charger la liste des outils.'); this.loading.set(false); },
    });
  }
}
