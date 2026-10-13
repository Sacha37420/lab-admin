import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EngineClient, EngineRequest } from './engine.client';
import { engineUrl, labEnv } from './env';

/**
 * Moteur du lab vu d'Angular : `EngineClient` (toutes les routes, tous les
 * types — `engine.client.ts`) branché sur `HttpClient`. Même origine que
 * lab-admin ; le jeton de l'utilisateur est posé par `authInterceptor`.
 * lab-admin n'a aucun privilège propre ici : c'est le moteur qui contrôle.
 */
@Injectable({ providedIn: 'root' })
export class EngineService extends EngineClient {
  constructor() {
    const http = inject(HttpClient);
    const base = engineUrl();
    super((req: EngineRequest) =>
      http.request<unknown>(req.method, `${base}${req.path}`, { body: req.body, params: req.params }));
  }

  /** Interface de `storage` (fichiers de l'utilisateur) — même origine, chemin Caddy `/storage/`. */
  get storageUrl(): string {
    return labEnv().storageUrl ?? `${window.location.origin}/storage/`;
  }

  /** Interface d'`oauth-hub` — repli quand le moteur n'a pas répondu (`me.oauth_hub_url` fait foi). */
  get oauthHubUrl(): string {
    return labEnv().oauthHubUrl ?? `${window.location.origin}/oauth-hub/`;
  }
}
