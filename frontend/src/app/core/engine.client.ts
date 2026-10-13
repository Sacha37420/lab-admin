/**
 * Client de l'API web du moteur du lab (`/mcp/api`, contrat multi-dev I5).
 *
 * SEUL endroit de lab-admin qui connaît les routes et les formes du moteur.
 * Description faisant foi : `lab-mcp/API.md` — chaque type ci-dessous en est la
 * transcription, section par section. Une forme qui bouge côté moteur se
 * corrige ici et nulle part ailleurs.
 *
 * Fichier SANS dépendance à Angular (rxjs seulement) : `EngineClient` reçoit
 * son transport HTTP, ce qui permet de le tester sous Node avec des réponses
 * conformes à API.md (`engine.client.spec.ts`, `npm run test:engine`).
 * Le service injectable est `engine.service.ts`.
 */
import { Observable, exhaustMap, takeWhile, timer } from 'rxjs';

// ── §2 Erreurs ────────────────────────────────────────────────────────────────

/** Codes de `error` (API.md §2). */
export type EngineErrorCode =
  | 'unauthorized' | 'forbidden' | 'not_initialized' | 'not_found' | 'invalid'
  | 'name_refused' | 'github_not_linked' | 'github_scope' | 'busy' | 'job_exists'
  | 'queue_full' | 'workspace_limit' | 'sql_error' | 'sql_timeout' | 'upstream'
  | 'unavailable' | 'failed'
  // I9 (contrat v7)
  | 'pg_trust_enabled' | 'pgadmin_limit'
  // I10 (contrat v9)
  | 'smtp_in_use' | 'smtp_error' | 'rate_limited'
  // lecture d'une variable d'environnement gérée par le lab
  | 'managed_key'
  // adresse d'essai (chantier essai-dev, I2)
  | 'no_workspace';

/**
 * Erreur normalisée. `code` vaut un `EngineErrorCode`, ou l'un des deux codes
 * PROPRES À CE CLIENT (jamais rendus par le moteur) :
 *  - `no_engine` : pas de réponse JSON du moteur (réseau coupé, moteur non
 *    déployé — Caddy répond alors sa page 404 —, 502/504 du proxy) ;
 *  - `unexpected` : réponse d'erreur JSON sans champ `error` reconnaissable.
 */
export interface EngineError {
  status: number;
  code: EngineErrorCode | 'no_engine' | 'unexpected';
  /** Phrase affichable telle quelle. */
  detail: string;
  reasons: string[];
  /** `github_not_linked` / `github_scope`. */
  connectUrl: string | null;
  /** `job_exists`. */
  jobId: string | null;
  /** `sql_error`. */
  sqlstate: string | null;
  /** `upstream`. */
  service: string | null;
  /** `smtp_in_use` : les projets auxquels le profil est rattaché. */
  projects: string[];
  /** `workspace_limit`. */
  open: number | null;
  max: number | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Normalise ce que le transport a levé (forme `HttpErrorResponse` : `{status, error}`). */
export function toEngineError(err: unknown): EngineError {
  const e = (err ?? {}) as { status?: unknown; error?: unknown };
  const status = typeof e.status === 'number' ? e.status : 0;
  const body = (e.error !== null && typeof e.error === 'object' ? e.error : {}) as Record<string, unknown>;
  const code = str(body['error']);
  const base = {
    status,
    reasons: Array.isArray(body['reasons']) ? body['reasons'].filter((r): r is string => typeof r === 'string') : [],
    projects: Array.isArray(body['projects']) ? body['projects'].filter((r): r is string => typeof r === 'string') : [],
    connectUrl: str(body['connect_url']),
    jobId: str(body['job_id']),
    sqlstate: str(body['sqlstate']),
    service: str(body['service']),
    open: num(body['open']),
    max: num(body['max']),
  };
  if (code) {
    return { ...base, code: code as EngineErrorCode, detail: str(body['detail']) ?? `Erreur du moteur (${code}).` };
  }
  if (status === 0 || status === 404 || status === 502 || status === 503 || status === 504) {
    return {
      ...base, code: 'no_engine',
      detail: 'Le moteur du lab ne répond pas. Réessayez dans un instant ; si cela persiste, prévenez l\'administrateur.',
    };
  }
  return { ...base, code: 'unexpected', detail: `Réponse inattendue du moteur (HTTP ${status}).` };
}

// ── §3.1 Identité ─────────────────────────────────────────────────────────────

/** `workspace` de `GET /me`, `GET /devs` et de la réponse d'ouverture (§3.6). */
export interface WorkspaceInfo {
  open: boolean;
  app?: string;
  opened_by?: string;
  opened_at?: string;
  last_activity?: string;
  github_token?: boolean;
}

export interface RemainingStep {
  step: 'init' | 'link_github' | string;
  detail: string;
  url?: string;
}

export interface GithubLink {
  account?: string;
  scope?: string;
  connect_url?: string;
  error?: string;
}

export interface DatabaseInfo {
  host: string;
  name: string;
  user: string;
  /** Présent dans le détail d'un projet seulement. */
  schema?: string;
}

export interface Me {
  username: string;
  uid: string | null;
  is_superuser: boolean;
  eligible: boolean;
  ineligible_reason: null | 'invalid_uid' | 'not_in_developers';
  initialized: boolean;
  github_linked: boolean | null;
  github: GithubLink | null;
  database: DatabaseInfo | null;
  mcp_url: string;
  oauth_hub_url: string;
  workspace: WorkspaceInfo | null;
  /** I9 (v7). Absent tant que le moteur en service ne le rend pas. */
  pgadmin?: { open: boolean } | null;
  scope_app: string | null;
  viewed_as: string | null;
  remaining: RemainingStep[];
}

export interface InitStep { name: string; done: boolean; detail: string; }
export interface MeInit extends Me { steps: InitStep[]; }

export interface Group { name: string; label: string; }
export interface DevSummary { uid: string; is_superuser: boolean; projects: number; workspace: WorkspaceInfo; }

/** Les quatre profils d'I6 (API.md §3.1). */
export type Profile = 'superuser' | 'dev' | 'admin_only' | 'none';

export function profileOf(me: Pick<Me, 'is_superuser' | 'eligible'>, isAdmin: boolean): Profile {
  if (me.is_superuser) return 'superuser';
  if (me.eligible) return 'dev';
  return isAdmin ? 'admin_only' : 'none';
}

// ── §3.2 Projets ──────────────────────────────────────────────────────────────

export type ProjectState = 'running' | 'partial' | 'stopped' | 'never_deployed' | 'unknown';
export type TestVerdict = 'ok' | 'ko' | 'absent' | 'non-lancé';
export interface DeployTests { backend: TestVerdict; cloisonnement: TestVerdict; }

/** Écart avec GitHub (contrat I5 v8). Vient d'un cache du moteur. */
export type GithubStatus = 'up_to_date' | 'behind' | 'not_deployed' | 'unknown' | 'unreachable' | 'no_repo';
export interface GithubGap {
  status: GithubStatus;
  head: string | null;
  behind: number | null;
  checked_at: string | null;
}

/** Nature d'un projet (I5 v10) : app déployée (`deploiement/`) ou service du cadriciel (racine). */
export type ProjectKind = 'application' | 'outil';

export type CloisonnementVerdict = TestVerdict;
export interface CloisonnementCase { title: string; status: string; }
/** Dernier lancement du test de cloisonnement connu du moteur, quelle qu'en soit l'origine. */
export interface CloisonnementResult { verdict: CloisonnementVerdict; at: string | null; cases?: CloisonnementCase[] | null; }

export interface Project {
  /** L'app figure dans la vitrine publique. Absent tant que le moteur ne le rend pas. */
  showcased?: boolean;
  /** Sa description de vitrine. */
  description?: string | null;
  /** Dernier verdict de cloisonnement. Absent tant que le moteur ne le rend pas. */
  tests?: { cloisonnement?: CloisonnementResult | null } | null;
  /** Absent tant que le moteur en service ne le rend pas : la liste reste alors d'un seul tenant. */
  kind?: ProjectKind;
  /** Absent tant que le moteur en service ne le rend pas : à tolérer (« — »). */
  github?: GithubGap | null;
  name: string;
  owner: string;
  repo_url: string | null;
  urls: { app: string | null; api: string | null };
  ports: { backend: number | null; frontend: number | null };
  state: ProjectState;
  deployed: { sha: string; at: string; tests: DeployTests | null } | null;
  workspace: { open: boolean };
}

export interface ServiceState {
  service: string;
  state: string;
  health: '' | 'healthy' | 'unhealthy' | 'starting';
  image: string;
}

/**
 * `smtp` du détail d'un projet (I10). `stale: true` = le profil a été modifié
 * depuis sa dernière application à ce projet. Champ facultatif ici : un moteur
 * qui ne le rend pas encore ne doit rien casser.
 */
export interface ProjectSmtp { profile: string | null; label: string | null; stale?: boolean; }

/**
 * Le profil rattaché est-il en retard sur sa définition ? Le moteur fait foi
 * dès qu'il rend `stale` ; `remembered` (ce que cette session a appris d'un
 * `stale_projects`) ne sert que de repli quand le champ est absent.
 */
export function smtpIsStale(smtp: ProjectSmtp | null | undefined, remembered: boolean): boolean {
  if (!smtp?.profile) return false;
  return typeof smtp.stale === 'boolean' ? smtp.stale : remembered;
}

export interface ProjectDetail extends Project {
  /** I10 (v9). Absent tant que le moteur en service ne le rend pas. */
  smtp?: ProjectSmtp | null;
  services: ServiceState[];
  database: DatabaseInfo;
  auto_deploy: { enabled: boolean; available: boolean };
  mcp_url: string;
}

export type ProjectType = 'django' | 'django-angular' | 'angular';
/**
 * Graine de création (chantier app-builder-lab, I2) : les lots métier de la
 * feuille de route et le cahier des charges, écrits par le moteur dans le
 * premier commit du projet. Deux clés, toutes deux obligatoires ; c'est le
 * moteur qui valide le contenu.
 */
export interface ProjectSeed {
  lots_md: string;
  cahier_des_charges_md: string;
}
export interface NewProject {
  name: string;
  type: ProjectType;
  visibility: 'private' | 'public';
  required_groups: string[];
  /** Facultatif (I2). Absent : création strictement comme avant. */
  seed?: ProjectSeed;
}
export interface NameCheck { ok: boolean; reasons: string[]; }

// ── §3.3 – §3.6 ───────────────────────────────────────────────────────────────

export type JobKind = 'create' | 'deploy' | 'tests' | 'tests_all' | 'preview';
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';
export interface JobTicket { job_id: string; kind: JobKind; app: string; state: JobState; jobs_ahead: number; }

export interface Commit { sha: string; message: string; author: string; date: string; deployed: boolean; }
export interface Commits { app: string; repository: string; branch: string; commits: Commit[]; }

export interface Logs { app: string; service: string | null; tail: number; truncated: boolean; lines: string[]; }

/**
 * Une variable telle que la liste la rend : son NOM, jamais sa valeur.
 * `has_value` manque dans l'ancienne forme du moteur (qui rendait `value`) :
 * `envRows()` la jette sans la regarder, et ce type ne déclare volontairement
 * aucun champ `value` — une valeur ne s'obtient qu'à la demande, par `envGet`.
 */
export interface EnvVar { key: string; managed: boolean; has_value?: boolean; }

/** Ligne d'affichage. `hasValue` : null = le moteur ne le dit pas (ancienne forme). */
export interface EnvRow { key: string; managed: boolean; hasValue: boolean | null; }

/**
 * Lignes à afficher à partir de la réponse de `GET …/env`, QUELLE QUE SOIT sa
 * forme : seuls `key`, `managed` et `has_value` sont repris. Une valeur
 * présente dans la réponse (ancienne forme du moteur) n'atteint ni l'écran ni
 * l'état de la page.
 */
export function envRows(variables: unknown): EnvRow[] {
  if (!Array.isArray(variables)) return [];
  const rows: EnvRow[] = [];
  for (const v of variables) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o['key'] !== 'string' || !o['key']) continue;
    rows.push({ key: o['key'], managed: o['managed'] === true, hasValue: typeof o['has_value'] === 'boolean' ? o['has_value'] : null });
  }
  return rows;
}

export type SqlCell = string | number | boolean | null | object;
export interface SqlResult {
  columns: string[];
  rows: SqlCell[][];
  truncated: boolean;
  row_count: number;
  status: string;
  database: string;
  role: string;
  schema: string;
}

export interface TicketRequest { title: string; body: string; scope: 'app' | 'lab'; }
export interface Ticket { repository: string; number: number; url: string; }
export interface AutoDeploy { app: string; enabled: boolean; available: boolean; }

/** Ce qu'on ouvre dans l'espace (contrat espace-chat I3). Absent côté moteur ⇒ `editor`. */
export type WorkspaceTarget = 'editor' | 'chat-claude' | 'chat-vibe';

export interface WorkspaceOpened {
  url: string;
  /** La cible retenue par le moteur (I3) ; absente d'un moteur antérieur. */
  target?: WorkspaceTarget;
  uid: string;
  app: string;
  reused: boolean;
  ticket_expires_in: number;
  workspace: WorkspaceInfo;
}

// ── I9 (contrat v7) : mot de passe de la base, pgAdmin par dev ───────────────

/**
 * `GET /me/database-password`. SECRET : ne vit que dans la mémoire du composant
 * qui l'affiche, le temps de l'affichage — jamais dans le stockage du
 * navigateur, une URL, un journal ou un état partagé.
 */
export interface DatabasePassword {
  database: { host: string; name: string; user: string };
  gis: { host: string; name: string; user: string } | null;
  password: string;
  gis_password: string | null;
}

export interface PgadminServer { name: string; host: string; database: string; user: string; }
export interface PgadminOpened { url: string; servers: PgadminServer[]; }

// ── I10 (contrat v9) : profils SMTP du développeur ───────────────────────────

export type SmtpSecurity = 'starttls' | 'ssl' | 'none';

/** Un profil tel que le moteur le rend : JAMAIS de mot de passe, seulement `has_password`. */
export interface SmtpProfile {
  id: string;
  label: string;
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  from_email: string;
  has_password: boolean;
  projects: string[];
  /** Réponse de `PUT /me/smtp/<id>` seulement : projets qui tournent encore avec l'ancienne version. */
  stale_projects?: string[];
}

/**
 * Corps de création / modification. `password` est EN ÉCRITURE SEULE : il part
 * du formulaire vers le moteur et n'en revient jamais. En modification, la clé
 * absente veut dire « inchangé ».
 */
export interface SmtpInput {
  label: string;
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  from_email: string;
  password?: string;
}

export interface SmtpAttach { app: string; profile: string | null; applied: boolean; }

/** Port habituel de chaque mode — sert à préremplir, jamais à imposer. */
export const SMTP_DEFAULT_PORT: Record<SmtpSecurity, number> = { starttls: 587, ssl: 465, none: 25 };

/**
 * Corps envoyé au moteur à partir du formulaire.
 *  - `security: "none"` : identifiant et mot de passe partent VIDES (le moteur
 *    refuse des identifiants en clair sur le réseau) ;
 *  - sinon, mot de passe vide = clé absente (création sans mot de passe, ou
 *    modification « inchangé ») ;
 *  - le mot de passe n'est ni rogné ni transformé.
 */
export function smtpBody(form: SmtpInput): SmtpInput {
  const body: SmtpInput = {
    label: form.label.trim(), host: form.host.trim(), port: Number(form.port),
    security: form.security, username: form.username.trim(), from_email: form.from_email.trim(),
  };
  if (form.security === 'none') {
    body.username = '';
    body.password = '';
  } else if (form.password) {
    body.password = form.password;
  }
  return body;
}

/** Contrôle de saisie avant envoi ; le moteur fait foi. Rend la liste des défauts, en clair. */
export function smtpProblems(form: SmtpInput): string[] {
  const out: string[] = [];
  if (!form.label.trim()) out.push('Donnez un nom à ce profil.');
  if (!form.host.trim() || /\s/.test(form.host.trim())) out.push("Indiquez l'adresse du serveur (par exemple smtp.exemple.fr).");
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) out.push('Le port est un nombre entre 1 et 65535.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.from_email.trim())) out.push("Indiquez l'adresse d'expéditeur (celle qui apparaîtra dans les emails).");
  return out;
}

// ── Adresse d'essai (chantier essai-dev, contrat v1, I2) ─────────────────────

/** `absent` : jamais construit ou démonté · `degraded` : au moins un service ne tourne pas. */
export type PreviewState = 'absent' | 'running' | 'degraded' | 'stopped';
export interface PreviewService { service: string; state: 'running' | 'starting' | 'exited' | 'unhealthy' | string; }

/**
 * L'objet « essai » (I2), le même sur les trois routes et dans le résultat du
 * job. L'adresse appartient au PROPRIÉTAIRE du projet et ne montre qu'un projet
 * à la fois : `current` dit si c'est celui qu'on a demandé ; sinon `app` nomme
 * celui qu'elle montre (ou vaut `null` : elle ne montre rien).
 */
export interface Preview {
  state: PreviewState | string;
  current: boolean;
  app: string | null;
  /** `null` pour une app sans frontend. */
  url: string | null;
  /** `null` pour une app sans backend. */
  api_url: string | null;
  groups: string[];
  built_at: string | null;
  /** `built_at` + durée de vie ; `null` si `state` vaut `absent`. */
  expires_at: string | null;
  services: PreviewService[];
}

export interface PreviewStopped { app: string; stopped: boolean; }

function dateStr(v: unknown): string | null {
  return typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v)) ? v : null;
}

/**
 * L'objet essai tel que la page l'affiche : SEULS les champs du contrat sont
 * repris, chacun au type attendu. Une réponse abîmée donne un essai `absent`
 * et jamais une exception ; `current` ne vaut `true` que sur un `true` exact
 * (une adresse n'est jamais présentée comme celle de ce projet par défaut).
 */
export function toPreview(raw: unknown): Preview {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const services: PreviewService[] = [];
  if (Array.isArray(o['services'])) {
    for (const s of o['services']) {
      if (!s || typeof s !== 'object') continue;
      const name = str((s as Record<string, unknown>)['service']);
      if (name) services.push({ service: name, state: str((s as Record<string, unknown>)['state']) ?? 'inconnu' });
    }
  }
  return {
    state: str(o['state']) ?? 'absent',
    current: o['current'] === true,
    app: str(o['app']),
    url: str(o['url']),
    api_url: str(o['api_url']),
    groups: Array.isArray(o['groups']) ? o['groups'].filter((g): g is string => typeof g === 'string' && g !== '') : [],
    built_at: dateStr(o['built_at']),
    expires_at: dateStr(o['expires_at']),
    services,
  };
}

/** L'adresse montre-t-elle un AUTRE projet du même propriétaire ? Rend son nom, sinon `null`. */
export function previewOtherApp(p: Preview): string | null {
  return !p.current && p.app && p.state !== 'absent' ? p.app : null;
}

/** L'adresse montre-t-elle ce projet (construit, quel que soit l'état de ses services) ? */
export function previewShowsThis(p: Preview): boolean {
  return p.current && p.state !== 'absent';
}

export function previewStateLabel(state: string): { label: string; tone: '' | 'ok' | 'warn' | 'ko' } {
  switch (state) {
    case 'running': return { label: 'en service', tone: 'ok' };
    case 'degraded': return { label: 'dégradé', tone: 'warn' };
    case 'stopped': return { label: 'arrêté', tone: 'ko' };
    case 'absent': return { label: 'aucun essai', tone: '' };
    default: return { label: state, tone: 'warn' };
  }
}

export function previewServiceTone(state: string): 'ok' | 'warn' | 'ko' {
  return state === 'running' ? 'ok' : state === 'starting' ? 'warn' : 'ko';
}

/**
 * Pourquoi le bloc n'a rien à proposer, quand ce n'est pas une panne :
 *  - `no_domain` : `503 unavailable` — le lab n'a pas de nom de domaine (pas
 *    d'essai en HTTP local) ou, depuis le contrat v2, le script d'essai n'y
 *    est pas installé : dans les deux cas, pas d'essai sur ce lab ;
 *  - `not_served` : `404` sur une route d'essai d'un projet QUI EXISTE (sa page
 *    est chargée) — le moteur en service ne connaît pas encore ces routes, que
 *    le 404 vienne de lui (`not_found`) ou du proxy (`no_engine`).
 * `null` : une vraie erreur, à afficher.
 */
export function previewUnavailable(e: EngineError): 'no_domain' | 'not_served' | null {
  if (e.code === 'unavailable') return 'no_domain';
  if (e.status === 404) return 'not_served';
  return null;
}

export const PREVIEW_UNAVAILABLE_TEXT: Record<'no_domain' | 'not_served', string> = {
  no_domain: "Pas d'adresse d'essai sur ce lab pour l'instant (lab sans nom de domaine, ou fonction pas encore installée).",
  not_served: "L'adresse d'essai n'est pas encore disponible sur ce lab.",
};

/**
 * Phrase d'un refus de construire ou d'arrêter. `no_workspace` : on dit quoi
 * faire ; `busy` (v2, `423` sur l'arrêt) : le lab est occupé, on réessaie.
 */
export function previewErrorText(e: EngineError): string {
  if (e.code === 'busy') {
    return "Le lab est occupé (un déploiement est en cours, ou un essai est en construction) : rien n'a été arrêté. Réessayez dans un instant.";
  }
  if (e.code === 'no_workspace') {
    return "Ce projet n'a pas encore de dossier de travail : ouvrez d'abord son espace (« Ouvrir dans VS Code », plus haut), puis construisez l'essai.";
  }
  return e.detail;
}

/**
 * Une adresse d'essai rendue par le moteur ne devient un lien que si elle est
 * en https ET sur l'origine du lab ; sinon elle est montrée en texte brut.
 */
export function isPreviewUrl(url: unknown, origin: string): url is string {
  if (typeof url !== 'string' || !url.startsWith('https://')) return false;
  return isLabToolUrl(url, origin, '/');
}

// ── §4 Jobs ───────────────────────────────────────────────────────────────────

export interface JobTestCase { title: string; status: 'PASSED' | 'FAILED' | 'ERROR'; message: string; duration_ms: number; }

/** Union des champs de `result` pour les trois `kind` (API.md §4) — tous facultatifs sauf `ok`. */
export interface JobResult {
  ok: boolean;
  step?: string;
  error?: string;
  exit_code?: number;
  reasons?: string[];
  sha?: string;
  at?: string;
  /** `deploy` : verdicts ; `tests` : liste des cas. */
  tests?: DeployTests | JobTestCase[];
  app?: string;
  repo_url?: string;
  auto_deploy_available?: boolean;
  rollback_complete?: boolean;
  rollback?: string[];
  /** `tests_all` : un résultat par app testée. */
  results?: { app: string; verdict: CloisonnementVerdict | string; cases?: CloisonnementCase[] }[];
  found?: boolean;
  all_passed?: boolean;
  summary?: string;
  /** `preview` réussi : l'objet essai (essai-dev I2). À passer par `toPreview()`. */
  preview?: unknown;
}

export interface Job {
  job_id: string;
  kind: JobKind;
  app: string;
  state: JobState;
  terminal: boolean;
  step: string | null;
  launched_by: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  jobs_ahead: number;
  log_lines_total: number;
  log: string[];
  result: JobResult | null;
}

/** Verdicts d'un déploiement, ou null si `tests` est la liste des cas d'un job `tests`. */
export function deployVerdicts(result: JobResult | null): DeployTests | null {
  const t = result?.tests;
  return t && !Array.isArray(t) ? t : null;
}

/** Cas d'un job `tests`, ou [] . */
export function testCases(result: JobResult | null): JobTestCase[] {
  const t = result?.tests;
  return Array.isArray(t) ? t : [];
}

// ── Client ────────────────────────────────────────────────────────────────────

export interface EngineRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Chemin sous `/mcp/api`, commençant par « / ». */
  path: string;
  body?: unknown;
  params?: Record<string, string>;
}

export type EngineTransport = (req: EngineRequest) => Observable<unknown>;

/** Rythme d'interrogation d'un job conseillé par API.md §4. */
export const JOB_POLL_MS = 2000;

const seg = encodeURIComponent;

export class EngineClient {
  constructor(private readonly send: EngineTransport) {}

  private call<T>(method: EngineRequest['method'], path: string, body?: unknown,
                  params?: Record<string, string>): Observable<T> {
    const req: EngineRequest = { method, path };
    if (body !== undefined) req.body = body;
    if (params && Object.keys(params).length) req.params = params;
    return this.send(req) as Observable<T>;
  }

  private static as(asUid?: string | null): Record<string, string> | undefined {
    return asUid ? { as: asUid } : undefined;
  }

  // §3.1
  me(asUid?: string | null): Observable<Me> { return this.call('GET', '/me', undefined, EngineClient.as(asUid)); }
  meInit(): Observable<MeInit> { return this.call('POST', '/me/init'); }
  groups(): Observable<{ groups: Group[] }> { return this.call('GET', '/groups'); }
  devs(): Observable<{ devs: DevSummary[] }> { return this.call('GET', '/devs'); }

  // §3.2
  /** `refresh` : demande au moteur de relire GitHub ; il rend aussitôt ce qu'il sait déjà. */
  projects(asUid?: string | null, refresh = false): Observable<{ count: number; projects: Project[] }> {
    const params: Record<string, string> = {};
    if (asUid) params['as'] = asUid;
    if (refresh) params['refresh'] = '1';
    return this.call('GET', '/projects', undefined, params);
  }
  checkName(name: string): Observable<NameCheck> { return this.call('POST', '/projects/check-name', { name }); }
  createProject(project: NewProject): Observable<JobTicket> { return this.call('POST', '/projects', project); }
  project(app: string): Observable<ProjectDetail> { return this.call('GET', `/projects/${seg(app)}`); }

  // §3.3
  deploy(app: string, sha?: string | null): Observable<JobTicket> {
    return this.call('POST', `/projects/${seg(app)}/deploy`, sha ? { sha } : {});
  }
  commits(app: string): Observable<Commits> { return this.call('GET', `/projects/${seg(app)}/commits`); }

  // §3.4
  logs(app: string, service?: string | null, tail?: number): Observable<Logs> {
    const params: Record<string, string> = {};
    if (service) params['service'] = service;
    if (tail) params['tail'] = String(tail);
    return this.call('GET', `/projects/${seg(app)}/logs`, undefined, params);
  }
  /** Les NOMS des variables. Le type de retour est `unknown` à dessein : passer par `envRows()`. */
  envList(app: string): Observable<{ app: string; variables: unknown }> {
    return this.call('GET', `/projects/${seg(app)}/env`);
  }
  /** La valeur d'UNE variable, à la demande — propriétaire seulement, réponse non mise en cache. */
  envGet(app: string, key: string): Observable<{ app: string; key: string; value: string }> {
    return this.call('GET', `/projects/${seg(app)}/env/${seg(key)}`);
  }
  envSet(app: string, key: string, value: string): Observable<{ app: string; key: string; set: boolean; effective: string }> {
    return this.call('PUT', `/projects/${seg(app)}/env/${seg(key)}`, { value });
  }
  envUnset(app: string, key: string): Observable<{ app: string; key: string; unset: boolean; effective: string }> {
    return this.call('DELETE', `/projects/${seg(app)}/env/${seg(key)}`);
  }
  sql(app: string, query: string): Observable<SqlResult> {
    return this.call('POST', `/projects/${seg(app)}/sql`, { query });
  }

  // §3.5
  runTests(app: string): Observable<JobTicket> { return this.call('POST', `/projects/${seg(app)}/tests`); }
  /** Superutilisateur : le test de cloisonnement de chaque projet qui en a un, l'un après l'autre. */
  runAllTests(): Observable<{ job_id: string; kind: 'tests_all'; apps: string[] }> { return this.call('POST', '/tests/run-all'); }
  openTicket(app: string, ticket: TicketRequest): Observable<Ticket> {
    return this.call('POST', `/projects/${seg(app)}/tickets`, ticket);
  }
  setAutoDeploy(app: string, enabled: boolean): Observable<AutoDeploy> {
    return this.call('PUT', `/projects/${seg(app)}/auto-deploy`, { enabled });
  }

  // §3.6
  /** Éditeur : sans corps, comme avant I3. Conversation : `{"target": "chat-claude" | "chat-vibe"}`. */
  workspaceOpen(app: string, target: WorkspaceTarget = 'editor'): Observable<WorkspaceOpened> {
    return this.call('POST', `/projects/${seg(app)}/workspace`, target === 'editor' ? undefined : { target });
  }
  workspaceClose(app: string): Observable<{ app: string; closed: boolean }> {
    return this.call('DELETE', `/projects/${seg(app)}/workspace`);
  }

  // I9 — soi-même uniquement : ces trois routes n'ont pas de `?as=`.
  databasePassword(): Observable<DatabasePassword> { return this.call('GET', '/me/database-password'); }
  pgadminOpen(): Observable<PgadminOpened> { return this.call('POST', '/me/pgadmin'); }
  pgadminClose(): Observable<{ closed: boolean }> { return this.call('DELETE', '/me/pgadmin'); }

  // I10 — profils SMTP : toujours les siens (le `?as=` de lecture d'I10 n'a pas d'usage ici).
  smtpList(): Observable<{ profiles: SmtpProfile[] }> { return this.call('GET', '/me/smtp'); }
  smtpCreate(profile: SmtpInput): Observable<SmtpProfile> { return this.call('POST', '/me/smtp', profile); }
  smtpUpdate(id: string, changes: Partial<SmtpInput>): Observable<SmtpProfile> {
    return this.call('PUT', `/me/smtp/${seg(id)}`, changes);
  }
  smtpDelete(id: string): Observable<{ deleted: boolean }> { return this.call('DELETE', `/me/smtp/${seg(id)}`); }
  /** L'essai part vers l'adresse du compte de l'appelant — aucune adresse n'est transmise. */
  smtpTest(id: string): Observable<{ sent: boolean; to: string }> { return this.call('POST', `/me/smtp/${seg(id)}/test`); }
  projectSmtp(app: string, profile: string | null, apply: 'now' | 'next_deploy'): Observable<SmtpAttach> {
    return this.call('PUT', `/projects/${seg(app)}/smtp`, { profile, apply });
  }

  // Adresse d'essai (essai-dev I2). Le type de retour de la lecture est `unknown` à dessein : `toPreview()`.
  previewStatus(app: string): Observable<unknown> { return this.call('GET', `/projects/${seg(app)}/preview`); }
  /** Sans corps. Rend un ticket de job (`kind: "preview"`), à suivre comme les autres. */
  previewDeploy(app: string): Observable<JobTicket> { return this.call('POST', `/projects/${seg(app)}/preview`); }
  /** `stopped: false` : l'adresse ne montrait pas ce projet, rien n'a été arrêté. */
  previewStop(app: string): Observable<PreviewStopped> { return this.call('DELETE', `/projects/${seg(app)}/preview`); }

  // §4
  job(id: string, tail = 200): Observable<Job> {
    return this.call('GET', `/jobs/${seg(id)}`, undefined, { tail: String(tail) });
  }

  /**
   * Suit un job jusqu'à `terminal: true` (dernier état émis compris), puis se
   * termine. Une interrogation à la fois : un tic qui tombe pendant qu'une
   * réponse est attendue est ignoré. Une erreur (dont le 404 d'un job perdu au
   * redémarrage du moteur) remonte telle quelle à l'abonné.
   */
  watchJob(id: string, periodMs = JOB_POLL_MS, tail = 200): Observable<Job> {
    return timer(0, periodMs).pipe(
      exhaustMap(() => this.job(id, tail)),
      takeWhile(job => !job.terminal, true),
    );
  }
}

// ── Libellés d'affichage (aucune forme du moteur ici) ─────────────────────────

export const STATE_LABELS: Record<ProjectState, string> = {
  running: 'en service',
  partial: 'partiel',
  stopped: 'arrêté',
  never_deployed: 'jamais déployé',
  unknown: 'état inconnu',
};

export const VERDICT_LABELS: Record<TestVerdict, string> = {
  'ok': 'réussis',
  'ko': 'en échec',
  'absent': 'absents',
  'non-lancé': 'non lancés',
};

/** Libellés tolérants : une valeur que ce client ne connaît pas encore est affichée telle quelle. */
export function stateLabel(state: string): string {
  return (STATE_LABELS as Record<string, string>)[state] ?? state;
}
export function verdictLabel(verdict: string): string {
  return (VERDICT_LABELS as Record<string, string>)[verdict] ?? verdict;
}

/**
 * Écart avec GitHub, en clair. `tone` choisit la couleur de la pastille ;
 * un champ absent ou d'un statut que ce client ne connaît pas donne « — ».
 */
export function githubGapLabel(github: GithubGap | null | undefined): { label: string; tone: '' | 'ok' | 'warn' | 'ko' } {
  if (!github || typeof github.status !== 'string') return { label: '—', tone: '' };
  switch (github.status) {
    case 'up_to_date': return { label: 'à jour', tone: 'ok' };
    case 'behind': {
      const n = typeof github.behind === 'number' && github.behind > 0 ? github.behind : null;
      return { label: n === null ? 'en retard sur GitHub' : n === 1 ? '1 commit en retard' : `${n} commits en retard`, tone: 'warn' };
    }
    case 'not_deployed': return { label: 'rien en service', tone: '' };
    case 'unknown': return { label: 'version inconnue', tone: '' };
    case 'unreachable': return { label: 'dépôt injoignable', tone: 'ko' };
    case 'no_repo': return { label: 'pas de dépôt GitHub', tone: '' };
    default: return { label: '—', tone: '' };
  }
}

export interface ProjectSection { key: 'application' | 'outil' | 'autre' | 'tous'; title: string | null; projects: Project[]; }

/**
 * Sections de la liste des projets, d'après `kind` (I6 v10).
 *  - aucun projet ne porte `kind` (moteur qui ne le rend pas encore) : UNE
 *    section sans intertitre, comme avant ;
 *  - sinon « Projets de déploiement » puis « Outils de dev » (les mots du
 *    propriétaire) ; une section
 *    vide n'est pas rendue ; un projet sans `kind` ou d'une nature inconnue
 *    n'est jamais perdu : il va dans « Autres ».
 * L'ordre des projets à l'intérieur d'une section est celui du moteur.
 */
export function projectSections(projects: Project[]): ProjectSection[] {
  if (!projects.some(p => typeof p.kind === 'string')) {
    return projects.length ? [{ key: 'tous', title: null, projects }] : [];
  }
  const apps = projects.filter(p => p.kind === 'application');
  const tools = projects.filter(p => p.kind === 'outil');
  const others = projects.filter(p => p.kind !== 'application' && p.kind !== 'outil');
  const sections: ProjectSection[] = [
    { key: 'application', title: 'Projets de déploiement', projects: apps },
    { key: 'outil', title: 'Outils de dev', projects: tools },
    { key: 'autre', title: 'Autres', projects: others },
  ];
  return sections.filter(s => s.projects.length > 0);
}

/**
 * Les chiffres de l'accueil. `behind` vaut null (« — ») seulement quand il y a
 * des projets et que le moteur ne rend `github` pour aucun : sans projet, le
 * compte est connu, c'est zéro.
 */
export function projectCounts(projects: Project[]): { total: number; running: number; behind: number | null } {
  const known = projects.length === 0 || projects.some(p => !!p.github);
  return {
    total: projects.length,
    running: projects.filter(p => p.state === 'running').length,
    behind: known ? projects.filter(p => p.github?.status === 'behind').length : null,
  };
}

/**
 * Verdict de cloisonnement, en clair. « absent » (aucun test trouvé) n'est
 * JAMAIS présenté comme un succès ; une valeur inconnue non plus.
 */
export function cloisonnementLabel(verdict: string | null | undefined): { label: string; tone: '' | 'ok' | 'warn' | 'ko' } {
  switch (verdict) {
    case 'ok': return { label: 'cloisonnement vérifié', tone: 'ok' };
    case 'ko': return { label: 'cloisonnement en échec', tone: 'ko' };
    case 'absent': return { label: 'aucun test de cloisonnement', tone: 'warn' };
    case 'non-lancé': return { label: 'cloisonnement non testé', tone: '' };
    default: return { label: verdict ? `cloisonnement : ${verdict}` : 'cloisonnement : inconnu', tone: 'warn' };
  }
}

/** Bilan d'un « Tout tester » : tout est bon seulement si CHAQUE app a le verdict « ok ». */
export function runAllSummary(results: { verdict: string }[] | null | undefined): { ok: number; ko: number; absent: number; other: number; allOk: boolean } {
  const list = results ?? [];
  const n = (v: string) => list.filter(r => r.verdict === v).length;
  const ok = n('ok'), ko = n('ko'), absent = n('absent');
  return { ok, ko, absent, other: list.length - ok - ko - absent, allOk: list.length > 0 && ok === list.length };
}

/** Lien navigable d'un dépôt (`….git` → page GitHub). */
export function repoPage(repoUrl: string | null): string | null {
  if (!repoUrl || !/^https:\/\//.test(repoUrl)) return null;
  return repoUrl.replace(/\.git$/, '');
}

/**
 * Une URL d'outil rendue par le moteur (éditeur, pgAdmin) est suivie par
 * `location.replace`, hors de l'assainissement d'Angular : on n'y va que si
 * elle est sur l'origine du lab, en https, sous le préfixe attendu.
 */
function isLabToolUrl(url: unknown, origin: string, prefix: string): url is string {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.origin === origin && u.protocol === 'https:' && u.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

/** Espace de travail : `/ws/` (I3). */
export function isWorkspaceUrl(url: unknown, origin: string): url is string {
  return isLabToolUrl(url, origin, '/ws/');
}

/** L'assistant attendu dans l'URL d'une conversation (espace-chat I3). */
const CHAT_AGENT: Record<Exclude<WorkspaceTarget, 'editor'>, string> = { 'chat-claude': 'claude', 'chat-vibe': 'vibe' };

/**
 * L'URL rendue est-elle bien celle de la cible DEMANDÉE (espace-chat I3) ?
 * Éditeur : `/ws/<uid>/…` hors `_chat`. Conversation : exactement
 * `/ws/<uid>/_chat/` avec `agent=claude|vibe`. Un moteur qui ignorerait
 * `target` rendrait l'URL de l'éditeur : on ne l'ouvre pas à la place d'une
 * conversation (sur un téléphone, ce serait VS Code dans l'onglet courant).
 */
export function isWorkspaceTargetUrl(url: unknown, origin: string, target: WorkspaceTarget): url is string {
  if (!isWorkspaceUrl(url, origin)) return false;
  const u = new URL(url);
  const chat = /^\/ws\/[^/]+\/_chat\/$/.test(u.pathname);
  if (target === 'editor') return !/^\/ws\/[^/]+\/_chat(\/|$)/.test(u.pathname);
  return chat && u.searchParams.get('agent') === CHAT_AGENT[target];
}

/** Libellés des trois ouvertures — un seul endroit pour la liste et la page d'un projet. */
export const WORKSPACE_TARGET_TEXT: Record<WorkspaceTarget, { label: string; opening: string; unexpected: string }> = {
  'editor': { label: 'VS Code', opening: "Ouverture de l'éditeur… (jusqu'à 30 secondes)",
              unexpected: "Le moteur a rendu une adresse d'éditeur inattendue : elle n'a pas été ouverte." },
  'chat-claude': { label: 'Claude Code', opening: "Ouverture de la conversation Claude Code… (jusqu'à 30 secondes)",
                   unexpected: "Le moteur a rendu une adresse de conversation inattendue : elle n'a pas été ouverte." },
  'chat-vibe': { label: 'Mistral Vibe', opening: "Ouverture de la conversation Mistral Vibe… (jusqu'à 30 secondes)",
                 unexpected: "Le moteur a rendu une adresse de conversation inattendue : elle n'a pas été ouverte." },
};

/** pgAdmin d'un dev : `/pg/` (I9). */
export function isPgadminUrl(url: unknown, origin: string): url is string {
  return isLabToolUrl(url, origin, '/pg/');
}

/** Règle du moteur pour une clé de variable (API.md §3.4). */
export const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Règle d'I1 pour un nom de projet — simple confort de saisie, `check-name` fait foi. */
export const APP_NAME_RE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
