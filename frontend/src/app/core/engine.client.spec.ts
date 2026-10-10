/**
 * Tests du client du moteur, avec des réponses CONFORMES à lab-mcp/API.md
 * (recopiées de ses exemples). Sans Angular ni navigateur :
 *
 *     npm run test:engine
 *
 * Ce qu'ils tiennent : méthode, chemin, corps et paramètres de chaque route ;
 * la normalisation des erreurs ; l'arrêt du suivi d'un job ; les quatre profils.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Observable, firstValueFrom, lastValueFrom, of, throwError, toArray } from 'rxjs';
import {
  EngineClient, EngineRequest, Job, Me, deployVerdicts, profileOf, repoPage, testCases,
  toEngineError, ENV_KEY_RE, APP_NAME_RE, isWorkspaceUrl, stateLabel, verdictLabel,
} from './engine.client';

function recorder(reply: (req: EngineRequest) => Observable<unknown> = () => of({})) {
  const calls: EngineRequest[] = [];
  const client = new EngineClient(req => { calls.push(req); return reply(req); });
  return { client, calls };
}

const ME: Me = {
  username: 'hassan', uid: 'hassan', is_superuser: false, eligible: true, ineligible_reason: null,
  initialized: true, github_linked: true,
  github: { account: 'hassan-gh', scope: 'read:user,repo', connect_url: 'https://lab/oauth-hub/providers?connect=github' },
  database: { host: 'postgres', name: 'dev_hassan', user: 'dev_hassan' },
  mcp_url: 'https://lab/mcp', oauth_hub_url: 'https://lab/oauth-hub/', workspace: { open: false },
  scope_app: null, viewed_as: null, remaining: [],
};

function job(over: Partial<Job>): Job {
  return {
    job_id: 'd359abbb4186de01', kind: 'deploy', app: 'mon-app', state: 'running', terminal: false,
    step: 'setup', launched_by: 'hassan', created_at: '2026-10-10T14:37:08Z', started_at: '2026-10-10T14:37:09Z',
    ended_at: null, jobs_ahead: 0, log_lines_total: 2, log: ['══ [lab-mcp] étape « sync »', '…'], result: null,
    ...over,
  };
}

test('chaque route : méthode, chemin, corps, paramètres', async () => {
  const { client, calls } = recorder();
  const run = async (o: Observable<unknown>) => { await firstValueFrom(o); return calls.pop(); };

  assert.deepEqual(await run(client.me()), { method: 'GET', path: '/me' });
  assert.deepEqual(await run(client.me('hassan')), { method: 'GET', path: '/me', params: { as: 'hassan' } });
  assert.deepEqual(await run(client.meInit()), { method: 'POST', path: '/me/init' });
  assert.deepEqual(await run(client.groups()), { method: 'GET', path: '/groups' });
  assert.deepEqual(await run(client.devs()), { method: 'GET', path: '/devs' });
  assert.deepEqual(await run(client.projects()), { method: 'GET', path: '/projects' });
  assert.deepEqual(await run(client.projects('alice')), { method: 'GET', path: '/projects', params: { as: 'alice' } });
  assert.deepEqual(await run(client.checkName('mon-app')),
    { method: 'POST', path: '/projects/check-name', body: { name: 'mon-app' } });
  const np = { name: 'mon-app', type: 'django-angular' as const, visibility: 'private' as const, required_groups: ['developers'] };
  assert.deepEqual(await run(client.createProject(np)), { method: 'POST', path: '/projects', body: np });
  assert.deepEqual(await run(client.project('mon-app')), { method: 'GET', path: '/projects/mon-app' });
  assert.deepEqual(await run(client.deploy('mon-app')), { method: 'POST', path: '/projects/mon-app/deploy', body: {} });
  assert.deepEqual(await run(client.deploy('mon-app', '6d7b9d5')),
    { method: 'POST', path: '/projects/mon-app/deploy', body: { sha: '6d7b9d5' } });
  assert.deepEqual(await run(client.commits('mon-app')), { method: 'GET', path: '/projects/mon-app/commits' });
  assert.deepEqual(await run(client.logs('mon-app')), { method: 'GET', path: '/projects/mon-app/logs' });
  assert.deepEqual(await run(client.logs('mon-app', 'backend', 500)),
    { method: 'GET', path: '/projects/mon-app/logs', params: { service: 'backend', tail: '500' } });
  assert.deepEqual(await run(client.envList('mon-app')), { method: 'GET', path: '/projects/mon-app/env' });
  assert.deepEqual(await run(client.envSet('mon-app', 'MA_CLE', 'a b')),
    { method: 'PUT', path: '/projects/mon-app/env/MA_CLE', body: { value: 'a b' } });
  assert.deepEqual(await run(client.envUnset('mon-app', 'MA_CLE')),
    { method: 'DELETE', path: '/projects/mon-app/env/MA_CLE' });
  assert.deepEqual(await run(client.sql('mon-app', 'select 1')),
    { method: 'POST', path: '/projects/mon-app/sql', body: { query: 'select 1' } });
  assert.deepEqual(await run(client.runTests('mon-app')), { method: 'POST', path: '/projects/mon-app/tests' });
  assert.deepEqual(await run(client.openTicket('mon-app', { title: 't', body: 'b', scope: 'lab' })),
    { method: 'POST', path: '/projects/mon-app/tickets', body: { title: 't', body: 'b', scope: 'lab' } });
  assert.deepEqual(await run(client.setAutoDeploy('mon-app', true)),
    { method: 'PUT', path: '/projects/mon-app/auto-deploy', body: { enabled: true } });
  assert.deepEqual(await run(client.workspaceOpen('mon-app')), { method: 'POST', path: '/projects/mon-app/workspace' });
  assert.deepEqual(await run(client.workspaceClose('mon-app')), { method: 'DELETE', path: '/projects/mon-app/workspace' });
  assert.deepEqual(await run(client.job('d359abbb4186de01')),
    { method: 'GET', path: '/jobs/d359abbb4186de01', params: { tail: '200' } });
  assert.equal(calls.length, 0);
});

test('un nom ou une clé piégés ne changent pas de route', async () => {
  const { client, calls } = recorder();
  await firstValueFrom(client.project('../devs'));
  await firstValueFrom(client.envUnset('a/b', '../../me/init'));
  await firstValueFrom(client.job('x/../../projects'));
  await firstValueFrom(client.logs('app?as=sacha'));
  assert.deepEqual(calls.map(c => c.path), [
    '/projects/..%2Fdevs',
    '/projects/a%2Fb/env/..%2F..%2Fme%2Finit',
    '/jobs/x%2F..%2F..%2Fprojects',
    '/projects/app%3Fas%3Dsacha/logs',
  ]);
});

test('erreurs du moteur (API.md §2)', () => {
  const linked = toEngineError({ status: 409, error: {
    error: 'github_not_linked', detail: 'Reliez votre compte GitHub.', connect_url: 'https://lab/oauth-hub/providers?connect=github' } });
  assert.equal(linked.code, 'github_not_linked');
  assert.equal(linked.detail, 'Reliez votre compte GitHub.');
  assert.equal(linked.connectUrl, 'https://lab/oauth-hub/providers?connect=github');

  const name = toEngineError({ status: 400, error: { error: 'name_refused', detail: 'Nom refusé.', reasons: ['règle 4 : …', 7] } });
  assert.deepEqual(name.reasons, ['règle 4 : …']);

  const exists = toEngineError({ status: 409, error: { error: 'job_exists', detail: 'Déjà en cours.', job_id: 'abc' } });
  assert.equal(exists.jobId, 'abc');

  const sql = toEngineError({ status: 400, error: { error: 'sql_error', detail: 'permission denied for table x', sqlstate: '42501' } });
  assert.equal(sql.sqlstate, '42501');

  const limit = toEngineError({ status: 429, error: { error: 'workspace_limit', detail: 'Trop d\'espaces.', open: 3, max: 3 } });
  assert.deepEqual([limit.open, limit.max], [3, 3]);

  const up = toEngineError({ status: 502, error: { error: 'upstream', detail: 'GitHub ne répond pas.', service: 'github' } });
  assert.equal(up.code, 'upstream');           // un 502 DU MOTEUR n'est pas « moteur absent »
  assert.equal(up.service, 'github');
});

test('moteur absent ou réponse non JSON', () => {
  // Moteur non déployé : Caddy rend sa page 404 (HTML) ; réseau coupé : status 0.
  for (const e of [{ status: 0, error: null }, { status: 404, error: '<html>404</html>' },
                   { status: 502, error: 'Bad Gateway' }, { status: 504 }, undefined, null]) {
    assert.equal(toEngineError(e).code, 'no_engine');
  }
  assert.equal(toEngineError({ status: 500, error: 'boom' }).code, 'unexpected');
  assert.equal(toEngineError({ status: 404, error: { error: 'not_found', detail: 'Projet introuvable.' } }).code, 'not_found');
  // Jamais de detail vide.
  assert.ok(toEngineError({ status: 403, error: { error: 'forbidden' } }).detail.length > 0);
});

test('les quatre profils (API.md §3.1)', () => {
  const sacha = { ...ME, username: 'sacha', uid: 'sacha', is_superuser: true };
  const e2e = { ...ME, username: 'e2e_member', uid: null, eligible: false, ineligible_reason: 'invalid_uid' as const, initialized: false };
  const lea = { ...ME, username: 'lea', uid: 'lea', eligible: false, ineligible_reason: 'not_in_developers' as const, initialized: false };
  assert.equal(profileOf(sacha, true), 'superuser');
  assert.equal(profileOf(ME, false), 'dev');
  assert.equal(profileOf(ME, true), 'dev');            // admin ET dev : ses projets, plus l'administration
  assert.equal(profileOf(e2e, true), 'admin_only');
  assert.equal(profileOf(lea, false), 'none');
  assert.equal(profileOf(e2e, false), 'none');         // dans developers, uid invalide, pas admin
});

test('suivi d\'un job : s\'arrête à terminal, dernier état compris', async () => {
  const states: Job[] = [
    job({ state: 'queued', step: null, jobs_ahead: 1 }),
    job({ state: 'running', step: 'sync' }),
    job({ state: 'running', step: 'setup' }),
    job({ state: 'succeeded', terminal: true, step: 'done', ended_at: '2026-10-10T14:40:00Z',
          result: { ok: true, step: 'done', sha: '6d7b9d5d', at: '2026-10-10T16:40:12+02:00',
                    tests: { backend: 'ok', cloisonnement: 'non-lancé' }, exit_code: 0 } }),
    job({ state: 'running', step: 'JAMAIS LU' }),
  ];
  let n = 0;
  const { client, calls } = recorder(() => of(states[n++]));
  const seen = await lastValueFrom(client.watchJob('d359abbb4186de01', 1).pipe(toArray()));
  assert.deepEqual(seen.map(j => j.step), [null, 'sync', 'setup', 'done']);
  assert.equal(calls.length, 4);
  assert.deepEqual(deployVerdicts(seen[3].result), { backend: 'ok', cloisonnement: 'non-lancé' });
  assert.deepEqual(testCases(seen[3].result), []);
});

test('suivi d\'un job : échec et job perdu', async () => {
  const failed = job({ state: 'failed', terminal: true, step: 'validate', result: {
    ok: false, step: 'validate', error: 'Dépôt refusé.', reasons: ['[privileged] …'], exit_code: 1 } });
  const a = recorder(() => of(failed));
  const last = await lastValueFrom(a.client.watchJob('x', 1));
  assert.equal(last.result?.ok, false);
  assert.deepEqual(last.result?.reasons, ['[privileged] …']);
  assert.equal(a.calls.length, 1);

  // Moteur redémarré : 404 not_found — le suivi s'arrête sur l'erreur, il ne boucle pas.
  const b = recorder(() => throwError(() => ({ status: 404, error: { error: 'not_found', detail: 'Job inconnu.' } })));
  await assert.rejects(lastValueFrom(b.client.watchJob('x', 1)), (e: unknown) => toEngineError(e).code === 'not_found');
  assert.equal(b.calls.length, 1);
});

test('job de tests : « aucun test trouvé » n\'est jamais un succès', () => {
  const none = job({ kind: 'tests', state: 'failed', terminal: true, step: 'cloisonnement',
    result: { ok: false, step: 'cloisonnement', found: false, all_passed: false, summary: 'aucun test trouvé', tests: [] } });
  assert.equal(none.result?.ok, false);
  assert.deepEqual(testCases(none.result), []);
  assert.equal(deployVerdicts(none.result), null);
  const ok = job({ kind: 'tests', state: 'succeeded', terminal: true, result: { ok: true, found: true, all_passed: true,
    summary: '3/3 test(s) réussi(s)', tests: [{ title: 't', status: 'PASSED', message: '', duration_ms: 4100 }] } });
  assert.equal(testCases(ok.result).length, 1);
});

test('aides de saisie', () => {
  assert.equal(repoPage('https://github.com/hassan-gh/mon-app.git'), 'https://github.com/hassan-gh/mon-app');
  assert.equal(repoPage('javascript:alert(1)'), null);
  assert.equal(repoPage('git@github.com:a/b.git'), null);
  assert.equal(repoPage(null), null);
  const origin = 'https://lab.example.org';
  assert.ok(isWorkspaceUrl('https://lab.example.org/ws/hassan/?ticket=abc', origin));
  for (const bad of ['https://evil.example/ws/hassan/?ticket=abc', 'javascript:alert(1)', '/ws/hassan/',
                     'https://lab.example.org/mcp/api/devs', 'http://lab.example.org/ws/hassan/',
                     'https://lab.example.org.evil.io/ws/x/', '', null, undefined, 42]) {
    assert.equal(isWorkspaceUrl(bad, origin), false, String(bad));
  }
  assert.equal(stateLabel('running'), 'en service');
  assert.equal(stateLabel('etat-futur'), 'etat-futur');      // valeur inconnue : affichée telle quelle
  assert.equal(verdictLabel('non-lancé'), 'non lancés');
  assert.ok(ENV_KEY_RE.test('MA_CLE_API') && !ENV_KEY_RE.test('ma_cle') && !ENV_KEY_RE.test('A/B'));
  assert.ok(APP_NAME_RE.test('mon-app') && !APP_NAME_RE.test('Mon-App') && !APP_NAME_RE.test('a'));
});
