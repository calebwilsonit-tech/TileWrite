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
import { addStandardSystems, attachBehavior } from '@tilewright/behaviors';

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