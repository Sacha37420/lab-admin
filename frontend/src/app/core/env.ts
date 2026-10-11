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
  codeServerUrl?: string;
}

export function labEnv(): LabEnv {
  return (window as unknown as { __env?: LabEnv }).__env ?? {};
}

/** Base de l'API de lab-admin lui-même (pages d'administration). */
export function apiUrl(): string {
  return labEnv().apiUrl ?? 'http://localhost:8083';
}
