import { LAYER, type ProjectLayerData } from '@tilewright/runtime';
import { setGhostLayer } from '../builtins/filters';
import { host } from './host';

/**
 * Collision layers: a layer is a bit of the number a collider or body stores (what it belongs to) and of the mask (what it meets).
 * There are three kinds: the engine's own, the ones plugins that are on add, and the ones the project names itself (Project settings).
 */

export interface LayerInfo {
  name: string;
  bit: number;
  label: string;
  source: 'engine' | 'plugin' | 'project';
  /** Layers of ghosts (recorded copies, spirits): a gate set to let ghosts pass lets these through. */
  ghost: boolean;
}

const ENGINE: LayerInfo[] = [
  { name: 'default', bit: Math.log2(LAYER.DEFAULT), label: 'Default', source: 'engine', ghost: false },
  { name: 'player', bit: Math.log2(LAYER.PLAYER), label: 'Player', source: 'engine', ghost: false },
  { name: 'enemy', bit: Math.log2(LAYER.ENEMY), label: 'Enemy', source: 'engine', ghost: false },
  { name: 'prop', bit: Math.log2(LAYER.PROP), label: 'Prop', source: 'engine', ghost: false },
  { name: 'ghost', bit: Math.log2(LAYER.GHOST), label: 'Ghost', source: 'engine', ghost: true },
];

let project: readonly ProjectLayerData[] = [];
const projectGhosts = new Set<string>();

/** Use the layers the project names (called when a project is opened or its settings change). */
export function setProjectLayers(layers: readonly ProjectLayerData[] | undefined): void {
  for (const name of projectGhosts) setGhostLayer(name, null);
  projectGhosts.clear();
  project = layers ?? [];
  for (const l of project) {
    if (l.ghost) {
      setGhostLayer(l.name, l.bit);
      projectGhosts.add(l.name);
    }
  }
}

/** Every collision layer there is now, with where it comes from. */
export function layerList(): LayerInfo[] {
  const out = [...ENGINE];
  for (const l of host.ext.collisionLayers.values()) out.push({ name: l.name, bit: l.bit, label: l.label ?? l.name, source: 'plugin', ghost: l.ghost === true });
  for (const l of project) out.push({ name: l.name, bit: l.bit, label: l.label ?? l.name, source: 'project', ghost: l.ghost === true });
  return out;
}

/** The collision layers there are: the engine's own, those the plugins that are on added and those the project named. */
export function collisionLayers(): Record<string, number> {
  return Object.fromEntries(layerList().map((l) => [l.name, 1 << l.bit]));
}

/** The number of a layer by its name (undefined when there is none: the plugin that adds it is off). */
export function layerNamed(name: string): number | undefined {
  return collisionLayers()[name];
}

/** The lowest bit no layer uses (the project's new layers start above the ones the engine and the plugins take), or null when all 16 are taken. */
export function freeLayerBit(): number | null {
  const used = new Set(layerList().map((l) => l.bit));
  for (let b = 6; b < 16; b++) if (!used.has(b)) return b;
  for (let b = 0; b < 6; b++) if (!used.has(b)) return b;
  return null;
}

/** Plain-English problems with a list of project layers: a name or a bit another layer (the engine's, a plugin's or the project's) already has. */
export function projectLayerProblems(list: readonly ProjectLayerData[]): string[] {
  const out: string[] = [];
  const others = [...ENGINE, ...[...host.ext.collisionLayers.values()].map((l) => ({ name: l.name, bit: l.bit }))];
  const seenNames = new Map(others.map((l) => [l.name, l.name]));
  const seenBits = new Map<number, string>(others.map((l) => [l.bit, l.name]));
  for (const l of list) {
    if (seenNames.has(l.name)) out.push(`The collision layer "${l.name}" has the same name as another layer.`);
    const holder = seenBits.get(l.bit);
    if (holder !== undefined) out.push(`The collision layer "${l.name}" uses bit ${l.bit}, which "${holder}" already uses.`);
    seenNames.set(l.name, l.name);
    seenBits.set(l.bit, l.name);
  }
  return out;
}
