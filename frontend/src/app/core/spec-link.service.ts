import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SpecLinkClient } from './spec-link.client';
import { apiUrl } from './env';

/**
 * Lien projet ↔ spécification (I8) vu d'Angular. L'API de lab-admin est dans
 * `tokenBases()` : `authInterceptor` y joint le jeton de l'utilisateur.
 */
@Injectable({ providedIn: 'root' })
export class SpecLinkService extends SpecLinkClient {
  constructor() {
    const http = inject(HttpClient);
    const base = apiUrl().replace(/\/+$/, '');
    super((method, path, body) => http.request<unknown>(method, `${base}${path}`, { body }));
  }
}
