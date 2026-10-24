import { Simulation } from '../core/simulation';
import { C } from '../scene/components';
import type { Entity } from '../scene/world';
import { FLAG, TileMap, type TileSet } from '../tilemap/tilemap';
import { groundHeightAt } from '../physics/terrain';
import { GeneratorSpecSchema, generate } from '../procgen/generate';
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
    // only maps with level-limited blockers carry these two layers, so older files stay exactly as they were
    ...(map.blockHigh.some((v) => v > 0) ? { blockLow: toRows(map.blockLow), blockHigh: toRows(map.blockHigh) } : {}),
    ...(map.stacks.size > 0 ? { stacks: map.stacksToJSON() } : {}),
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
  if (d.blockLow) fill(map.blockLow, d.blockLow);
  if (d.blockHigh) fill(map.blockHigh, d.blockHigh);
  if (d.stacks) map.stacksFromJSON(d.stacks);
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
    graphs: [],
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
    (['tiles', 'heights', 'slopes', 'flags', 'decks', 'deckTiles', 'oneWay', 'blockLow', 'blockHigh'] as const)
      .filter((k) => map[k] !== undefined)
      .map((k) => `    "${k}": ${rowText(map[k]!)}`)
      .join(',\n') +
    // block-by-block cells, one per line
    (map.stacks && map.stacks.length > 0 ? `,\n    "stacks": [\n      ${map.stacks.map((s) => JSON.stringify(s)).join(',\n      ')}\n    ]` : '') +
    '\n  }';
  const token = '__MAP__';
  return JSON.stringify({ ...scene, map: token }, null, 2).replace(`"${token}"`, () => mapText) + '\n';
}

/** The properties of tiles become cell flags: pit, water, and `not walkable` (solid at every height). */
export function applyTileProps(map: TileMap, tileset: TileSet): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const props = tileset[map.getTile(x, y)]?.props;
      if (!props) continue;
      if (props.pit) map.setFlag(x, y, FLAG.PIT);
      if (props.water) map.setFlag(x, y, FLAG.WATER);
      if (props.walkable === false && !props.water) map.setFlag(x, y, FLAG.BLOCK);
    }
  }
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
  /** The project's tiles: their properties (not walkable, water, pit...) are put on every cell that uses them. */
  tileset?: TileSet;
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
  if (opts.tileset) {
    sim.assets.tileset = opts.tileset;
    applyTileProps(sim.map, opts.tileset);
  }
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
  sim.runtime.graphs = structuredClone(scene.graphs ?? []);
  const defaults = Object.fromEntries(scene.variables.map((v) => [v.name, v.value]));
  sim.runtime.vars = opts.travel ? { ...defaults, ...sim.runtime.vars } : defaults;
  sim.runtime.rowState = {};
  sim.runtime.regions = structuredClone(scene.regions);
  sim.runtime.lighting = undefined;
  sim.runtime.gravity = scene.gravity ?? '-z';
  sim.runtime.blockRules = { enabled: scene.blocks?.runtime ?? false, limit: scene.blocks?.limit ?? 200 };
  sim.runtime.blockEdits = 0;
  sim.runtime.editedCells = new Set();
  sim.runtime.scene = opts.scene ?? sim.runtime.scene;
  // the world map remembers where the player has been
  if (sim.runtime.scene !== '') sim.runtime.vars[`visited:${sim.runtime.scene}`] = true;
  sim.runtime.persistentIds = entities.filter((e) => e.tags.includes('persistent')).map((e) => e.id);
  sim.runtime.dialogue = null;
  sim.runtime.minigame = null;
  sim.runtime.announce = [];
  sim.runtime.cutscene = null;
  sim.runtime.travel = null;
  // "the scene starts" is true on the first step after this (the game's first step, a scene change, a new run)
  sim.runtime.scratch.set('sceneStartTick', sim.tick);
  sim.runtime.view = newView();
  // a map made when the game starts: ground and walls from the rules, then the things the rules place
  const rules = scene.generator ? GeneratorSpecSchema.safeParse(scene.generator) : null;
  if (rules && !rules.success) problems.push('The scene\'s map generator settings are not valid, so the map was left as it is.');
  if (rules?.success && rules.data.atStart) {
    const spec = rules.data;
    if (typeof sim.runtime.vars['run.count'] !== 'number') sim.runtime.vars['run.count'] = 0; // the first run, so a screen can say "Run 0"
    const raw = sim.runtime.vars['run.seed'];
    const seed = !spec.lockSeed && typeof raw === 'number' ? Math.abs(Math.floor(raw)) % 2 ** 31 : spec.seed;
    const made = generate(spec, seed);
    for (const note of made.notes) problems.push(note);
    sim.map = made.map;
    for (const e of [...byId.values()]) if (e.tags.has('generated')) sim.world.destroy(e);
    const prefabs = opts.prefabs ?? new Map();
    made.placements.forEach((p, i) => {
      const h = groundHeightAt(made.map, p.x, p.y);
      const placed = expandEntities([{ id: `gen#${i}`, name: p.prefab, tags: ['generated', ...(p.tag ? [p.tag] : [])], prefab: p.prefab, components: { transform: { x: p.x, y: p.y, h, facing: 2 } } }], prefabs);
      for (const m of placed.problems) problems.push(m);
      for (const data of placed.entities) {
        const entity = instantiateEntity(sim, data);
        byId.set(data.id, entity);
      }
    });
    // whoever is controlled starts where the map says
    for (const e of sim.world.withTag('player')) {
      const t = e.get<{ x: number; y: number; h: number }>(C.Transform);
      if (t) {
        t.x = made.start.x + 0.5;
        t.y = made.start.y + 0.5;
        t.h = groundHeightAt(made.map, t.x, t.y);
      }
    }
    sim.runtime.vars['generated.seed'] = seed;
    sim.runtime.vars['generated.rooms'] = made.rooms.length;
  }
  return byId;
}

/** Deep copy for undo snapshots and play-in-editor (so playing never modifies the scene being edited). */
export function cloneScene(scene: SceneData): SceneData {
  return structuredClone(scene);
}
