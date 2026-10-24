import {
  C,
  CURRENT_SCHEMA_VERSION,
  Simulation,
  TileMap,
  loadScene,
  physicsSystem,
  tileMapToRows,
  type EntityData,
  type Entity,
  type SceneData,
  type WireData,
  type EventRow,
  type SimContext,
} from '@tilewright/runtime';
import { PluginHost, PluginTrust, addStandardSystems, host, attachBehavior, loadPackage, readPluginPackage, type PluginDefinition } from '@tilewright/behaviors';

/** Helpers for tests that build a small scene and run it through the same systems the game uses. */

export function flatScene(w = 24, h = 24): { map: TileMap; scene: SceneData } {
  const map = new TileMap(w, h);
  map.fill(1, 0);
  return {
    map,
    scene: { schemaVersion: CURRENT_SCHEMA_VERSION, name: 'T', map: tileMapToRows(map), entities: [], regions: [], wires: [], variables: [], events: [], graphs: [] },
  };
}

export function player(id: string, x: number, y: number): EntityData {
  return {
    id,
    name: 'Player',
    tags: ['player'],
    components: {
      transform: { x, y, h: 0, facing: 2 },
      sprite: { shape: 'box', color: 0xe8553d, w: 0.6, d: 0.6, height: 1.2, sortOffset: 0, visible: true },
      body: { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1.2, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 2, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null },
      playerController: { speed: 4, runMultiplier: 1.6, jumpSpeed: 11 },
    },
  };
}

/** An object with some behaviours: settings override the defaults, `extra` adds other components. */
export function thing(id: string, name: string, x: number, y: number, behaviours: Record<string, object>, extra: Record<string, unknown> = {}): EntityData {
  const components: Record<string, unknown> = {
    transform: { x, y, h: 0, facing: 2 },
    sprite: { shape: 'box', color: 0xcccccc, w: 0.9, d: 0.9, height: 1, sortOffset: 0, visible: true },
    ...extra,
  };
  for (const [bid, settings] of Object.entries(behaviours)) {
    attachBehavior(components, bid);
    Object.assign(components[bid] as object, settings);
  }
  return { id, name, tags: [], components };
}

export function wire(id: string, from: [string, string], to: [string, string]): WireData {
  return { id, from: { entity: from[0], output: from[1] }, to: { entity: to[0], input: to[1] } };
}

export interface Rig {
  sim: Simulation;
  byId: Map<string, Entity>;
  /** Run `ticks` ticks holding these actions. */
  run(ticks: number, actions?: Record<string, number>): void;
  get(id: string): Entity;
}

export function rig(scene: SceneData, opts: { seed?: number } = {}): Rig {
  const sim = new Simulation(opts.seed ?? 1);
  const byId = loadScene(sim, scene);
  addStandardSystems(sim, physicsSystem);
  return {
    sim,
    byId,
    run(ticks, actions = {}) {
      for (let i = 0; i < ticks; i++) sim.step(actions);
    },
    get(id) {
      const e = byId.get(id);
      if (!e) throw new Error(`no entity ${id}`);
      return e;
    },
  };
}

export const GRID_PLUS_X = { move_right: 1, move_down: 1 };
export const GRID_MINUS_X = { move_left: 1, move_up: 1 };
export const GRID_PLUS_Y = { move_left: 1, move_down: 1 };
export const GRID_MINUS_Y = { move_right: 1, move_up: 1 };

export { C };
export type { EventRow };

/** A system context for a rig (to call helpers like `damage` or `beginDialogue` directly from a test). */
export function ctxOf(r: Rig): SimContext {
  return {
    world: r.sim.world,
    events: r.sim.events,
    runtime: r.sim.runtime,
    input: r.sim.input,
    uiInput: r.sim.uiInput,
    modal: r.sim.modal,
    rng: r.sim.rng,
    tweens: r.sim.tweens,
    assets: r.sim.assets,
    map: r.sim.map,
    dt: 1 / 60,
    tick: r.sim.tick,
    compat: r.sim.compat,
  };
}
// ---------- testing plugins ----------

/**
 * Turn plugins on for a test (on the host the game systems of a rig read) and take them away again with off().
 * `editor: true` also installs their editor parts.
 *
 *   const t = usePlugin(myPlugin);
 *   const r = rig(scene);           // a small game with the plugin on
 *   r.run(60);
 *   expect(t.contents().behaviors).toEqual(['spinner']);
 *   t.off();
 */
export function usePlugin(plugin: PluginDefinition | PluginDefinition[], opts: { editor?: boolean } = {}): { host: PluginHost; contents(id?: string): NonNullable<ReturnType<PluginHost['contentsOf']>>; off(): void } {
  const h = host; // the one the game systems of a rig read
  if (opts.editor) h.inEditor = true;
  const list = Array.isArray(plugin) ? plugin : [plugin];
  for (const p of list) h.register(p);
  for (const p of list) h.install(p.manifest.id);
  return {
    host: h,
    contents: (id = list[0]!.manifest.id) => h.contentsOf(id)!,
    off: () => {
      for (const p of [...list].reverse()) h.forget(p.manifest.id);
    },
  };
}

/** A plugin the way it comes in a folder (`plugin.json` and its code), given as the text of its files, for testing how a packaged plugin loads. */
export async function pluginFromFiles(files: Record<string, string>): Promise<PluginDefinition> {
  const read = await readPluginPackage({ readText: async (p) => files[p] ?? '', exists: async (p) => p in files });
  if (!read.ok) throw new Error(read.problems.join(' '));
  const trust = new PluginTrust();
  trust.approve(read.pkg.manifest.id, read.pkg.hash);
  const out = await loadPackage(read.pkg, trust, await import('./index'));
  if (out.state !== 'loaded') throw new Error(out.state === 'refused' ? out.problems.join(' ') : 'not approved');
  return out.definition;
}
