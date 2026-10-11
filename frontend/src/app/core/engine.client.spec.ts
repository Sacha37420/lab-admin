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
  toEngineError, projectSections, smtpIsStale, smtpBody, smtpProblems, SMTP_DEFAULT_PORT, githubGapLabel, projectCounts, Project, ENV_KEY_RE, APP_NAME_RE, isPgadminUrl, isWorkspaceUrl, stateLabel, verdictLabel,
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
  assert.deepEqual(await run(client.projects(null, true)), { method: 'GET', path: '/projects', params: { refresh: '1' } });
  assert.deepEqual(await run(client.projects('alice', true)), { method: 'GET', path: '/projects', params: { as: 'alice', refresh: '1' } });
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
  // I9 (contrat v7) — soi-même uniquement : aucun paramètre, aucun corps.
  assert.deepEqual(await run(client.databasePassword()), { method: 'GET', path: '/me/database-password' });
  assert.deepEqual(await run(client.pgadminOpen()), { method: 'POST', path: '/me/pgadmin' });
  assert.deepEqual(await run(client.pgadminClose()), { method: 'DELETE', path: '/me/pgadmin' });
  assert.equal(calls.length, 0);
});

test('I9 : formes exactes, erreurs nommées, adresse de pgAdmin', async () => {
  const reply = { database: { host: 'postgres', name: 'dev_hassan', user: 'dev_hassan' }, gis: null,
                  password: 'S3cret', gis_password: null };
  const { client } = recorder(() => of(reply));
  const got = await firstValueFrom(client.databasePassword());
  assert.equal(got.password, 'S3cret');
  assert.equal(got.gis, null);

  const trust = toEngineError({ status: 409, error: { error: 'pg_trust_enabled', detail: 'Base non verrouillée.' } });
  assert.equal(trust.code, 'pg_trust_enabled');
  assert.equal(toEngineError({ status: 429, error: { error: 'pgadmin_limit', detail: 'Plafond atteint.' } }).code, 'pgadmin_limit');
  // I9 dit 403 pour not_initialized, API.md 409 : c'est le CODE qui compte, pas le statut.
  assert.equal(toEngineError({ status: 403, error: { error: 'not_initialized', detail: '…' } }).code, 'not_initialized');
  assert.equal(toEngineError({ status: 409, error: { error: 'not_initialized', detail: '…' } }).code, 'not_initialized');

  const origin = 'https://lab.example.org';
  assert.ok(isPgadminUrl('https://lab.example.org/pg/hassan/?ticket=abc', origin));
  for (const bad of ['https://lab.example.org/ws/hassan/?ticket=abc', 'https://evil.example/pg/hassan/',
                     'http://lab.example.org/pg/hassan/', 'https://lab.example.org/pgadmin', 'javascript:alert(1)',
                     'https://lab.example.org@evil.example/pg/x/', '//evil.example/pg/x/', null]) {
    assert.equal(isPgadminUrl(bad, origin), false, String(bad));
  }
  assert.equal(isWorkspaceUrl('https://lab.example.org/pg/hassan/', origin), false);
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

test('écart avec GitHub (I5 v8) : les six statuts, et l\'absence du champ', () => {
  const g = (status: string, behind: number | null = null) =>
    githubGapLabel({ status, head: 'abc', behind, checked_at: '2026-10-11T08:00:00Z' } as never);
  assert.deepEqual(g('up_to_date', 0), { label: 'à jour', tone: 'ok' });
  assert.deepEqual(g('behind', 1), { label: '1 commit en retard', tone: 'warn' });
  assert.deepEqual(g('behind', 2), { label: '2 commits en retard', tone: 'warn' });
  assert.deepEqual(g('behind', null), { label: 'en retard sur GitHub', tone: 'warn' });
  assert.deepEqual(g('not_deployed'), { label: 'rien en service', tone: '' });
  assert.deepEqual(g('unknown'), { label: 'version inconnue', tone: '' });
  assert.deepEqual(g('unreachable'), { label: 'dépôt injoignable', tone: 'ko' });
  assert.deepEqual(g('no_repo'), { label: 'pas de dépôt GitHub', tone: '' });
  // Moteur en service qui ne rend pas encore le champ, ou statut futur : « — », jamais une erreur.
  for (const absent of [undefined, null, {} as never, { status: 'statut-futur' } as never, { status: 7 } as never]) {
    assert.deepEqual(githubGapLabel(absent), { label: '—', tone: '' });
  }
});

test('chiffres de l\'accueil', () => {
  const p = (state: string, github?: unknown) => ({ name: 'x', state, github }) as unknown as Project;
  assert.deepEqual(projectCounts([]), { total: 0, running: 0, behind: null });
  assert.deepEqual(projectCounts([p('running'), p('stopped')]), { total: 2, running: 1, behind: null });
  assert.deepEqual(projectCounts([p('running', { status: 'behind', behind: 2 }), p('running', { status: 'up_to_date' }),
    p('never_deployed', { status: 'not_deployed' })]), { total: 3, running: 2, behind: 1 });
});

test('I10 : routes des profils SMTP', async () => {
  const { client, calls } = recorder();
  const run = async (o: Observable<unknown>) => { await firstValueFrom(o); return calls.pop(); };
  assert.deepEqual(await run(client.smtpList()), { method: 'GET', path: '/me/smtp' });
  assert.deepEqual(await run(client.smtpList('hassan')), { method: 'GET', path: '/me/smtp', params: { as: 'hassan' } });
  const body = { label: 'Gmail', host: 'smtp.gmail.com', port: 587, security: 'starttls' as const, username: 'moi@exemple.fr', from_email: 'moi@exemple.fr', password: 'p w' };
  assert.deepEqual(await run(client.smtpCreate(body)), { method: 'POST', path: '/me/smtp', body });
  assert.deepEqual(await run(client.smtpUpdate('ab12', { label: 'x' })), { method: 'PUT', path: '/me/smtp/ab12', body: { label: 'x' } });
  assert.deepEqual(await run(client.smtpDelete('ab12')), { method: 'DELETE', path: '/me/smtp/ab12' });
  // L'essai : sans corps, sans paramètre — aucune adresse de destination ne peut être glissée.
  assert.deepEqual(await run(client.smtpTest('ab12')), { method: 'POST', path: '/me/smtp/ab12/test' });
  assert.deepEqual(await run(client.smtpTest('../../projects')), { method: 'POST', path: '/me/smtp/..%2F..%2Fprojects/test' });
  assert.deepEqual(await run(client.projectSmtp('mon-app', 'ab12', 'now')),
    { method: 'PUT', path: '/projects/mon-app/smtp', body: { profile: 'ab12', apply: 'now' } });
  assert.deepEqual(await run(client.projectSmtp('mon-app', null, 'next_deploy')),
    { method: 'PUT', path: '/projects/mon-app/smtp', body: { profile: null, apply: 'next_deploy' } });
});

test('I10 : le mot de passe ne part que s\'il est saisi ; « aucune sécurité » part sans identifiants', () => {
  const form = { label: ' Gmail ', host: ' smtp.gmail.com ', port: 587, security: 'starttls' as const,
                 username: ' moi@exemple.fr ', from_email: ' moi@exemple.fr ', password: '' };
  const unchanged = smtpBody(form);
  assert.equal('password' in unchanged, false);            // champ vide = clé absente = inchangé
  assert.deepEqual(unchanged, { label: 'Gmail', host: 'smtp.gmail.com', port: 587, security: 'starttls', username: 'moi@exemple.fr', from_email: 'moi@exemple.fr' });
  assert.equal(smtpBody({ ...form, password: '  espaces gardés  ' }).password, '  espaces gardés  ');
  const none = smtpBody({ ...form, security: 'none', password: 'reste-du-formulaire' });
  assert.deepEqual([none.username, none.password], ['', '']);
  assert.deepEqual(SMTP_DEFAULT_PORT, { starttls: 587, ssl: 465, none: 25 });
});

test('I10 : contrôle de saisie et erreurs nommées', () => {
  const ok = { label: 'x', host: 'smtp.exemple.fr', port: 587, security: 'starttls' as const, username: '', from_email: 'a@b.fr' };
  assert.deepEqual(smtpProblems(ok), []);
  assert.equal(smtpProblems({ ...ok, label: ' ', host: 'a b', port: 70000, from_email: 'pas-une-adresse' }).length, 4);
  assert.equal(smtpProblems({ ...ok, port: 0 }).length, 1);
  const used = toEngineError({ status: 409, error: { error: 'smtp_in_use', detail: 'Profil rattaché.', projects: ['mon-app', 'autre', 3] } });
  assert.equal(used.code, 'smtp_in_use');
  assert.deepEqual(used.projects, ['mon-app', 'autre']);
  const failed = toEngineError({ status: 502, error: { error: 'smtp_error', detail: '535 5.7.8 Username and Password not accepted' } });
  assert.equal(failed.code, 'smtp_error');                 // un 502 du moteur avec un corps JSON n'est pas « moteur absent »
  assert.equal(failed.detail, '535 5.7.8 Username and Password not accepted');
  assert.equal(toEngineError({ status: 429, error: { error: 'rate_limited', detail: 'Attendez 30 s.' } }).code, 'rate_limited');
  // Moteur en service sans ces routes : 404 sans corps JSON → « pas encore disponible ».
  assert.equal(toEngineError({ status: 404, error: '404 page not found' }).code, 'no_engine');
  assert.deepEqual(toEngineError({ status: 404, error: '' }).projects, []);
});

test('I10 : profil modifié — le champ `stale` du moteur fait foi, la mémoire de session n\'est qu\'un repli', () => {
  assert.equal(smtpIsStale({ profile: 'p1', label: 'x', stale: true }, false), true);
  assert.equal(smtpIsStale({ profile: 'p1', label: 'x', stale: false }, true), false);   // le moteur dit non : on le croit
  assert.equal(smtpIsStale({ profile: 'p1', label: 'x' }, true), true);                  // champ absent : repli
  assert.equal(smtpIsStale({ profile: 'p1', label: 'x' }, false), false);
  assert.equal(smtpIsStale({ profile: null, label: null, stale: true }, true), false);   // aucun profil rattaché : rien à signaler
  assert.equal(smtpIsStale(undefined, true), false);
  assert.equal(smtpIsStale(null, true), false);
});

test('I6 v10 : sections de la liste d\'après `kind`', () => {
  const p = (name: string, kind?: string) => ({ name, kind }) as unknown as Project;
  assert.deepEqual(projectSections([]), []);
  // Moteur en service : aucun `kind` → une seule liste, sans intertitre.
  const flat = projectSections([p('a'), p('b')]);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].title, null);
  assert.deepEqual(flat[0].projects.map(x => x.name), ['a', 'b']);
  // Deux natures : applications d'abord, ordre du moteur conservé dans chaque section.
  const two = projectSections([p('storage', 'outil'), p('test', 'application'), p('lab-admin', 'outil'), p('carto', 'application')]);
  assert.deepEqual(two.map(s => [s.title, s.projects.map(x => x.name)]),
    [['Applications déployées', ['test', 'carto']], ['Outils du lab', ['storage', 'lab-admin']]]);
  // Section vide non rendue.
  assert.deepEqual(projectSections([p('test', 'application')]).map(s => s.title), ['Applications déployées']);
  assert.deepEqual(projectSections([p('storage', 'outil')]).map(s => s.title), ['Outils du lab']);
  // Nature inconnue ou absente au milieu des autres : jamais perdue.
  const odd = projectSections([p('test', 'application'), p('x', 'nature-future'), p('y')]);
  assert.deepEqual(odd.map(s => [s.title, s.projects.length]), [['Applications déployées', 1], ['Autres', 2]]);
  assert.equal(odd.reduce((n, s) => n + s.projects.length, 0), 3);
});
