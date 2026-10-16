import { Simulation } from '../core/simulation';
import { C } from '../scene/components';
import type { Entity } from '../scene/world';
import { TileMap } from '../tilemap/tilemap';
import { newView } from '../story/cutscene';
import { expandEntities, type PrefabMap } from './prefab';
import {
  CURRENT_SCHEMA_VERSION,
  ProjectSchema,
  SceneSchema,
  describeSchemaError,
  type EntityData,
  type ProjectData,
  type SceneData,
  type TileMapRows,
} from './schema';

export type LoadResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function tileMapToRows(map: TileMap): TileMapRows {
  const toRows = (a: ArrayLike<number>): number[][] => {
    const out: number[][] = [];
    for (let y = 0; y < map.height; y++) {
      const row: number[] = [];
      for (let x = 0; x < map.width; x++) row.push(a[y * map.width + x]!);
      out.push(row);
    }
    return out;
  };
  return {
    width: map.width,
    height: map.height,
    tiles: toRows(map.tiles),
    heights: toRows(map.heights),
    slopes: toRows(map.slopes),
    flags: toRows(map.flags),
    decks: toRows(map.decks),
    deckTiles: toRows(map.deckTiles),
    oneWay: toRows(map.oneWay),
  };
}

export function tileMapFromRows(d: TileMapRows): TileMap {
  const map = new TileMap(d.width, d.height);
  const fill = (target: { [i: number]: number }, rows: number[][]): void => {
    for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) target[y * d.width + x] = rows[y]![x]!;
  };
  fill(map.tiles, d.tiles);
  fill(map.heights, d.heights);
  fill(map.slopes, d.slopes);
  fill(map.flags, d.flags);
  fill(map.decks, d.decks);
  fill(map.deckTiles, d.deckTiles);
  fill(map.oneWay, d.oneWay);
  return map;
}

/** An empty scene filled with one tile at height 0. */
export function newScene(name: string, width = 32, height = 32, tile = 1): SceneData {
  const map = new TileMap(width, height);
  map.fill(tile, 0);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name,
    map: tileMapToRows(map),
    entities: [],
    regions: [],
    wires: [],
    variables: [],
    events: [],
  };
}

export function parseScene(json: unknown): LoadResult<SceneData> {
  const r = SceneSchema.safeParse(json);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: describeSchemaError(r.error, 'This scene file') };
}

export function parseProject(json: unknown): LoadResult<ProjectData> {
  const r = ProjectSchema.safeParse(json);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: describeSchemaError(r.error, 'This project file') };
}

/**
 * JSON with each map row (and each short array) on one line, so a one-tile edit changes one line in git.
 */
export function stringifyScene(scene: SceneData): string {
  const { map } = scene;
  const rowText = (rows: number[][]): string => `[\n      ${rows.map((r) => JSON.stringify(r)).join(',\n      ')}\n    ]`;
  const mapText =
    `{\n    "width": ${map.width},\n    "height": ${map.height},\n` +
    (['tiles', 'heights', 'slopes', 'flags', 'decks', 'deckTiles', 'oneWay'] as const)
      .map((k) => `    "${k}": ${rowText(map[k])}`)
      .join(',\n') +
    '\n  }';
  const token = '__MAP__';
  return JSON.stringify({ ...scene, map: token }, null, 2).replace(`"${token}"`, () => mapText) + '\n';
}

/** Default components for things the editor places, so a fresh entity just works. */
export function instantiateEntity(sim: Simulation, data: EntityData): Entity {
  const e = sim.world.spawn({ name: data.name, tags: data.tags, components: structuredClone(data.components) });
  e.set('meta', { sceneId: data.id });
  sim.runtime.ids.set(data.id, e.id);
  return e;
}

export interface LoadOptions {
  /** Prefabs available to instances in the scene. */
  prefabs?: PrefabMap;
  /** Path of the scene file (checkpoints and saves remember it). */
  scene?: string;
  /** Changing scene in a running game: empty the world first and keep the flags and inventory the player has. */
  travel?: boolean;
}

/**
 * Fill a simulation from scene data: terrain on `sim.map`, one entity per scene entity (prefab instances
 * expanded), plus the scene's wires, variables and event sheet.
 * Returns the entities by scene id so callers can find the player, cameras, etc.; `problems` lists things
 * that could not be loaded (such as a missing prefab).
 */
export function loadScene(sim: Simulation, scene: SceneData, opts: LoadOptions = {}): Map<string, Entity> & { problems: string[] } {
  if (opts.travel) sim.world.clear();
  sim.map = tileMapFromRows(scene.map);
  const { entities, problems } = expandEntities(scene.entities, opts.prefabs ?? new Map());
  const byId = new Map<string, Entity>() as Map<string, Entity> & { problems: string[] };
  byId.problems = problems;
  sim.runtime.ids.clear();
  for (const e of entities) {
    const entity = instantiateEntity(sim, e);
    // physics collider state is runtime-only; make sure it starts clean
    const collider = entity.get<{ inside?: number[] }>(C.Collider);
    if (collider) collider.inside = [];
    byId.set(e.id, entity);
  }
  sim.runtime.wires = structuredClone(scene.wires);
  sim.runtime.sheet = structuredClone(scene.events);
  const defaults = Object.fromEntries(scene.variables.map((v) => [v.name, v.value]));
  sim.runtime.vars = opts.travel ? { ...defaults, ...sim.runtime.vars } : defaults;
  sim.runtime.rowState = {};
  sim.runtime.regions = structuredClone(scene.regions);
  sim.runtime.lighting = undefined;
  sim.runtime.scene = opts.scene ?? sim.runtime.scene;
  sim.runtime.persistentIds = entities.filter((e) => e.tags.includes('persistent')).map((e) => e.id);
  sim.runtime.dialogue = null;
  sim.runtime.cutscene = null;
  sim.runtime.travel = null;
  sim.runtime.view = newView();
  return byId;
}

/** Deep copy for undo snapshots and play-in-editor (so playing never modifies the scene being edited). */
export function cloneScene(scene: SceneData): SceneData {
  return structuredClone(scene);
}
