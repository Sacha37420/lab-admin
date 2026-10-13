/**
 * Configuration injectée au démarrage du conteneur (`assets/env.js`, écrit par
 * `nginx-entrypoint.sh`). UN SEUL endroit lit `window.__env`.
 */
export interface LabEnv {
  keycloakUrl?: string;
  keycloakRealm?: string;
  keycloakClientId?: string;
  appUrl?: string;
  apiUrl?: string;
  engineUrl?: string;
  storageUrl?: string;
  oauthHubUrl?: string;
  appBuilderUrl?: string;
  /** API d'App Builder (chantier app-builder-lab, I3). Absente : pas de bloc « Mes spécifications ». */
  appBuilderApiUrl?: string;
  codeServerUrl?: string;
}

export function labEnv(): LabEnv {
  return (window as unknown as { __env?: LabEnv }).__env ?? {};
}

/** Base de l'API de lab-admin lui-même (pages d'administration). */
export function apiUrl(): string {
  return labEnv().apiUrl ?? 'http://localhost:8083';
}

/** Base de l'API web du moteur (`/mcp/api`), sans barre finale. */
export function engineUrl(): string {
  return (labEnv().engineUrl ?? `${window.location.origin}/mcp/api`).replace(/\/+$/, '');
}

/** Base de l'API d'App Builder, sans barre finale ; `null` si elle n'est pas configurée. */
export function appBuilderApiUrl(): string | null {
  const url = labEnv().appBuilderApiUrl;
  return typeof url === 'string' && url.trim() ? url.trim().replace(/\/+$/, '') : null;
}

/**
 * Les SEULES adresses auxquelles le jeton de l'utilisateur est joint
 * (`auth.interceptor.ts`, `token-scope.ts`) : l'API de lab-admin, le moteur,
 * l'API de remise d'App Builder si elle est configurée.
 */
export function tokenBases(): string[] {
  const bases = [apiUrl(), engineUrl()];
  const builder = appBuilderApiUrl();
  // Seulement l'API de remise : c'est la seule partie d'App Builder qui accepte ce jeton.
  if (builder) bases.push(`${builder}/api/handoff`);
  return bases;
}
