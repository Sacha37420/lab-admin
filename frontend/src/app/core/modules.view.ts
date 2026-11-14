/**
 * Tri, filtres et sélection de la page « Modules » — logique pure, sans
 * Angular, testée par `modules.view.spec.ts` (`npm run test:engine`).
 * Aucune forme du moteur ici : elles sont dans `engine.client.ts`.
 */
import { ModuleItem } from './engine.client';

export type ModuleSortKey = 'name' | 'category' | 'state' | 'weight';

const CATEGORY_ORDER = ['socle', 'cadriciel', 'application'];
const STATE_ORDER = ['installed', 'stopped', 'not_installed', 'inaccessible', 'absent', 'invalid'];

function rank(order: string[], v: string): number {
  const i = order.indexOf(v);
  return i < 0 ? order.length : i;
}

/** Poids de build : la mémoire d'abord, puis la durée ; un build lourd pèse plus. Inconnu = 0. */
export function buildWeight(m: ModuleItem): number {
  const r = m.resources;
  return (r.heavy_build ? 1_000_000 : 0) + (r.build_ram_mb ?? 0) * 10 + (r.build_minutes ?? 0);
}

/** Liste triée (copie). À égalité, toujours par nom : l'ordre est stable d'un rechargement à l'autre. */
export function sortModules(list: ModuleItem[], key: ModuleSortKey, desc = false): ModuleItem[] {
  const byName = (a: ModuleItem, b: ModuleItem) => a.name.localeCompare(b.name);
  const cmp: Record<ModuleSortKey, (a: ModuleItem, b: ModuleItem) => number> = {
    name: () => 0,
    category: (a, b) => rank(CATEGORY_ORDER, a.category) - rank(CATEGORY_ORDER, b.category),
    state: (a, b) => rank(STATE_ORDER, a.state) - rank(STATE_ORDER, b.state),
    weight: (a, b) => buildWeight(a) - buildWeight(b),
  };
  const sign = desc ? -1 : 1;
  return [...list].sort((a, b) => sign * (cmp[key](a, b) || byName(a, b)));
}

export interface ModuleFilter {
  query: string;
  category: string;   // '' = toutes
  state: string;      // '' = tous
  kind: '' | 'required' | 'optional';
}

export const NO_FILTER: ModuleFilter = { query: '', category: '', state: '', kind: '' };

export function filterModules(list: ModuleItem[], f: ModuleFilter): ModuleItem[] {
  const q = f.query.trim().toLowerCase();
  return list.filter(m =>
    (!q || m.name.toLowerCase().includes(q) || m.label.toLowerCase().includes(q))
    && (!f.category || m.category === f.category)
    && (!f.state || m.state === f.state)
    && (!f.kind || (f.kind === 'required') === m.required));
}

/** Les modules qui dépendent directement de `name`. */
export function dependents(list: ModuleItem[], name: string): string[] {
  return list.filter(m => m.requires.modules.some(r => r.name === name)).map(m => m.name).sort();
}

/**
 * Peut-on demander ce module au moteur ? Le socle, jamais (il s'installe par
 * `scripts/install.sh` — le moteur le bloquerait). Tout le reste peut être
 * demandé : c'est le PLAN du moteur qui dit ce qui est bloqué et pourquoi.
 */
export function canRequest(m: ModuleItem): boolean {
  return m.category !== 'socle';
}
