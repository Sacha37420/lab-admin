/**
 * Tests du client de l'API de remise d'App Builder (I1) et du passage au
 * moteur (I2), avec les réponses ÉCRITES DANS LE CONTRAT du chantier
 * app-builder-lab (v1, §4), recopiées telles quelles. Sans Angular ni navigateur :
 *
 *     npm run test:engine
 *
 * Ce qu'ils tiennent : le chemin de chaque route ; la lecture de la liste, du
 * détail, du kit ; le 409 `not_ready`, le 403, le réseau coupé, l'adresse non
 * configurée ; le corps exact envoyé au moteur avec `seed` ; et les refus —
 * spec non prête, nom refusé par `check-name` — qui ne mènent à aucune création.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { EngineClient, EngineRequest, Project } from './engine.client';
import {
  HandoffClient, HandoffError, NOT_CONFIGURED, appTypeLabel, contextSummary, existingProject, formatCount,
  launchPlan, planAllowsCreation, seededProject, toHandoffError, toListError,
} from './handoff.client';

// ── Réponses du contrat (I1) ─────────────────────────────────────────────────

const BLOCKER = { code: 'required_groups', message: "Aucun groupe requis : l'app serait ouverte à tout compte du lab." };
const COUNTS = { data_models: 3, endpoints: 12, pages: 4, lots: 5 };
const CONTEXT = { cahier_tokens: 4200, largest_lot_tokens: 1800, lot_budget_tokens: 20000 };

/** L'exemple de la liste, tel qu'écrit : non prêt. */
const SPEC_BLOCKED = {
  id: 12, name: 'Gestion de stock', project_name: 'gestion-stock', app_type: 'django-angular',
  required_groups: ['developers'], updated_at: '2026-10-13T09:20:11+02:00',
  ready: false, blockers: [BLOCKER], counts: COUNTS,
};
const SPEC_READY = { ...SPEC_BLOCKED, ready: true, blockers: [] };

const KIT = {
  spec: { id: 12, name: 'Gestion de stock', updated_at: '2026-10-13T09:20:11+02:00' },
  create: { name: 'gestion-stock', type: 'django-angular', required_groups: ['developers'] },
  seed: {
    lots_md: '## Lot 2 — Modèles de données   ·   statut : à faire\n**Objectif :** …\n',
    cahier_des_charges_md: '# Cahier des charges — Gestion de stock\n…',
  },
  context: CONTEXT,
};

function recorder(reply: (path: string) => Observable<unknown>) {
  const paths: string[] = [];
  const client = new HandoffClient(path => { paths.push(path); return reply(path); });
  return { client, paths };
}

async function failure(o: Observable<unknown>): Promise<HandoffError> {
  try { await firstValueFrom(o); } catch (err) { return toHandoffError(err); }
  throw new Error('une erreur était attendue');
}

// ── I1 ───────────────────────────────────────────────────────────────────────

test('I1 liste : chemin, forme, ordre conservé, tableau vide', async () => {
  const other = { ...SPEC_READY, id: 7, name: 'Autre', project_name: '' };
  const { client, paths } = recorder(() => of([SPEC_BLOCKED, other]));
  const specs = await firstValueFrom(client.specs());
  assert.deepEqual(paths, ['/api/handoff/specs/']);
  assert.deepEqual(specs[0], SPEC_BLOCKED);
  assert.deepEqual(specs.map(s => s.id), [12, 7]);
  assert.equal(specs[0].ready, false);
  assert.equal(specs[0].blockers[0].message, BLOCKER.message);
  assert.equal(specs[1].ready, true);
  assert.equal(specs[1].project_name, '');

  assert.deepEqual(await firstValueFrom(recorder(() => of([])).client.specs()), []);
});

test('I1 liste : dans le doute, une spécification n\'est pas prête', async () => {
  const cases = [
    { ...SPEC_READY, blockers: [BLOCKER] },          // « prête » mais un point bloquant listé
    { ...SPEC_READY, ready: 'true' },                // pas un booléen
    { ...SPEC_READY, ready: undefined },
  ];
  const specs = await firstValueFrom(recorder(() => of(cases)).client.specs());
  assert.deepEqual(specs.map(s => s.ready), [false, false, false]);
  // Un champ hors contrat n'atteint pas l'état de la page ; une entrée sans identifiant est écartée.
  const odd = await firstValueFrom(recorder(() => of([{ ...SPEC_READY, chat_history: ['secret'] }, { name: 'sans id' }, null])).client.specs());
  assert.equal(odd.length, 1);
  assert.equal('chat_history' in odd[0], false);
});

test('I1 détail : chemin, description et estimations de contexte', async () => {
  const { client, paths } = recorder(() => of({ ...SPEC_READY, description: 'Suivi des entrées et sorties.', context: CONTEXT }));
  const detail = await firstValueFrom(client.spec(12));
  assert.deepEqual(paths, ['/api/handoff/specs/12/']);
  assert.equal(detail.description, 'Suivi des entrées et sorties.');
  assert.deepEqual(detail.context, CONTEXT);
  assert.equal(detail.ready, true);
  assert.deepEqual(detail.counts, COUNTS);
  // La réponse d'une AUTRE spécification n'est pas acceptée à la place.
  assert.equal((await failure(recorder(() => of({ ...SPEC_READY, id: 13 })).client.spec(12))).code, 'unexpected');
});

test('I1 kit 200 : chemin et contenu repris tel quel', async () => {
  const { client, paths } = recorder(() => of(KIT));
  const kit = await firstValueFrom(client.kit(12));
  assert.deepEqual(paths, ['/api/handoff/specs/12/kit/']);
  assert.deepEqual(kit, KIT);
});

test('I1 kit 409 : not_ready, avec ses points bloquants', async () => {
  const reply = () => throwError(() => ({ status: 409, error: { error: 'not_ready', blockers: [BLOCKER] } }));
  const e = await failure(recorder(reply).client.kit(12));
  assert.equal(e.code, 'not_ready');
  assert.equal(e.status, 409);
  assert.deepEqual(e.blockers, [BLOCKER]);
  // Un 409 d'une autre forme n'est pas pris pour un « pas prête ».
  assert.equal(toHandoffError({ status: 409, error: { detail: 'conflit' } }).code, 'unexpected');
});

test('I1 erreurs : 401, 403, 404, réseau coupé, proxy, adresse non configurée', async () => {
  const fail = (status: number, error: unknown = { detail: '…' }) =>
    failure(recorder(() => throwError(() => ({ status, error }))).client.specs());
  assert.equal((await fail(401)).code, 'unauthorized');
  const forbidden = await fail(403, { detail: "Vous n'avez pas la permission d'effectuer cette action." });
  assert.equal(forbidden.code, 'forbidden');
  assert.deepEqual(forbidden.blockers, []);
  assert.equal((await fail(404)).code, 'not_found');
  for (const status of [0, 502, 503, 504]) assert.equal((await fail(status, null)).code, 'unreachable', String(status));
  assert.equal((await fail(405)).code, 'unexpected');
  assert.equal((await fail(500, '<html>')).code, 'unexpected');
  // Liste : un 404 veut dire « API de remise pas servie », pas « spécification disparue ».
  assert.equal(toListError({ status: 404, error: null }).code, 'unreachable');
  assert.equal(toListError({ status: 403, error: null }).code, 'forbidden');
  // Sans `appBuilderApiUrl`, le service lève cette marque : aucun appel ne part.
  assert.equal((await failure(recorder(() => throwError(() => NOT_CONFIGURED)).client.specs())).code, 'not_configured');
  // Chaque erreur porte une phrase affichable, en français.
  for (const e of [await fail(0, null), forbidden, toHandoffError(NOT_CONFIGURED), toHandoffError(undefined)]) {
    assert.ok(e.detail.length > 20, e.code);
  }
});

test('I1 : une réponse 200 qui n\'a pas la forme du contrat est une erreur, jamais un kit', async () => {
  assert.equal((await failure(recorder(() => of({ results: [] })).client.specs())).code, 'unexpected');
  assert.equal((await failure(recorder(() => of('<!doctype html>')).client.specs())).code, 'unexpected');
  const bad = [
    null, [], 'texte',
    { ...KIT, spec: { ...KIT.spec, id: 13 } },                                  // kit d'une autre spécification
    { ...KIT, create: { ...KIT.create, type: 'spring' } },                      // type que le moteur ne construit pas
    { ...KIT, create: { ...KIT.create, name: 'Gestion Stock' } },               // pas un nom de projet
    { ...KIT, create: { ...KIT.create, name: 'gestion--stock' } },
    { ...KIT, create: { ...KIT.create, required_groups: [] } },
    { ...KIT, create: { ...KIT.create, required_groups: ['developers', 3] } },
    { ...KIT, create: { ...KIT.create, required_groups: 'developers' } },
    { ...KIT, seed: { lots_md: KIT.seed.lots_md } },                            // une clé manque
    { ...KIT, seed: { ...KIT.seed, cahier_des_charges_md: '' } },
    { ...KIT, seed: { ...KIT.seed, lots_md: 42 } },
    { spec: KIT.spec, create: KIT.create },
  ];
  for (const reply of bad) {
    assert.equal((await failure(recorder(() => of(reply)).client.kit(12))).code, 'unexpected', JSON.stringify(reply));
  }
});

// ── I2 ───────────────────────────────────────────────────────────────────────

test('I2 : corps EXACT envoyé au moteur, avec seed', async () => {
  const kit = await firstValueFrom(recorder(() => of(KIT)).client.kit(12));
  const calls: EngineRequest[] = [];
  const engine = new EngineClient(req => { calls.push(req); return of({ job_id: 'a1', kind: 'create', app: 'gestion-stock', state: 'queued', jobs_ahead: 0 }); });
  const ticket = await firstValueFrom(engine.createProject(seededProject(kit, 'private')));
  assert.equal(ticket.job_id, 'a1');
  // L'exemple du contrat (I2), mot pour mot.
  assert.deepEqual(calls, [{
    method: 'POST', path: '/projects',
    body: {
      name: 'gestion-stock', type: 'django-angular', visibility: 'private', required_groups: ['developers'],
      seed: { lots_md: KIT.seed.lots_md, cahier_des_charges_md: KIT.seed.cahier_des_charges_md },
    },
  }]);
  // La visibilité est celle choisie ; la graine a exactement deux clés, même si le kit en portait d'autres.
  const extra = { ...kit, seed: { ...kit.seed, path: '../../etc/passwd' } };
  const body = seededProject(extra, 'public');
  assert.equal(body.visibility, 'public');
  assert.deepEqual(Object.keys(body.seed ?? {}).sort(), ['cahier_des_charges_md', 'lots_md']);
  assert.deepEqual(Object.keys(body).sort(), ['name', 'required_groups', 'seed', 'type', 'visibility']);
});

test('I2 : sans seed, la création part comme avant', async () => {
  const calls: EngineRequest[] = [];
  const engine = new EngineClient(req => { calls.push(req); return of({}); });
  const np = { name: 'mon-app', type: 'django' as const, visibility: 'private' as const, required_groups: ['developers'] };
  await firstValueFrom(engine.createProject(np));
  assert.deepEqual(calls[0].body, np);
  assert.equal('seed' in (calls[0].body as object), false);
});

// ── Lancement : kit, puis contrôle du nom ────────────────────────────────────

function engineStub(reply: (name: string) => Observable<unknown>) {
  const calls: EngineRequest[] = [];
  const engine = new EngineClient(req => {
    calls.push(req);
    return req.path === '/projects/check-name' ? reply((req.body as { name: string }).name) : throwError(() => new Error('appel inattendu'));
  });
  return { engine, calls };
}

test('lancement : le kit est lu, puis le nom contrôlé par le moteur ; rien n\'est créé', async () => {
  const { client, paths } = recorder(() => of(KIT));
  const { engine, calls } = engineStub(() => of({ ok: true, reasons: [] }));
  const plan = await firstValueFrom(launchPlan(client, engine, 12));
  assert.deepEqual(paths, ['/api/handoff/specs/12/kit/']);
  assert.deepEqual(calls, [{ method: 'POST', path: '/projects/check-name', body: { name: 'gestion-stock' } }]);
  assert.deepEqual(plan.kit, KIT);
  assert.ok(planAllowsCreation(plan));
});

test('cas négatif : nom refusé par check-name → pas de création', async () => {
  const reasons = ['règle 6 : le chemin Caddy /gestion-stock est déjà servi (par gestion-stock)'];
  const { engine, calls } = engineStub(() => of({ ok: false, reasons }));
  const plan = await firstValueFrom(launchPlan(recorder(() => of(KIT)).client, engine, 12));
  assert.equal(planAllowsCreation(plan), false);
  assert.deepEqual(plan.name.reasons, reasons);
  assert.equal(calls.some(c => c.path === '/projects'), false);
  // Un verdict illisible ou un moteur en erreur vaut un refus, jamais un accord.
  for (const reply of [() => of({}), () => of(null), () => of({ ok: 'oui' }),
                       () => throwError(() => ({ status: 0, error: null })),
                       () => throwError(() => ({ status: 403, error: { error: 'forbidden', detail: 'Compte hors developers.' } }))]) {
    const p = await firstValueFrom(launchPlan(recorder(() => of(KIT)).client, engineStub(reply).engine, 12));
    assert.equal(planAllowsCreation(p), false);
  }
  const refused = await firstValueFrom(launchPlan(recorder(() => of(KIT)).client,
    engineStub(() => throwError(() => ({ status: 403, error: { error: 'forbidden', detail: 'Compte hors developers.' } }))).engine, 12));
  assert.deepEqual(refused.name.reasons, ['Compte hors developers.']);
  assert.equal(planAllowsCreation(null), false);
});

test('cas négatif : spec non prête → le moteur n\'est jamais sollicité', async () => {
  const { engine, calls } = engineStub(() => of({ ok: true, reasons: [] }));
  const notReady = recorder(() => throwError(() => ({ status: 409, error: { error: 'not_ready', blockers: [BLOCKER] } })));
  const e = await failure(launchPlan(notReady.client, engine, 12));
  assert.equal(e.code, 'not_ready');
  assert.equal(e.blockers[0].message, BLOCKER.message);
  assert.equal(calls.length, 0);
  // Même chose quand App Builder est injoignable ou refuse.
  for (const status of [0, 403, 404]) {
    await failure(launchPlan(recorder(() => throwError(() => ({ status, error: null }))).client, engine, 12));
  }
  assert.equal(calls.length, 0);
});

// ── Rapprochement spec ↔ projet, libellés ────────────────────────────────────

function project(name: string, owner: string): Project {
  return { name, owner, repo_url: null, urls: { app: null, api: null }, ports: { backend: null, frontend: null },
           state: 'never_deployed', deployed: null, workspace: { open: false } };
}

test('projet existant : rapproché par le nom, parmi les projets de l\'appelant seulement', () => {
  const list = [project('gestion-stock', 'hassan'), project('autre', 'hassan'), project('gestion-stock-2', 'hassan')];
  assert.equal(existingProject(SPEC_READY, list, 'hassan')?.name, 'gestion-stock');
  // Le superutilisateur voit tout le lab : le projet d'un autre n'est pas « le sien ».
  assert.equal(existingProject(SPEC_READY, [project('gestion-stock', 'alice')], 'hassan'), null);
  assert.equal(existingProject({ project_name: '' }, [project('', 'hassan')], 'hassan'), null);
  assert.equal(existingProject({ project_name: 'gestion' }, list, 'hassan'), null);
  assert.equal(existingProject(SPEC_READY, list, null), null);
  assert.equal(existingProject(SPEC_READY, [], 'hassan'), null);
});

test('libellés : type, nombres, estimations de contexte', () => {
  assert.equal(appTypeLabel('django-angular'), 'Django + Angular');
  assert.equal(appTypeLabel('spring-angular'), 'spring-angular');
  assert.equal(appTypeLabel(''), 'type non précisé');
  assert.equal(formatCount(4200), '4 200');
  assert.equal(formatCount(999), '999');
  assert.equal(formatCount(1234567), '1 234 567');
  const c = contextSummary(CONTEXT);
  assert.equal(c.share, 9);
  assert.equal(c.over, false);
  assert.match(c.cahier, /4 200 jetons/);
  assert.match(c.lot, /1 800 jetons sur 20 000 admis par lot \(9 %\)/);
  assert.equal(contextSummary({ cahier_tokens: 0, largest_lot_tokens: 25000, lot_budget_tokens: 20000 }).over, true);
  const unknown = contextSummary({ cahier_tokens: 10, largest_lot_tokens: 5, lot_budget_tokens: 0 });
  assert.equal(unknown.share, null);
  assert.equal(unknown.over, false);
});
