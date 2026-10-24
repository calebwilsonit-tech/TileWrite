/** Small builders for the starter projects (templates): a player, a crate, a thing with some behaviours, a walled room, and the project file that names the plugins it needs. Plugins use them for the templates they add. */
import { CURRENT_SCHEMA_VERSION, DEFAULT_TILESET, TileMap, tileMapToRows, type EntityData, type ProjectData, type SceneData } from '@tilewright/runtime';
import { attachBehavior } from './framework';
import { setActivePacks } from './packs';

export const MAIN_SCENE_PATH = 'scenes/main.scene.json';

/** The player: moves with the move actions, walks, runs, jumps. */
export function playerEntity(id: string, x: number, y: number): EntityData {
  return {
    id,
    name: 'Player',
    tags: ['player'],
    components: {
      transform: { x, y, h: 0, facing: 2 },
      sprite: { shape: 'box', color: 0xe8553d, w: 0.6, d: 0.6, height: 1.2, sortOffset: 0, visible: true },
      body: {
        vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1.2, state: 'ground', stepUp: 0.35, stepDown: 0.4,
        ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 2, mask: 65535, noclip: false,
        blockedBy: [], blockedTerrain: false,
      },
      playerController: { speed: 4, runMultiplier: 1.6, jumpSpeed: 11 },
    },
  };
}

export function crateEntity(id: string, x: number, y: number): EntityData {
  return {
    id,
    name: 'Crate',
    tags: ['crate'],
    components: {
      transform: { x, y, h: 0, facing: 2 },
      sprite: { shape: 'box', color: 0xc9964a, w: 0.9, d: 0.9, height: 1, sortOffset: 0, visible: true },
      collider: { w: 0.9, d: 0.9, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] },
      pushable: { slideSpeed: 6 },
    },
  };
}

export function baseProject(name: string, packs?: string[]): ProjectData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name,
    iso: { tileW: 64, tileH: 32, heightPx: 16 },
    tileset: Object.entries(DEFAULT_TILESET).map(([id, t]) => ({ id: Number(id), ...t })),
    autotile: [],
    scenes: [MAIN_SCENE_PATH],
    startScene: MAIN_SCENE_PATH,
    packs: packs ?? [],
  };
}

export function sceneFrom(map: TileMap, entities: EntityData[]): SceneData {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, name: 'Main', map: tileMapToRows(map), entities, regions: [], wires: [], variables: [], events: [], graphs: [] };
}

// ---------- genre starters (Phase 2) ----------

/** Build with the template's packs on, so the behaviours it attaches exist (opening the project does the same). */
export function withPacks<T>(packs: string[], fn: () => T): T {
  setActivePacks(packs);
  return fn();
}

export function thingOf(id: string, name: string, x: number, y: number, tags: string[], behaviours: Record<string, object>, extra: Record<string, unknown> = {}): EntityData {
  const components: Record<string, unknown> = {
    transform: { x, y, h: 0, facing: 2 },
    sprite: { shape: 'box', color: 0xcccccc, w: 0.7, d: 0.7, height: 1.2, sortOffset: 0, visible: true },
    ...extra,
  };
  for (const [bid, settings] of Object.entries(behaviours)) {
    attachBehavior(components, bid);
    Object.assign(components[bid] as object, settings);
  }
  return { id, name, tags, components };
}

export const solidCollider = { w: 0.7, d: 0.7, height: 1.2, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] };

export const boxLook = (color: number, w = 0.7, height = 1.2) => ({ shape: 'box', color, w, d: w, height, sortOffset: 0, visible: true });

export const unseen = { ...boxLook(0, 0.1, 0.1), visible: false };

export const walled = (w: number, h: number, floor: number, wall: number): TileMap => {
  const map = new TileMap(w, h);
  map.fill(floor, 0);
  for (let i = 0; i < w; i++) for (const y of [0, h - 1]) map.set(i, y, wall, 2);
  for (let i = 0; i < h; i++) for (const x of [0, w - 1]) map.set(x, i, wall, 2);
  return map;
};

export const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';
