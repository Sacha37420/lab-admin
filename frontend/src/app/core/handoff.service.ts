import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { throwError } from 'rxjs';
import { HandoffClient, NOT_CONFIGURED } from './handoff.client';
import { appBuilderApiUrl, labEnv } from './env';

/**
 * API de remise d'App Builder vue d'Angular : `HandoffClient` branché sur
 * `HttpClient`. Le jeton de l'utilisateur est posé par `authInterceptor`, qui
 * ne le joint qu'aux adresses de `tokenBases()` — dont celle-ci.
 * Sans `appBuilderApiUrl` dans la configuration, aucun appel ne part.
 */
@Injectable({ providedIn: 'root' })
export class HandoffService extends HandoffClient {
  constructor() {
    const http = inject(HttpClient);
    const base = appBuilderApiUrl();
    super(path => base ? http.get<unknown>(`${base}${path}`) : throwError(() => NOT_CONFIGURED));
  }

  /** Interface d'App Builder (pour le lien « Ouvrir dans App Builder »), ou `null` si elle n'est pas configurée. */
  get appBuilderUrl(): string | null {
    const u = labEnv().appBuilderUrl;
    if (typeof u !== 'string' || !/^https?:\/\//.test(u)) return null;
    return u.endsWith('/') ? u : `${u}/`;
  }
}
