/**
 * Lien projet ↔ spécification App Builder, gardé par le backend de lab-admin
 * (chantier app-builder-v2, I8) : `GET/PUT <apiUrl>/api/spec-links/<app>/`.
 *
 * Chaque compte n'y lit et n'y écrit que ses lignes (le backend le tient, par
 * l'email du jeton). Le moteur et App Builder n'en savent rien.
 *
 * Fichier SANS dépendance à Angular (rxjs seulement) : testé sous Node
 * (`spec-link.client.spec.ts`, `npm run test:engine`). Le service injectable
 * est `spec-link.service.ts`.
 */
import { Observable, catchError, of, switchMap, throwError } from 'rxjs';
import { FINGERPRINT_RE, HandoffKit, SpecLinkRef } from './handoff.client';

export interface SpecLink extends SpecLinkRef { created_at: string; }

/** Corps du `PUT`. `fingerprint` : `""` quand App Builder n'en rend pas. */
export interface SpecLinkInput { spec_id: number; fingerprint: string; }

/** Requête vers l'API de lab-admin ; `path` commence par « /api/ ». */
export type SpecLinkTransport = (method: 'GET' | 'PUT', path: string, body?: unknown) => Observable<unknown>;

/** Même forme que côté backend (`api/views.py`, `_APP_RE`). */
const APP_RE = /^[a-z][a-z0-9-]{0,62}$/;

/** Marque levée quand un argument est refusé AVANT tout appel. */
export const SPEC_LINK_REFUSED = { specLink: 'refused' } as const;
const BAD_SHAPE = { specLink: 'bad_shape' } as const;

function link(v: unknown, app: string): SpecLink | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const id = o['spec_id'];
  if (o['app'] !== app || typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null;
  const fp = typeof o['fingerprint'] === 'string' && FINGERPRINT_RE.test(o['fingerprint']) ? o['fingerprint'] : '';
  return { app, spec_id: id, fingerprint: fp, created_at: typeof o['created_at'] === 'string' ? o['created_at'] : '' };
}

export class SpecLinkClient {
  constructor(private readonly send: SpecLinkTransport) {}

  private static path(app: string): string { return `/api/spec-links/${encodeURIComponent(app)}/`; }

  /** Le lien de l'appelant pour ce projet ; `null` s'il n'en a pas (404). */
  get(app: string): Observable<SpecLink | null> {
    if (!APP_RE.test(app)) return throwError(() => SPEC_LINK_REFUSED);
    return this.send('GET', SpecLinkClient.path(app)).pipe(
      catchError(err => (err as { status?: unknown })?.status === 404 ? of(null) : throwError(() => err)),
      switchMap(raw => raw === null ? of(null) : (link(raw, app) ? of(link(raw, app)) : throwError(() => BAD_SHAPE))),
    );
  }

  /** Crée ou remplace le lien de l'appelant. */
  put(app: string, v: SpecLinkInput): Observable<SpecLink> {
    const fp = v.fingerprint ?? '';
    if (!APP_RE.test(app) || !Number.isInteger(v.spec_id) || v.spec_id <= 0 || (fp !== '' && !FINGERPRINT_RE.test(fp))) {
      return throwError(() => SPEC_LINK_REFUSED);
    }
    return this.send('PUT', SpecLinkClient.path(app), { spec_id: v.spec_id, fingerprint: fp }).pipe(
      switchMap(raw => { const l = link(raw, app); return l ? of(l) : throwError(() => BAD_SHAPE); }),
    );
  }
}

/** Le lien à écrire après la création réussie d'un projet depuis ce kit. */
export function linkFromKit(k: HandoffKit): SpecLinkInput {
  return { spec_id: k.spec.id, fingerprint: k.spec.fingerprint ?? '' };
}
