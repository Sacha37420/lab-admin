/** Tri, filtres et sélection de la page « Modules » (`npm run test:engine`). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModuleItem, toModuleItem } from './engine.client';
import { NO_FILTER, buildWeight, canRequest, dependents, filterModules, sortModules } from './modules.view';

function m(over: Record<string, unknown>): ModuleItem { return toModuleItem({ name: 'x', ...over })!; }

const LIST = [
  m({ name: 'peripheriques', label: 'Périphériques', category: 'application', state: 'stopped', requires: { modules: [{ name: 'lab-media' }] } }),
  m({ name: 'atelier-3d', category: 'application', state: 'installed', resources: { build_ram_mb: 4000, heavy_build: true } }),
  m({ name: 'sso-lab', category: 'socle', required: true, state: 'installed' }),
  m({ name: 'lab-media', category: 'cadriciel', state: 'not_installed', resources: { build_ram_mb: 800 } }),
  m({ name: 'storage', category: 'cadriciel', required: true, state: 'invalid', resources: { build_ram_mb: 1500 } }),
  m({ name: 'craft-lab', category: 'application', state: 'absent', requires: { modules: [{ name: 'storage' }, { name: 'lab-media' }] } }),
];

test('tri par nom, catégorie, état, poids ; égalité départagée par le nom', () => {
  assert.deepEqual(sortModules(LIST, 'name').map(x => x.name), ['atelier-3d', 'craft-lab', 'lab-media', 'peripheriques', 'sso-lab', 'storage']);
  assert.deepEqual(sortModules(LIST, 'name', true).map(x => x.name)[0], 'storage');
  assert.deepEqual(sortModules(LIST, 'category').map(x => x.name), ['sso-lab', 'lab-media', 'storage', 'atelier-3d', 'craft-lab', 'peripheriques']);
  assert.deepEqual(sortModules(LIST, 'state').map(x => x.state), ['installed', 'installed', 'stopped', 'not_installed', 'absent', 'invalid']);
  assert.deepEqual(sortModules(LIST, 'weight', true).map(x => x.name).slice(0, 3), ['atelier-3d', 'storage', 'lab-media']);
  assert.ok(buildWeight(LIST[1]) > buildWeight(LIST[4]));
  // La liste d'origine n'est pas modifiée.
  assert.equal(LIST[0].name, 'peripheriques');
});

test('filtres', () => {
  assert.equal(filterModules(LIST, NO_FILTER).length, LIST.length);
  assert.deepEqual(filterModules(LIST, { ...NO_FILTER, query: 'PÉRI' }).map(x => x.name), ['peripheriques']);
  assert.deepEqual(filterModules(LIST, { ...NO_FILTER, category: 'cadriciel' }).map(x => x.name), ['lab-media', 'storage']);
  assert.deepEqual(filterModules(LIST, { ...NO_FILTER, state: 'installed' }).map(x => x.name), ['atelier-3d', 'sso-lab']);
  assert.deepEqual(filterModules(LIST, { ...NO_FILTER, kind: 'required' }).map(x => x.name), ['sso-lab', 'storage']);
  assert.equal(filterModules(LIST, { ...NO_FILTER, kind: 'optional' }).length, 4);
});

test('dépendants et modules demandables', () => {
  assert.deepEqual(dependents(LIST, 'lab-media'), ['craft-lab', 'peripheriques']);
  assert.deepEqual(dependents(LIST, 'atelier-3d'), []);
  assert.equal(canRequest(LIST[2]), false);   // socle
  assert.equal(canRequest(LIST[4]), true);    // obligatoire mais pas socle : réinstallable
});
