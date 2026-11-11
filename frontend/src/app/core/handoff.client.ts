/**
 * Client de l'API de remise d'App Builder (`/api/handoff/…`, chantier
 * app-builder-lab, interface I1) et passage d'une spécification prête au
 * moteur (interface I2).
 *
 * SEUL endroit de lab-admin qui connaît les routes et les formes d'App Builder.
 * Description faisant foi : le contrat du chantier, §4 — chaque type ci-dessous
 * en est la transcription.
 *
 * Trois routes, toutes en lecture seule, appelées par le navigateur avec le
 * jeton de l'utilisateur : ce sont toujours SES spécifications. Rien n'est
 * écrit dans App Builder d'ici, et le contenu d'une graine ne fait que
 * traverser : lu dans le kit, envoyé tel quel au moteur, jamais affiché en
 * HTML, jamais gardé hors de la mémoire de la page.
 *
 * Fichier SANS dépendance à Angular (rxjs seulement), comme `engine.client.ts` :
 * testé sous Node (`handoff.client.spec.ts`, `npm run test:engine`).
 * Le service injectable est `handoff.service.ts`.
 */
import { Observable, catchError, map, of, switchMap, throwError } from 'rxjs';
import { NameCheck, NewProject, Project, ProjectType, Ticket, TicketRequest, toEngineError } from './engine.client';

// ── I1 : formes ───────────────────────────────────────────────────────────────

/** Codes de `blockers[].code` (liste fermée du contrat). Un code inconnu reste affichable par son message. */
export type HandoffBlockerCode =
  | 'project_name' | 'app_type' | 'required_groups' | 'empty' | 'file_field'
  | 'orphan_reference' | 'context_budget';

export interface HandoffBlocker { code: HandoffBlockerCode | string; message: string; }
export interface HandoffCounts { data_models: number; endpoints: number; pages: number; lots: number; }

/** Un élément de `GET /api/handoff/specs/`. */
export interface HandoffSpec {
  id: number;
  name: string;
  /** Nom de projet au format du lab, ou `""` s'il n'est pas encore saisi. */
  project_name: string;
  /** Valeur stockée, telle quelle : pas forcément un type que le lab sait construire. */
  app_type: string;
  required_groups: string[];
  updated_at: string;
  ready: boolean;
  blockers: HandoffBlocker[];
  counts: HandoffCounts;
  /**
   * Empreinte du contenu remis (chantier app-builder-v2, I7) : `sha256:<64 hex>`.
   * ABSENTE (clé non posée) quand App Builder ne la rend pas (ancienne image) ou
   * qu'elle n'a pas la forme attendue : rien n'est alors comparé.
   */
  fingerprint?: string;
}

/** Estimations en jetons ; `lot_budget_tokens` est le plafond appliqué à un lot. */
export interface HandoffContext { cahier_tokens: number; largest_lot_tokens: number; lot_budget_tokens: number; }

/** `GET /api/handoff/specs/<id>/`. */
export interface HandoffSpecDetail extends HandoffSpec { description: string; context: HandoffContext; }

/** `GET /api/handoff/specs/<id>/kit/` (200). */
export interface HandoffKit {
  spec: { id: number; name: string; updated_at: string; fingerprint?: string };
  create: { name: string; type: ProjectType; required_groups: string[] };
  seed: { lots_md: string; cahier_des_charges_md: string };
  context: HandoffContext;
}

// ── Erreurs ───────────────────────────────────────────────────────────────────

/**
 * Codes d'erreur, tous PROPRES À CE CLIENT (App Builder ne rend que
 * `{"detail": …}`, sauf le 409 `not_ready`) :
 *  - `not_configured` : `appBuilderApiUrl` manque dans la configuration ;
 *  - `unreachable`    : pas de réponse (réseau, 502/503/504) ;
 *  - `unauthorized` 401 · `forbidden` 403 · `not_found` 404 ;
 *  - `not_ready`      : 409 du kit, avec ses `blockers` ;
 *  - `unexpected`     : tout le reste, dont une réponse 200 qui n'a pas la forme du contrat.
 */
export type HandoffErrorCode =
  | 'not_configured' | 'unreachable' | 'unauthorized' | 'forbidden' | 'not_found' | 'not_ready' | 'unexpected';

export interface HandoffError {
  status: number;
  code: HandoffErrorCode;
  /** Phrase affichable telle quelle. */
  detail: string;
  /** `not_ready` seulement. */
  blockers: HandoffBlocker[];
}

const ERROR_TEXT: Record<Exclude<HandoffErrorCode, 'unexpected'>, string> = {
  not_configured: "L'adresse d'App Builder n'est pas configurée sur ce lab : vos spécifications ne peuvent pas être lues ici.",
  unreachable: 'App Builder ne répond pas pour le moment. Le reste de la page fonctionne ; réessayez dans un instant.',
  unauthorized: 'Votre session a expiré : rechargez la page pour vous reconnecter.',
  forbidden: "App Builder n'ouvre pas vos spécifications à cette page (accès refusé à votre compte, ou lab-admin n'y est pas encore autorisé).",
  not_found: "Cette spécification n'existe plus dans App Builder.",
  not_ready: "Cette spécification n'est pas prête à être construite.",
};

/** Marque posée par `HandoffService` quand aucune adresse n'est configurée. */
export const NOT_CONFIGURED = { handoff: 'not_configured' } as const;
/** Marque posée par ce client quand une réponse 200 n'a pas la forme du contrat. */
const BAD_SHAPE = { handoff: 'bad_shape' } as const;

/**
 * Erreur de lecture de la LISTE. Un 404 n'y désigne aucune spécification : c'est
 * qu'App Builder ne sert pas (encore) l'API de remise — même phrase que s'il ne
 * répondait pas.
 */
export function toListError(err: unknown): HandoffError {
  const e = toHandoffError(err);
  return e.code === 'not_found' ? { ...e, code: 'unreachable', detail: ERROR_TEXT.unreachable } : e;
}

/** Normalise ce que le transport a levé (forme `HttpErrorResponse` : `{status, error}`). */
export function toHandoffError(err: unknown): HandoffError {
  const e = (err ?? {}) as { status?: unknown; error?: unknown; handoff?: unknown };
  const status = typeof e.status === 'number' ? e.status : 0;
  const make = (code: Exclude<HandoffErrorCode, 'unexpected'>, blockers: HandoffBlocker[] = []): HandoffError =>
    ({ status, code, detail: ERROR_TEXT[code], blockers });
  if (e.handoff === NOT_CONFIGURED.handoff) return make('not_configured');
  if (e.handoff === BAD_SHAPE.handoff) {
    return { status, code: 'unexpected', detail: "App Builder a rendu une réponse que cette page ne sait pas lire.", blockers: [] };
  }
  const body = (e.error !== null && typeof e.error === 'object' ? e.error : {}) as Record<string, unknown>;
  if (status === 409 && body['error'] === 'not_ready') return make('not_ready', blockers(body['blockers']));
  if (status === 401) return make('unauthorized');
  if (status === 403) return make('forbidden');
  if (status === 404) return make('not_found');
  if (status === 0 || status === 502 || status === 503 || status === 504) return make('unreachable');
  return { status, code: 'unexpected', detail: `Réponse inattendue d'App Builder (HTTP ${status}).`, blockers: [] };
}

// ── Lecture prudente des réponses ─────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function text(v: unknown): string { return typeof v === 'string' ? v : ''; }
function count(v: unknown): number { return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0; }
function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];
}

function blockers(v: unknown): HandoffBlocker[] {
  if (!Array.isArray(v)) return [];
  const out: HandoffBlocker[] = [];
  for (const b of v) {
    if (!isObject(b)) continue;
    const code = text(b['code']);
    out.push({ code, message: text(b['message']) || (code ? `Point bloquant : ${code}.` : 'Point bloquant non précisé.') });
  }
  return out;
}

function context(v: unknown): HandoffContext {
  const o = isObject(v) ? v : {};
  return {
    cahier_tokens: count(o['cahier_tokens']),
    largest_lot_tokens: count(o['largest_lot_tokens']),
    lot_budget_tokens: count(o['lot_budget_tokens']),
  };
}

/**
 * Une spécification telle que la page la tient. Seuls les champs du contrat
 * sont repris (rien d'autre n'atteint l'état de la page). Une entrée sans
 * identifiant est écartée. `ready` n'est vrai que si App Builder le dit ET
 * qu'aucun point bloquant n'est listé : dans le doute, pas de lancement.
 */
function spec(v: unknown): HandoffSpec | null {
  if (!isObject(v) || typeof v['id'] !== 'number' || !Number.isInteger(v['id'])) return null;
  const blocked = blockers(v['blockers']);
  const c = isObject(v['counts']) ? v['counts'] : {};
  return {
    id: v['id'],
    name: text(v['name']),
    project_name: text(v['project_name']),
    app_type: text(v['app_type']),
    required_groups: strings(v['required_groups']),
    updated_at: text(v['updated_at']),
    ready: v['ready'] === true && blocked.length === 0,
    blockers: blocked,
    counts: { data_models: count(c['data_models']), endpoints: count(c['endpoints']), pages: count(c['pages']), lots: count(c['lots']) },
    ...fingerprint(v['fingerprint']),
  };
}

/** Forme d'une empreinte de spécification (I7). */
export const FINGERPRINT_RE = /^sha256:[0-9a-f]{64}$/;
function fingerprint(v: unknown): { fingerprint?: string } {
  return typeof v === 'string' && FINGERPRINT_RE.test(v) ? { fingerprint: v } : {};
}

const TYPES: readonly string[] = ['django', 'django-angular', 'angular'];
/** Forme d'un nom de projet du lab (contrat I1) — `check-name` fait foi pour le reste. */
const PROJECT_NAME_RE = /^[a-z][a-z0-9-]{2,39}$/;

/**
 * Le kit, s'il a exactement de quoi appeler le moteur ; sinon `null`. Ce
 * contrôle ne refait PAS la validation de la graine (c'est le moteur qui la
 * fait) : il écarte seulement une réponse qui n'est pas un kit.
 */
function kit(v: unknown, id: number): HandoffKit | null {
  if (!isObject(v) || !isObject(v['spec']) || !isObject(v['create']) || !isObject(v['seed'])) return null;
  const s = v['spec'], c = v['create'], seed = v['seed'];
  const groups = strings(c['required_groups']);
  const name = text(c['name']), type = text(c['type']);
  const lots = text(seed['lots_md']), cahier = text(seed['cahier_des_charges_md']);
  if (s['id'] !== id) return null;
  if (!PROJECT_NAME_RE.test(name) || name.includes('--') || !TYPES.includes(type)) return null;
  if (!Array.isArray(c['required_groups']) || groups.length === 0 || groups.length !== c['required_groups'].length) return null;
  if (!lots || !cahier) return null;
  return {
    spec: { id, name: text(s['name']), updated_at: text(s['updated_at']), ...fingerprint(s['fingerprint']) },
    create: { name, type: type as ProjectType, required_groups: groups },
    seed: { lots_md: lots, cahier_des_charges_md: cahier },
    context: context(v['context']),
  };
}

// ── Client ────────────────────────────────────────────────────────────────────

/** Chemin sous la base de l'API d'App Builder, commençant par « / ». Toujours un `GET`. */
export type HandoffTransport = (path: string) => Observable<unknown>;

export class HandoffClient {
  constructor(private readonly get: HandoffTransport) {}

  private static bad(): Observable<never> { return throwError(() => BAD_SHAPE); }

  /** Les spécifications de l'appelant, plus récente d'abord (ordre d'App Builder). */
  specs(): Observable<HandoffSpec[]> {
    return this.get('/api/handoff/specs/').pipe(switchMap(raw =>
      Array.isArray(raw) ? of(raw.map(spec).filter((s): s is HandoffSpec => s !== null)) : HandoffClient.bad()));
  }

  /** Une spécification, avec sa description et ses estimations de contexte. */
  spec(id: number): Observable<HandoffSpecDetail> {
    return this.get(`/api/handoff/specs/${id}/`).pipe(switchMap(raw => {
      const base = spec(raw);
      if (!base || base.id !== id) return HandoffClient.bad();
      const o = raw as Record<string, unknown>;
      return of({ ...base, description: text(o['description']), context: context(o['context']) });
    }));
  }

  /** De quoi créer le projet. `409 not_ready` si la spécification n'est pas prête. */
  kit(id: number): Observable<HandoffKit> {
    return this.get(`/api/handoff/specs/${id}/kit/`).pipe(switchMap(raw => {
      const k = kit(raw, id);
      return k ? of(k) : HandoffClient.bad();
    }));
  }
}

// ── De la spécification au projet (I1 → I2) ───────────────────────────────────

/**
 * Corps EXACT du `POST /projects` du moteur pour un kit (I2) : `create` tel
 * quel, la visibilité choisie par l'utilisateur, `seed` tel quel.
 */
export function seededProject(k: HandoffKit, visibility: 'private' | 'public'): NewProject {
  return {
    name: k.create.name,
    type: k.create.type,
    visibility,
    required_groups: [...k.create.required_groups],
    seed: { lots_md: k.seed.lots_md, cahier_des_charges_md: k.seed.cahier_des_charges_md },
  };
}

/** Ce qu'il faut pour proposer « Créer le projet » : le kit et le verdict du moteur sur le nom. */
export interface LaunchPlan { kit: HandoffKit; name: NameCheck; }

/**
 * Prépare un lancement : lit le kit, PUIS fait contrôler le nom par le moteur.
 * Rien n'est créé ici. Une erreur d'App Builder (dont `not_ready`) remonte
 * telle quelle, sans que le moteur soit sollicité ; un moteur qui ne répond
 * pas donne un nom refusé, avec sa phrase.
 */
export function launchPlan(handoff: Pick<HandoffClient, 'kit'>,
                           engine: { checkName(name: string): Observable<NameCheck> },
                           id: number): Observable<LaunchPlan> {
  return handoff.kit(id).pipe(switchMap(k =>
    engine.checkName(k.create.name).pipe(
      map(check => ({ ok: check?.ok === true, reasons: strings(check?.reasons) })),
      catchError(err => of<NameCheck>({ ok: false, reasons: [toEngineError(err).detail] })),
      map(name => ({ kit: k, name })),
    )));
}

/** Le plan autorise-t-il la création ? Seulement si le moteur a accepté le nom. */
export function planAllowsCreation(plan: LaunchPlan | null | undefined): boolean {
  return !!plan && plan.name.ok === true;
}

/**
 * Le projet de l'appelant qui porte déjà le nom de projet de la spécification
 * (le contrat ne garde aucun lien spec ↔ projet : on rapproche par le nom).
 * `uid` : le compte connecté — la liste d'un superutilisateur contient les
 * projets de tout le lab, on n'y retient que les siens.
 */
export function existingProject(s: Pick<HandoffSpec, 'project_name'>, projects: readonly Project[],
                                uid: string | null | undefined): Project | null {
  if (!s.project_name || !uid) return null;
  return projects.find(p => p.name === s.project_name && p.owner === uid) ?? null;
}

// ── Libellés d'affichage ──────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  'django-angular': 'Django + Angular',
  'django': 'Django (API seule)',
  'angular': 'Angular seul',
};

/** Type en clair ; une valeur que le lab ne construit pas est affichée telle quelle. */
export function appTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? (type || 'type non précisé');
}

/** Entier avec séparateur de milliers (espace fine insécable), sans dépendre de la locale du navigateur. */
export function formatCount(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+$)/g, ' ');
}

/**
 * Les estimations de contexte, en phrases. `share` : part du plafond prise par
 * le plus gros lot, en pourcentage entier ; `null` si le plafond n'est pas
 * connu. `over` : le plus gros lot dépasse le plafond.
 */
export function contextSummary(c: HandoffContext): { cahier: string; lot: string; share: number | null; over: boolean } {
  const share = c.lot_budget_tokens > 0 ? Math.round((c.largest_lot_tokens / c.lot_budget_tokens) * 100) : null;
  return {
    cahier: `Cahier des charges : environ ${formatCount(c.cahier_tokens)} jetons.`,
    lot: share === null
      ? `Plus gros lot : environ ${formatCount(c.largest_lot_tokens)} jetons.`
      : `Plus gros lot : environ ${formatCount(c.largest_lot_tokens)} jetons sur ${formatCount(c.lot_budget_tokens)} admis par lot (${share} %).`,
    share,
    over: c.lot_budget_tokens > 0 && c.largest_lot_tokens > c.lot_budget_tokens,
  };
}

// ── Aperçu de la remise (chantier app-builder-v2, P2) ─────────────────────────

/** Un lot « à faire » de la graine, pour l'affichage. */
export interface RoadmapTitle { number: number; title: string; }

/**
 * Titres de lot d'un `lots_md` : l'expression `_TITLE` de `lab-mcp/labmcp/seed.py`
 * (`^## Lot ([0-9]+) — .+·[[:space:]]*statut : à faire[[:space:]]*$`), ligne à ligne,
 * lignes coupées sur « \n » seul. AFFICHAGE SEULEMENT : c'est le moteur qui valide
 * la graine. `title` : ce qui sépare « — » du dernier « · », sans caractère de
 * contrôle, au plus 200 caractères.
 */
export function roadmapTitles(lotsMd: string): RoadmapTitle[] {
  const re = /^## Lot ([0-9]+) — ([^\n]+)·[ \t\v\f]*statut : à faire[ \t\v\f]*$/;
  const out: RoadmapTitle[] = [];
  for (const line of (typeof lotsMd === 'string' ? lotsMd : '').split('\n')) {
    const m = re.exec(line);
    if (!m) continue;
    out.push({ number: Number(m[1]), title: oneLine(m[2], 200) || `Lot ${m[1]}` });
  }
  return out;
}

/** Une ligne de texte sûre : contrôles et retours à la ligne remplacés, espaces resserrés, coupée à `max` points de code. */
function oneLine(v: string, max: number): string {
  const flat = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : flat;
}

// ── Spécification d'origine d'un projet (P2) et « elle a changé » (P3) ────────

/** Le lien enregistré par lab-admin (I8), tel que la page le tient. */
export interface SpecLinkRef { app: string; spec_id: number; fingerprint: string; }

export interface OriginSpec {
  /** La spécification retrouvée parmi celles de l'appelant, ou `null`. */
  spec: HandoffSpec | null;
  /** Comment : par le lien enregistré, ou par le nom de projet (repli d'avant I8). */
  via: 'link' | 'name' | null;
  /** Lien enregistré vers une spécification qui n'est plus dans la liste : son numéro. */
  missingId: number | null;
}

/**
 * La spécification d'origine du projet `app`, parmi LES SPÉCIFICATIONS DE
 * L'APPELANT : par le lien d'abord (il survit à un renommage), sinon par
 * `project_name === app`. L'appelant de cette fonction s'assure que le projet
 * est le sien (sinon une spec à lui serait rapprochée du projet d'un autre).
 */
export function originSpec(app: string, specs: readonly HandoffSpec[], link: SpecLinkRef | null): OriginSpec {
  if (link && link.app === app) {
    const s = specs.find(x => x.id === link.spec_id) ?? null;
    return { spec: s, via: 'link', missingId: s ? null : link.spec_id };
  }
  const byName = app ? specs.find(x => x.project_name === app) ?? null : null;
  return { spec: byName, via: byName ? 'name' : null, missingId: null };
}

/**
 * La spécification a-t-elle changé depuis la création (ou le dernier envoi) ?
 * Seulement si les DEUX empreintes sont connues et diffèrent : une empreinte
 * absente d'un côté ou de l'autre ne fait jamais annoncer « modifiée ».
 */
export function specChanged(link: Pick<SpecLinkRef, 'fingerprint'> | null, spec: Pick<HandoffSpec, 'fingerprint'> | null): boolean {
  const before = link?.fingerprint ?? '', now = spec?.fingerprint ?? '';
  return FINGERPRINT_RE.test(before) && FINGERPRINT_RE.test(now) && before !== now;
}

// ── Ticket « spécification modifiée » (P3, I8) ───────────────────────────────

/** Bornes du moteur (`POST /projects/<app>/tickets`, API.md §3.5). */
export const TICKET_TITLE_MAX = 256;
export const TICKET_BODY_MAX = 60_000;
/** Au-delà, le cahier n'est pas recopié dans le ticket : on renvoie vers App Builder. */
export const TICKET_CAHIER_MAX = 55_000;
const TICKET_LOTS_MAX = 60;

/** Texte d'App Builder rendu inoffensif : sans NUL, retours chariot ramenés à « \n ». */
function plain(v: string): string {
  return v.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
}

/**
 * Clôture d'un bloc `~~~` qu'aucune ligne du texte ne peut fermer : plus longue
 * que toute suite de « ~ » en tête de ligne (après au plus 3 espaces, règle
 * CommonMark de fermeture). Sans elle, une ligne `~~~` du cahier fermerait le
 * bloc, et un `# titre` qui la suit sortirait en clair dans le ticket.
 */
export function tildeFence(content: string): string {
  let longest = 0;
  for (const line of content.split('\n')) {
    const m = /^ {0,3}(~+)/.exec(line);
    if (m) longest = Math.max(longest, m[1].length);
  }
  return '~'.repeat(Math.max(3, longest + 1));
}

/**
 * Le ticket qui porte une version de la spécification au dépôt du projet
 * (`POST /projects/<app>/tickets`, `scope: "app"`). Composé UNIQUEMENT de champs
 * du kit (jamais de jeton, jamais d'historique de conversation : le kit n'en a pas).
 *
 * - titre ≤ 256, sans retour à la ligne ;
 * - corps ≤ 60 000, première ligne : le marqueur
 *   `<!-- lab-spec-update id=<n> fingerprint=sha256:… -->` (sans `fingerprint=`
 *   quand App Builder n'en rend pas) ;
 * - aucune ligne venue de la spécification ne commence par « # » hors du bloc
 *   `~~~` : les lots sont listés « - Lot n — titre », les seuls titres Markdown
 *   sont ceux, fixes, de ce gabarit ;
 * - le cahier est recopié dans un bloc `~~~markdown` s'il fait au plus
 *   55 000 caractères et tient dans le corps ; sinon, une phrase renvoie à
 *   App Builder (`appBuilderUrl?spec=<id>` si l'adresse est connue).
 */
export function specUpdateTicket(k: HandoffKit, appBuilderUrl: string | null = null): TicketRequest {
  const id = k.spec.id;
  const name = oneLine(plain(k.spec.name || ''), 120);
  const fp = typeof k.spec.fingerprint === 'string' && FINGERPRINT_RE.test(k.spec.fingerprint) ? k.spec.fingerprint : '';
  const state = /^[0-9][0-9T:.+\-Z ]{9,39}$/.test(k.spec.updated_at || '') ? k.spec.updated_at : '';

  const title = oneLine(`Spécification App Builder n° ${id} modifiée${name ? ` — ${name}` : ''}`, TICKET_TITLE_MAX);

  const where = appBuilderUrl && /^https?:\/\/[^\s<>"']+$/.test(appBuilderUrl)
    ? `${appBuilderUrl}?spec=${id}` : '';
  const head: string[] = [
    `<!-- lab-spec-update id=${id}${fp ? ` fingerprint=${fp}` : ''} -->`,
    '',
    `La spécification App Builder n° ${id}${name ? ` (« ${name} »)` : ''} a changé depuis la création de ce projet, ou depuis son dernier envoi ici.`,
  ];
  if (state) head.push(`État transmis : ${state}.`);
  if (fp) head.push(`Empreinte : \`${fp}\`.`);
  head.push(
    '',
    'À traiter avant le prochain lot : comparer avec `CAHIER_DES_CHARGES.md` et `FEUILLE_DE_ROUTE.md`, '
    + 'proposer au développeur la mise à jour du cahier et des lots « à faire » (jamais un lot livré), '
    + 'puis fermer ce ticket en citant le commit. Rien n\'est appliqué sans le développeur.',
    '',
    '## Lots de la nouvelle version',
    '',
  );
  const lots = roadmapTitles(plain(k.seed.lots_md));
  if (lots.length === 0) head.push('(aucun lot « à faire » lisible dans cette version)');
  for (const l of lots.slice(0, TICKET_LOTS_MAX)) head.push(`- Lot ${l.number} — ${l.title}`);
  if (lots.length > TICKET_LOTS_MAX) head.push(`- … et ${lots.length - TICKET_LOTS_MAX} autre(s) lot(s), à lire dans App Builder.`);
  head.push('', '## Cahier des charges (nouvelle version)', '');

  const before = head.join('\n');
  const cahier = plain(k.seed.cahier_des_charges_md);
  const fence = tildeFence(cahier);
  const block = `${fence}markdown\n${cahier}${cahier.endsWith('\n') ? '' : '\n'}${fence}\n`;
  const tooLong = `Trop long pour un ticket (${formatCount(Array.from(cahier).length)} caractères) : `
    + (where ? `le lire dans App Builder, page Livrables — ${where}\n` : 'le lire dans App Builder, page Livrables.\n');

  let body = cahier.length <= TICKET_CAHIER_MAX && before.length + 1 + block.length <= TICKET_BODY_MAX
    ? `${before}\n${block}` : `${before}\n${tooLong}`;
  // Garde finale (ne se déclenche pas avec les bornes ci-dessus) : jamais plus que le moteur n'accepte.
  if (body.length > TICKET_BODY_MAX) body = `${head.slice(0, 3).join('\n')}\n\n${tooLong}`;
  return { title, body, scope: 'app' };
}

/** Ce que rend l'envoi : le ticket ouvert, et le lien mis à jour (`null` si son écriture a échoué). */
export interface Transmitted { ticket: Ticket; link: SpecLinkRef | null; }

/** Échec de l'envoi : à la lecture du kit (App Builder) ou à l'ouverture du ticket (moteur). */
export interface TransmitError { stage: 'kit' | 'ticket'; cause: unknown; }

/**
 * « Transmettre au projet » : relit le kit (la version ACTUELLE, avec le jeton de
 * l'utilisateur), ouvre le ticket par la route existante du moteur, puis met à
 * jour le lien de lab-admin avec l'empreinte transmise. Le ticket ouvert est
 * rendu même si l'écriture du lien échoue (il existe : ne pas le reproposer en
 * erreur). Une erreur d'App Builder (dont `not_ready`) ou du moteur remonte
 * telle quelle, et rien n'est écrit ; l'erreur levée est un `TransmitError` qui dit laquelle.
 */
export function transmitSpec(handoff: Pick<HandoffClient, 'kit'>,
                             engine: { openTicket(app: string, t: TicketRequest): Observable<Ticket> },
                             links: { put(app: string, v: { spec_id: number; fingerprint: string }): Observable<SpecLinkRef> },
                             app: string, specId: number, appBuilderUrl: string | null): Observable<Transmitted> {
  return handoff.kit(specId).pipe(
    catchError(cause => throwError((): TransmitError => ({ stage: 'kit', cause }))),
    switchMap(k => engine.openTicket(app, specUpdateTicket(k, appBuilderUrl)).pipe(
      catchError(cause => throwError((): TransmitError => ({ stage: 'ticket', cause }))),
      switchMap(ticket =>
      links.put(app, { spec_id: k.spec.id, fingerprint: k.spec.fingerprint ?? '' }).pipe(
        map(link => ({ ticket, link })),
        catchError(() => of({ ticket, link: null })),
      )))));
}
