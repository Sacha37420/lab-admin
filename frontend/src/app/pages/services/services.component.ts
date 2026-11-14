import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EngineService } from '../../core/engine.service';
import { KeycloakService } from '../../core/keycloak.service';
import { EngineError, Me, Profile, profileOf, toEngineError } from '../../core/engine.client';
import { RouterLink } from '@angular/router';
import { apiUrl, labEnv } from '../../core/env';
import { MaBaseComponent } from '../../shared/ma-base/ma-base.component';
import { EmailProfilsComponent } from '../../shared/email/email-profils.component';

interface Tool { name: string; url: string; description: string }
/** pgAdmin et phpLDAPadmin : liés à la boucle locale de l'hôte, on y entre par tunnel SSH. */
interface Tunnel { command: string; text: string; urls: Record<string, string> }

/**
 * Services du lab (contrat multi-dev I6 v10) : UNE page, qui a absorbé l'ancienne
 * page « Outils » et en reprend le graphisme (classes `.env-card`,
 * `.services-grid`, `.service-card` de styles.scss — la référence visuelle).
 * Règle : un service qu'on ne peut pas ouvrir N'EST PAS AFFICHÉ.
 *
 * - tout le monde (admins et developers) : Mon compte, Storage, OAuth Hub ;
 * - développeur initialisé : Ma base + pgAdmin personnel, Email, MCP ;
 * - admins : toutes les entrées de l'ancienne page Outils, telles que
 *   `GET /api/tools/` les rend (appelé pour eux SEULEMENT), plus l'éditeur du lab ;
 *   pgAdmin et phpLDAPadmin n'ont plus de carte : indication de tunnel SSH (même réponse).
 */
@Component({
  selector: 'app-services',
  standalone: true,
  imports: [RouterLink, MaBaseComponent, EmailProfilsComponent],
  templateUrl: './services.component.html',
})
export class ServicesComponent implements OnInit {
  protected engine = inject(EngineService);
  protected kc = inject(KeycloakService);
  private http = inject(HttpClient);

  me = signal<Me | null>(null);
  /** Le moteur n'a pas répondu : les cartes de développeur manquent, on dit pourquoi. */
  engineDown = signal<EngineError | null>(null);
  profile = signal<Profile | null>(null);
  tools = signal<Tool[]>([]);
  tunnel = signal<Tunnel | null>(null);
  copied = signal(false);

  isDev = computed(() => (this.profile() === 'dev' || this.profile() === 'superuser') && !!this.me()?.initialized);
  oauthHubUrl = computed(() => this.me()?.oauth_hub_url || this.engine.oauthHubUrl);
  mcpCommand = computed(() => {
    const url = this.me()?.mcp_url;
    return url ? `claude mcp add --transport http --client-id lab-mcp --callback-port 8976 lab ${url}` : '';
  });
  /** Compte éligible dont l'initialisation n'a pas encore eu lieu (elle se fait sur l'accueil). */
  needsInit = computed(() => (this.profile() === 'dev' || this.profile() === 'superuser') && !this.me()?.initialized);
  codeUrl = labEnv().codeServerUrl || '';

  ngOnInit(): void {
    // Sans réponse du moteur : seules les cartes qui dépendent de lui manquent.
    this.engine.me().subscribe({
      next: me => { this.me.set(me); this.profile.set(profileOf(me, this.kc.isAdmin)); },
      error: err => { this.me.set(null); this.engineDown.set(toEngineError(err)); },
    });
    if (this.kc.isAdmin) {
      this.http.get<{ tools: Tool[]; tunnel?: Tunnel }>(`${apiUrl()}/api/tools/`).subscribe({
        next: r => { this.tools.set(r.tools ?? []); this.tunnel.set(r.tunnel ?? null); },
        error: () => { this.tools.set([]); this.tunnel.set(null); },
      });
    }
  }

  copyCommand(): void {
    navigator.clipboard?.writeText(this.mcpCommand()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }, () => {});
  }
}
