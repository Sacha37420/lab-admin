import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EngineService } from '../../core/engine.service';
import { KeycloakService } from '../../core/keycloak.service';
import { Me, Profile, profileOf } from '../../core/engine.client';
import { MaBaseComponent } from '../../shared/ma-base/ma-base.component';

interface Tool { name: string; url: string; description: string }
interface EnvWindow { __env?: { apiUrl?: string; codeServerUrl?: string } }

/**
 * Services du lab (contrat multi-dev I6 v8) : une carte par service, avec ce
 * qu'il sert et son accès. Règle de la page : un service qu'on ne peut pas
 * ouvrir N'EST PAS AFFICHÉ, plutôt qu'affiché en erreur.
 *
 * - tout le monde (admins et developers) : Mon compte, Storage, OAuth Hub —
 *   ces deux apps admettent les deux groupes qui entrent dans lab-admin ;
 * - développeur initialisé : Ma base + pgAdmin personnel, MCP ;
 * - admins : console Keycloak, pgAdmin partagé, annuaire, éditeur du cadriciel
 *   (`GET /api/tools/` n'est appelé QUE pour eux : il leur est réservé).
 */
@Component({
  selector: 'app-services',
  standalone: true,
  imports: [MaBaseComponent],
  templateUrl: './services.component.html',
})
export class ServicesComponent implements OnInit {
  protected engine = inject(EngineService);
  protected kc = inject(KeycloakService);
  private http = inject(HttpClient);

  me = signal<Me | null>(null);
  profile = signal<Profile | null>(null);
  tools = signal<Tool[]>([]);
  copied = signal(false);

  isDev = computed(() => (this.profile() === 'dev' || this.profile() === 'superuser') && !!this.me()?.initialized);
  oauthHubUrl = computed(() => this.me()?.oauth_hub_url || this.engine.oauthHubUrl);
  mcpCommand = computed(() => {
    const url = this.me()?.mcp_url;
    return url ? `claude mcp add --transport http --client-id lab-mcp --callback-port 8976 lab ${url}` : '';
  });
  codeUrl = (window as unknown as EnvWindow).__env?.codeServerUrl || '';

  ngOnInit(): void {
    // Sans réponse du moteur : seules les cartes qui dépendent de lui manquent.
    this.engine.me().subscribe({
      next: me => { this.me.set(me); this.profile.set(profileOf(me, this.kc.isAdmin)); },
      error: () => this.me.set(null),
    });
    if (this.kc.isAdmin) {
      const api = (window as unknown as EnvWindow).__env?.apiUrl ?? 'http://localhost:8083';
      this.http.get<{ tools: Tool[] }>(`${api}/api/tools/`).subscribe({
        next: r => this.tools.set(r.tools ?? []),
        error: () => this.tools.set([]),
      });
    }
  }

  tool(name: string): Tool | null {
    return this.tools().find(t => t.name === name) ?? null;
  }

  copyCommand(): void {
    navigator.clipboard?.writeText(this.mcpCommand()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }, () => {});
  }
}
