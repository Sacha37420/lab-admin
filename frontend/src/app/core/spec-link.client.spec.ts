/**
 * Passerelle App Builder → projet (chantier app-builder-v2, P2/P3, I7/I8) :
 * empreinte tolérée absente, titres de lots, spécification d'origine, ticket
 * « spécification modifiée » et lien enregistré par lab-admin. Sans Angular :
 *
 *     npm run test:engine
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { EngineClient, EngineRequest } from './engine.client';
import {
  HandoffClient, HandoffKit, HandoffSpec, TICKET_BODY_MAX, TICKET_TITLE_MAX, originSpec, roadmapTitles,
  specChanged, specUpdateTicket, tildeFence, transmitSpec,
} from './handoff.client';
import { SPEC_LINK_REFUSED, SpecLinkClient, linkFromKit } from './spec-link.client';

const FP_OLD = 'sha256:' + 'a'.repeat(64);
const FP_NEW = 'sha256:' + '0123456789abcdef'.repeat(4);

const LOTS = [
  '## Lot 2 — Modèles de données   ·   statut : à faire',
  '**Objectif :** …',
  '# Pas un lot',
  '## Lot 3 — Pages · statut : à faire\t',
  '## Lot 4 — Déjà livré · statut : livré',
  '## Lot 5 —   · statut : à faire',
].join('\n') + '\n';

const SPEC = {
  id: 12, name: 'Gestion de stock', project_name: 'gestion-stock', app_type: 'django-angular',
  required_groups: ['developers'], updated_at: '2026-10-13T09:20:11+02:00', ready: true, blockers: [],
  counts: { data_models: 3, endpoints: 12, pages: 4, lots: 5 },
};

const KIT = {
  spec: { id: 12, name: 'Gestion de stock', updated_at: '2026-11-11T09:20:11+01:00', fingerprint: FP_NEW },
  create: { name: 'gestion-stock', type: 'django-angular', required_groups: ['developers'] },
  seed: { lots_md: LOTS, cahier_des_charges_md: '# Cahier des charges — Gestion de stock\n\n## Modèles\n…\n' },
  context: { cahier_tokens: 4200, largest_lot_tokens: 1800, lot_budget_tokens: 20000 },
};

function handoff(reply: unknown) {
  const paths: string[] = [];
  return { client: new HandoffClient(p => { paths.push(p); return of(reply); }), paths };
}

// ── I7 : `fingerprint` — reprise si bien formée, absente sinon ───────────────

test('I7 : empreinte reprise dans la liste et le kit ; absente ou mal formée → clé non posée', async () => {
  const list = await firstValueFrom(handoff([
    { ...SPEC, fingerprint: FP_NEW }, { ...SPEC, id: 13 }, { ...SPEC, id: 14, fingerprint: 'sha256:XYZ' },
  ]).client.specs());
  assert.equal(list[0].fingerprint, FP_NEW);
  assert.equal('fingerprint' in list[1], false);
  assert.equal('fingerprint' in list[2], false);
  const kit = await firstValueFrom(handoff(KIT).client.kit(12));
  assert.equal(kit.spec.fingerprint, FP_NEW);
  const old = await firstValueFrom(handoff({ ...KIT, spec: { id: 12, name: 'x', updated_at: '' } }).client.kit(12));
  assert.equal('fingerprint' in old.spec, false);
  assert.deepEqual(linkFromKit(old), { spec_id: 12, fingerprint: '' });
  assert.deepEqual(linkFromKit(kit), { spec_id: 12, fingerprint: FP_NEW });
});

// ── P2 : aperçu des lots ─────────────────────────────────────────────────────

test('P2 : titres des lots « à faire » seulement, par l\'expression de seed.py', () => {
  assert.deepEqual(roadmapTitles(LOTS), [
    { number: 2, title: 'Modèles de données' },
    { number: 3, title: 'Pages' },
    { number: 5, title: 'Lot 5' },
  ]);
  assert.deepEqual(roadmapTitles(''), []);
  assert.deepEqual(roadmapTitles('du texte\nsans titre de lot\n'), []);
  assert.deepEqual(roadmapTitles(undefined as unknown as string), []);
  const forty = Array.from({ length: 40 }, (_, i) => `## Lot ${i + 2} — Lot métier ${i + 2} · statut : à faire\ncorps`).join('\n');
  const t = roadmapTitles(forty);
  assert.equal(t.length, 40);
  assert.deepEqual(t[39], { number: 41, title: 'Lot métier 41' });
  // Un « \r » n'est pas une fin de ligne (comme le moteur) ; un titre très long est coupé.
  assert.deepEqual(roadmapTitles('## Lot 2 — a\r## Lot 3 — b · statut : à faire'), [{ number: 2, title: 'a ## Lot 3 — b' }]);
  assert.equal(Array.from(roadmapTitles(`## Lot 2 — ${'é'.repeat(500)} · statut : à faire`)[0].title).length, 200);
});

// ── P2 : spécification d'origine ─────────────────────────────────────────────

test('P2 : origine par le lien d\'abord, puis par le nom ; lien vers une spec disparue signalé', () => {
  const specs = [SPEC, { ...SPEC, id: 7, project_name: 'autre' }] as HandoffSpec[];
  assert.deepEqual(originSpec('gestion-stock', specs, null), { spec: specs[0], via: 'name', missingId: null });
  // Spécification renommée : le lien la retrouve encore.
  const renamed = [{ ...SPEC, project_name: 'stock-v2' }] as HandoffSpec[];
  assert.equal(originSpec('gestion-stock', renamed, { app: 'gestion-stock', spec_id: 12, fingerprint: '' }).spec?.id, 12);
  assert.equal(originSpec('gestion-stock', renamed, null).spec, null);
  // Le lien prime sur le nom.
  assert.equal(originSpec('autre', specs, { app: 'autre', spec_id: 12, fingerprint: '' }).spec?.id, 12);
  assert.deepEqual(originSpec('gestion-stock', specs, { app: 'gestion-stock', spec_id: 99, fingerprint: '' }),
                   { spec: null, via: 'link', missingId: 99 });
  // Un lien d'un AUTRE projet n'est pas pris pour celui-ci.
  assert.equal(originSpec('gestion-stock', specs, { app: 'autre', spec_id: 7, fingerprint: '' }).spec?.id, 12);
  assert.deepEqual(originSpec('', specs, null), { spec: null, via: null, missingId: null });
});

test('P3 : « modifiée » seulement si les deux empreintes sont connues et diffèrent', () => {
  assert.equal(specChanged({ fingerprint: FP_OLD }, { fingerprint: FP_NEW }), true);
  assert.equal(specChanged({ fingerprint: FP_NEW }, { fingerprint: FP_NEW }), false);
  assert.equal(specChanged({ fingerprint: '' }, { fingerprint: FP_NEW }), false);
  assert.equal(specChanged({ fingerprint: FP_OLD }, {}), false);
  assert.equal(specChanged(null, { fingerprint: FP_NEW }), false);
  assert.equal(specChanged({ fingerprint: FP_OLD }, null), false);
  assert.equal(specChanged({ fingerprint: 'sha256:x' }, { fingerprint: FP_NEW }), false);
});

// ── P3 : le ticket ──────────────────────────────────────────────────────────

/** Lignes du corps HORS de tout bloc `~~~` (règle de fermeture CommonMark : même caractère, au moins aussi long). */
function outsideFences(body: string): string[] {
  const out: string[] = [];
  let open: string | null = null;
  for (const line of body.split(/\r\n|\r|\n/)) {
    if (open === null) {
      const m = /^ {0,3}(~{3,})/.exec(line);
      if (m) { open = m[1]; continue; }
      out.push(line);
    } else {
      const m = /^ {0,3}(~{3,})[ \t]*$/.exec(line);
      if (m && m[1].length >= open.length) open = null;
    }
  }
  return out;
}

/** Les seuls titres Markdown du gabarit. */
const OWN_HEADINGS = ['## Lots de la nouvelle version', '## Cahier des charges (nouvelle version)'];

function assertTicketRules(t: { title: string; body: string; scope: string }) {
  assert.equal(t.scope, 'app');
  assert.ok(t.title.length > 0 && Array.from(t.title).length <= TICKET_TITLE_MAX, `titre ${t.title.length}`);
  assert.ok(!/[\n\r]/.test(t.title));
  assert.ok(t.body.length <= TICKET_BODY_MAX, `corps ${t.body.length}`);
  for (const line of outsideFences(t.body)) {
    if (line.startsWith('#')) assert.ok(OWN_HEADINGS.includes(line), `ligne « # » hors bloc : ${line.slice(0, 80)}`);
  }
}

test('P3 : forme du ticket — marqueur, lots en liste, cahier en bloc ~~~', () => {
  const t = specUpdateTicket(KIT as HandoffKit, 'https://lab.example/app-builder/');
  assertTicketRules(t);
  assert.equal(t.title, 'Spécification App Builder n° 12 modifiée — Gestion de stock');
  assert.equal(t.body.split('\n')[0], `<!-- lab-spec-update id=12 fingerprint=${FP_NEW} -->`);
  assert.match(t.body, /\n- Lot 2 — Modèles de données\n- Lot 3 — Pages\n- Lot 5 — Lot 5\n/);
  assert.match(t.body, /\n~~~markdown\n# Cahier des charges — Gestion de stock\n/);
  assert.match(t.body, /État transmis : 2026-11-11T09:20:11\+01:00\./);
  assert.ok(t.body.endsWith('~~~\n'));
  // Sans empreinte (ancienne image d'App Builder) : marqueur sans `fingerprint=`.
  const old = specUpdateTicket({ ...KIT, spec: { id: 12, name: '', updated_at: 'pas une date' } } as HandoffKit);
  assertTicketRules(old);
  assert.equal(old.body.split('\n')[0], '<!-- lab-spec-update id=12 -->');
  assert.equal(old.title, 'Spécification App Builder n° 12 modifiée');
  assert.doesNotMatch(old.body, /État transmis/);
});

test('P3 : un cahier de 200 000 caractères n\'est pas recopié, le corps reste sous 60 000 et renvoie à App Builder', () => {
  const big = '# Titre\n' + ('x'.repeat(99) + '\n').repeat(2000);
  assert.ok(big.length >= 200_000);
  const lots40 = Array.from({ length: 40 }, (_, i) => `## Lot ${i + 2} — ${'L'.repeat(300)} · statut : à faire`).join('\n');
  const t = specUpdateTicket({ ...KIT, seed: { lots_md: lots40, cahier_des_charges_md: big } } as HandoffKit,
                             'https://lab.example/app-builder/');
  assertTicketRules(t);
  assert.doesNotMatch(t.body, /~~~/);
  assert.match(t.body, /Trop long pour un ticket \(200\u202f008 caractères\) : le lire dans App Builder, page Livrables — https:\/\/lab\.example\/app-builder\/\?spec=12\n$/);
  // Juste au-dessus du seuil, même chose ; juste en dessous, recopié.
  const at = (n: number) => specUpdateTicket({ ...KIT, seed: { lots_md: LOTS, cahier_des_charges_md: 'y'.repeat(n) } } as HandoffKit);
  assert.match(at(55_001).body, /Trop long/);
  assert.match(at(55_000).body, /~~~markdown\n/);
  assertTicketRules(at(55_000));
  // Titre : un nom de spécification interminable est coupé.
  const long = specUpdateTicket({ ...KIT, spec: { ...KIT.spec, name: 'N'.repeat(5000) } } as HandoffKit);
  assertTicketRules(long);
  // Plus de 60 lots : la liste est bornée.
  const many = Array.from({ length: 90 }, (_, i) => `## Lot ${i + 2} — x · statut : à faire`).join('\n');
  const m = specUpdateTicket({ ...KIT, seed: { ...KIT.seed, lots_md: many } } as HandoffKit);
  assertTicketRules(m);
  assert.match(m.body, /… et 30 autre\(s\) lot\(s\)/);
});

test('P3 cas négatif : la spécification ne peut faire sortir aucun « # » du bloc', () => {
  const hostile = [
    '# Cahier', '~~~', '# Sorti ?', '~~~~~~', '## Encore', '   ~~~~~~~ ', '# Et là', '~~~\r# Retour chariot',
    'texte\u0000# NUL',
  ].join('\n');
  const t = specUpdateTicket({
    ...KIT,
    spec: { ...KIT.spec, name: 'Nom\n# Injecté\r\n## Lots de la nouvelle version' },
    seed: { lots_md: '## Lot 2 — # titre piégé · statut : à faire\n# Ligne libre\n', cahier_des_charges_md: hostile },
  } as HandoffKit);
  assertTicketRules(t);
  // La clôture est plus longue que toute suite de « ~ » du cahier.
  assert.equal(tildeFence(hostile.replace(/\r/g, '\n')), '~'.repeat(8));
  assert.match(t.body, /\n~~~~~~~~markdown\n/);
  assert.match(t.body, /\n- Lot 2 — # titre piégé\n/);
  assert.doesNotMatch(t.body, /\u0000|\r/);
  assert.equal(t.title.includes('\n'), false);
  // Le titre ne recopie jamais de quoi fermer le marqueur.
  assert.equal(t.body.split('\n')[0], `<!-- lab-spec-update id=12 fingerprint=${FP_NEW} -->`);
});

test('P3 cas négatif : ni jeton ni historique de conversation dans le ticket', async () => {
  // Un kit qui porterait des champs hors contrat : la lecture les écarte, le ticket ne les voit pas.
  const dirty = {
    ...KIT, chat_history: [{ role: 'user', content: 'SECRET-CHAT' }], token: 'eyJSECRET',
    spec: { ...KIT.spec, chat_history: 'SECRET-CHAT', access_token: 'eyJSECRET' },
    seed: { ...KIT.seed, ai_key: 'sk-ant-SECRET' },
  };
  const kit = await firstValueFrom(handoff(dirty).client.kit(12));
  const t = specUpdateTicket(kit, 'https://lab.example/app-builder/');
  for (const needle of ['SECRET', 'chat_history', 'eyJ', 'sk-ant', 'Bearer']) {
    assert.equal(t.body.includes(needle) || t.title.includes(needle), false, needle);
  }
  // Une adresse d'App Builder douteuse n'est pas recopiée.
  const big = { ...KIT, seed: { ...KIT.seed, cahier_des_charges_md: 'z'.repeat(60_000) } } as HandoffKit;
  assert.doesNotMatch(specUpdateTicket(big, 'javascript:alert(1)').body, /javascript/);
});

// ── P3 : envoi au moteur (double) puis mise à jour du lien ───────────────────

function linkStore(fail = false) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client = new SpecLinkClient((method, path, body) => {
    calls.push(body === undefined ? { method, path } : { method, path, body });
    if (fail) return throwError(() => ({ status: 500, error: null }));
    return of({ app: 'gestion-stock', ...(body as object), created_at: '2026-11-11T10:00:00Z' });
  });
  return { client, calls };
}

test('P3 : « Transmettre » — kit relu, corps EXACT envoyé au moteur, lien mis à jour', async () => {
  const h = handoff(KIT);
  const engineCalls: EngineRequest[] = [];
  const engine = new EngineClient(req => {
    engineCalls.push(req);
    return of({ repository: 'hassan-gh/gestion-stock', number: 7, url: 'https://github.com/hassan-gh/gestion-stock/issues/7' });
  });
  const links = linkStore();
  const r = await firstValueFrom(transmitSpec(h.client, engine, links.client, 'gestion-stock', 12, 'https://lab.example/app-builder/'));
  assert.deepEqual(h.paths, ['/api/handoff/specs/12/kit/']);
  const kit = await firstValueFrom(handoff(KIT).client.kit(12));
  const expected = specUpdateTicket(kit, 'https://lab.example/app-builder/');
  assert.deepEqual(engineCalls, [{ method: 'POST', path: '/projects/gestion-stock/tickets', body: expected }]);
  assert.deepEqual(Object.keys(engineCalls[0].body as object).sort(), ['body', 'scope', 'title']);
  assert.deepEqual(links.calls, [{ method: 'PUT', path: '/api/spec-links/gestion-stock/', body: { spec_id: 12, fingerprint: FP_NEW } }]);
  assert.equal(r.ticket.number, 7);
  assert.equal(r.link?.fingerprint, FP_NEW);
  // Lien impossible à écrire : le ticket ouvert est rendu quand même.
  const broken = await firstValueFrom(transmitSpec(handoff(KIT).client, engine, linkStore(true).client, 'gestion-stock', 12, null));
  assert.equal(broken.ticket.number, 7);
  assert.equal(broken.link, null);
});

test('P3 cas négatif : spec non prête ou moteur en erreur → rien d\'écrit', async () => {
  const notReady = new HandoffClient(() => throwError(() => ({ status: 409, error: { error: 'not_ready', blockers: [] } })));
  const engineCalls: EngineRequest[] = [];
  const engine = new EngineClient(req => { engineCalls.push(req); return of({}); });
  const links = linkStore();
  await assert.rejects(firstValueFrom(transmitSpec(notReady, engine, links.client, 'gestion-stock', 12, null)),
                       (e: { stage?: string; cause?: { status?: number } }) => e.stage === 'kit' && e.cause?.status === 409);
  assert.equal(engineCalls.length, 0);
  assert.equal(links.calls.length, 0);
  const refusing = new EngineClient(() => throwError(() => ({ status: 409, error: { error: 'github_not_linked' } })));
  await assert.rejects(firstValueFrom(transmitSpec(handoff(KIT).client, refusing, links.client, 'gestion-stock', 12, null)),
                       (e: { stage?: string }) => e.stage === 'ticket');
  assert.equal(links.calls.length, 0);
});

// ── I8 : client du lien ──────────────────────────────────────────────────────

test('I8 : chemins, 404 = aucun lien, valeurs refusées avant tout appel', async () => {
  const calls: string[] = [];
  const reply = (status: number | null, body: unknown = null) => new SpecLinkClient((m, p) => {
    calls.push(`${m} ${p}`);
    return status === null ? of(body) : throwError(() => ({ status, error: body }));
  });
  assert.deepEqual(await firstValueFrom(reply(null, { app: 'gestion-stock', spec_id: 12, fingerprint: FP_OLD, created_at: 'x' }).get('gestion-stock')),
                   { app: 'gestion-stock', spec_id: 12, fingerprint: FP_OLD, created_at: 'x' });
  assert.equal(await firstValueFrom(reply(404).get('gestion-stock')), null);
  await assert.rejects(firstValueFrom(reply(500).get('gestion-stock')));
  // Réponse d'un autre projet, ou sans numéro : refusée.
  await assert.rejects(firstValueFrom(reply(null, { app: 'autre', spec_id: 12 }).get('gestion-stock')));
  await assert.rejects(firstValueFrom(reply(null, { app: 'gestion-stock', spec_id: '12' }).get('gestion-stock')));
  // Empreinte mal formée renvoyée : lue comme absente.
  assert.equal((await firstValueFrom(reply(null, { app: 'gestion-stock', spec_id: 1, fingerprint: 'x' }).get('gestion-stock')))?.fingerprint, '');
  assert.deepEqual(calls, Array(6).fill('GET /api/spec-links/gestion-stock/'));
  calls.length = 0;
  const c = reply(null, {});
  for (const o of [c.get('../x'), c.get('Gestion'), c.put('gestion-stock', { spec_id: 0, fingerprint: '' }),
                   c.put('gestion-stock', { spec_id: 1.5, fingerprint: '' }), c.put('gestion-stock', { spec_id: 1, fingerprint: 'md5:x' }),
                   c.put('a/b', { spec_id: 1, fingerprint: '' })] as Observable<unknown>[]) {
    await assert.rejects(firstValueFrom(o), (e: unknown) => e === SPEC_LINK_REFUSED);
  }
  assert.deepEqual(calls, []);
});
