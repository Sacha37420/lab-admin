import { Injectable } from '@angular/core';
import Keycloak from 'keycloak-js';
import { loginRedirectUri } from './redirect-uri';
import { labEnv } from './env';

@Injectable({ providedIn: 'root' })
export class KeycloakService {
  private kc!: Keycloak;
  private baseUrl = '';
  private realm = 'ssolab';

  /** Page « Mon compte » de Keycloak (mot de passe, sessions) — ouverte à tout compte du realm. */
  get accountUrl(): string {
    return this.baseUrl ? `${this.baseUrl}/realms/${encodeURIComponent(this.realm)}/account/` : '';
  }

  /**
   * Initialise Keycloak avec login-required.
   * Si l'utilisateur n'est pas connecté, le navigateur est redirigé vers la page de login.
   * La promesse ne se résout qu'une fois l'utilisateur authentifié.
   */
  async init(): Promise<boolean> {
    const env = labEnv();

    this.baseUrl = (env.keycloakUrl ?? (window.location.protocol + '//' + window.location.hostname + ':8080')).replace(/\/+$/, '');
    this.realm = env.keycloakRealm ?? 'ssolab';
    this.kc = new Keycloak({
      url:      env.keycloakUrl      ?? (window.location.protocol + '//' + window.location.hostname + ':8080'),
      realm:    env.keycloakRealm    ?? 'ssolab',
      clientId: env.keycloakClientId ?? 'lab-admin',
    });

    // La page demandée, pas l'accueil : voir core/redirect-uri.ts.
    const redirectUri = loginRedirectUri(window.location.href, env.appUrl, window.location.origin);

    return this.kc.init({
      onLoad:           'login-required',
      checkLoginIframe: false,
      redirectUri,
    });
  }

  get username(): string {
    return (this.kc?.tokenParsed as Record<string, unknown>)?.['preferred_username'] as string ?? '';
  }

  get email(): string {
    return (this.kc?.tokenParsed as Record<string, unknown>)?.['email'] as string ?? '';
  }

  /** Groupes LDAP/Keycloak de l'utilisateur (claim 'groups' dans le token). */
  get groups(): string[] {
    return (this.kc?.tokenParsed as Record<string, unknown>)?.['groups'] as string[] ?? [];
  }

  /**
   * Administrateur du lab (groupe `admins`). Depuis l'ouverture de lab-admin
   * au groupe `developers`, être entré ne suffit plus : les pages
   * d'administration et les blocs d'administration des pages communes restent
   * réservés aux admins — le backend applique la même règle par vue
   * (api/permissions.py), ceci n'est que l'affichage.
   */
  get isAdmin(): boolean {
    return this.groups.includes('admins');
  }

  /** Token d'accès courant (Bearer). */
  getToken(): string | undefined {
    return this.kc?.token;
  }

  /** Vérifie si le token expire dans moins de minValidity secondes (synchrone). */
  isTokenExpired(minValidity = 0): boolean {
    return this.kc?.isTokenExpired(minValidity) ?? true;
  }

  /**
   * Renouvelle le token si sa validité restante est inférieure à minValidity secondes.
   * Retourne true si le token a été renouvelé, false sinon.
   */
  async updateToken(minValidity: number): Promise<boolean> {
    try {
      return await this.kc.updateToken(minValidity);
    } catch {
      return false;
    }
  }

  logout(): void {
    this.kc.logout({ redirectUri: window.location.origin });
  }
}
