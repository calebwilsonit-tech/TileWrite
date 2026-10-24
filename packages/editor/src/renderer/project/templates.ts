import '../../bundled';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_TILESET,
  FLAG,
  SLOPE,
  TileMap,
  tileMapToRows,
  type EntityData,
  type EventRow,
  type ProjectData,
  type SceneData,
} from '@tilewright/runtime';
import { attachBehavior, newAction, newCondition, newRow, setActivePacks } from '@tilewright/behaviors';

export interface Template {
  id: string;
  name: string;
  description: string;
  /** `files` are extra project files (tables, prefabs) written next to the scene, by path from the project folder. */
  build(projectName: string): { project: ProjectData; scene: SceneData; files?: Record<string, string> };
}

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

function baseProject(name: string, packs?: string[]): ProjectData {
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

function sceneFrom(map: TileMap, entities: EntityData[]): SceneData {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, name: 'Main', map: tileMapToRows(map), entities, regions: [], wires: [], variables: [], events: [], graphs: [] };
}

/** Nothing at all: a flat field and a camera. No player, no rules, no packs. Every genre starts from here. */
const empty: Template = {
  id: 'empty',
  name: 'Empty (nothing in it)',
  description: 'A flat grass field. No player, no rules, nothing switched on: build any kind of game from here.',
  build(name) {
    const map = new TileMap(32, 32);
    map.fill(1, 0);
    return { project: baseProject(name, []), scene: sceneFrom(map, []) };
  },
};

const emptyIso: Template = {
  id: 'empty-iso',
  name: 'Action starter (a field and a player)',
  description: 'A flat grass field and a player who walks, runs and jumps, with every module switched on.',
  build(name) {
    const map = new TileMap(32, 32);
    map.fill(1, 0);
    return { project: baseProject(name), scene: sceneFrom(map, [playerEntity('e1', 16.5, 16.5)]) };
  },
};

const starterRoom: Template = {
  id: 'starter-room',
  name: 'Starter room (heights)',
  description: 'A small walled room with a raised platform, stairs, a pit and a crate: a tour of the world tools.',
  build(name) {
    const map = new TileMap(24, 24);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) map.set(x, y, (x + y) % 2 === 0 ? 1 : 3, 0);
    for (let i = 0; i < 24; i++) {
      for (const [x, y] of [[i, 0], [i, 23], [0, i], [23, i]] as const) map.set(x, y, 5, 3);
    }
    for (let y = 4; y <= 9; y++) for (let x = 14; x <= 20; x++) map.set(x, y, 2, 2);
    map.set(17, 11, 2, 0);
    map.setSlope(17, 11, SLOPE.N, 'stairs');
    map.set(17, 10, 2, 1);
    map.setSlope(17, 10, SLOPE.N, 'stairs');
    for (let y = 14; y <= 16; y++) {
      for (let x = 5; x <= 7; x++) {
        map.set(x, y, 1, 0);
        map.setFlag(x, y, FLAG.PIT);
      }
    }
    return { project: baseProject(name), scene: sceneFrom(map, [playerEntity('e1', 8.5, 8.5), crateEntity('e2', 11.5, 12.5)]) };
  },
};

const puzzleDungeon: Template = {
  id: 'puzzle-dungeon',
  name: 'Puzzle dungeon (rooms)',
  description: 'Three stone rooms joined by doorways, ready for plates, gates and crates.',
  build(name) {
    const map = new TileMap(40, 20);
    map.fill(0, 0);
    const room = (x0: number, y0: number, w: number, h: number): void => {
      for (let y = y0 - 1; y <= y0 + h; y++) {
        for (let x = x0 - 1; x <= x0 + w; x++) {
          const wall = x === x0 - 1 || y === y0 - 1 || x === x0 + w || y === y0 + h;
          if (wall) map.set(x, y, 5, 3);
          else map.set(x, y, 2, 0);
        }
      }
    };
    room(2, 5, 8, 8);
    room(15, 5, 8, 8);
    room(28, 5, 8, 8);
    for (const [x0, x1] of [[10, 15], [23, 28]] as const) {
      for (let x = x0; x <= x1; x++) for (const y of [8, 9]) map.set(x, y, 2, 0);
    }
    return { project: baseProject(name), scene: sceneFrom(map, [playerEntity('e1', 5.5, 8.5)]) };
  },
};

// ---------- genre starters (Phase 2) ----------

/** Build with the template's packs on, so the behaviours it attaches exist (opening the project does the same). */
function withPacks<T>(packs: string[], fn: () => T): T {
  setActivePacks(packs);
  return fn();
}

function thingOf(id: string, name: string, x: number, y: number, tags: string[], behaviours: Record<string, object>, extra: Record<string, unknown> = {}): EntityData {
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

const solid = { w: 0.7, d: 0.7, height: 1.2, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] };
const box = (color: number, w = 0.7, height = 1.2) => ({ shape: 'box', color, w, d: w, height, sortOffset: 0, visible: true });
const unseen = { ...box(0, 0.1, 0.1), visible: false };
const walled = (w: number, h: number, floor: number, wall: number): TileMap => {
  const map = new TileMap(w, h);
  map.fill(floor, 0);
  for (let i = 0; i < w; i++) for (const y of [0, h - 1]) map.set(i, y, wall, 2);
  for (let i = 0; i < h; i++) for (const x of [0, w - 1]) map.set(x, i, wall, 2);
  return map;
};
const startRow = (): EventRow => ({ ...newRow('start-battle'), conditions: [newCondition('sceneStart')], actions: [newAction('startBattle')], once: true });

/** A soldier of a team: turns, walking cell by cell, health. Enemies play their own turns. */
function soldier(id: string, name: string, x: number, y: number, team: 'blue' | 'red', opts: { range?: number; damage?: number } = {}): EntityData {
  return thingOf(id, name, x, y, ['unit', team], { turnTaker: { team, apMax: 4, initiative: team === 'blue' ? 9 : 1, attackRange: opts.range ?? 1, attackDamage: opts.damage ?? 3, attackCost: 2 }, gridMover: {}, health: { max: 8, invulnerableSeconds: 0 }, ...(team === 'red' ? { unitAi: {} } : {}) }, { sprite: box(team === 'blue' ? 0x4f8cff : 0xe0566b), collider: { ...solid } });
}

const actionAdventure: Template = {
  id: 'action-adventure',
  name: 'Action adventure (walk, fight, collect)',
  description: 'A walled field with a player who walks and jumps, a goblin who chases, a coin to pick up and a crate. Combat, items, story, enemies and lighting are switched on.',
  build(name) {
    const packs = ['combat', 'inventory', 'story', 'ai', 'lighting'];
    return withPacks(packs, () => {
      const map = walled(28, 22, 1, 5);
      const goblin = thingOf('e2', 'Goblin', 20.5, 12.5, ['enemy'], { health: { max: 4 }, chase: {}, damageOnTouch: {} }, { sprite: box(0x58b368, 0.7, 1), body: playerEntity('x', 0, 0).components.body, collider: { ...solid } });
      const coin = thingOf('e3', 'Coin', 8.5, 6.5, ['pickup'], { pickup: {} }, { sprite: box(0xf2c94c, 0.4, 0.4) });
      return { project: baseProject(name, packs), scene: sceneFrom(map, [playerEntity('e1', 6.5, 12.5), goblin, coin, crateEntity('e4', 12.5, 14.5)]) };
    });
  },
};

const tactics: Template = {
  id: 'tactics',
  name: 'Tactics (turns on a grid)',
  description: 'A small battlefield with a hill. Two blue soldiers and two red; click a soldier, click where to walk or who to hit. The battle starts when the game does.',
  build(name) {
    const packs = ['combat', 'turns', 'controls'];
    return withPacks(packs, () => {
      const map = new TileMap(14, 14);
      map.fill(1, 0);
      for (let y = 5; y <= 8; y++) for (let x = 6; x <= 9; x++) map.set(x, y, 2, 1);
      const cursor = thingOf('e9', 'Controls', 0.5, 0.5, [], { gridCursor: { team: 'blue' } }, { sprite: unseen });
      const scene = sceneFrom(map, [soldier('e1', 'Knight', 3.5, 10.5, 'blue'), soldier('e2', 'Archer', 2.5, 11.5, 'blue', { range: 4, damage: 2 }), soldier('e3', 'Orc', 10.5, 3.5, 'red'), soldier('e4', 'Orc', 11.5, 2.5, 'red'), cursor]);
      scene.events = [startRow()];
      return { project: baseProject(name, packs), scene };
    });
  },
};

const roguelike: Template = {
  id: 'roguelike',
  name: 'Roguelike (a dungeon, one step at a time)',
  description: 'A walled dungeon, a hero and two monsters that move when you do. Turns, health and items are switched on; use the Generate panel for a new dungeon each run.',
  build(name) {
    const packs = ['combat', 'inventory', 'turns', 'controls'];
    return withPacks(packs, () => {
      const map = walled(30, 20, 2, 5);
      const cursor = thingOf('e9', 'Controls', 0.5, 0.5, [], { gridCursor: { team: 'blue' } }, { sprite: unseen });
      const scene = sceneFrom(map, [soldier('e1', 'Hero', 3.5, 3.5, 'blue'), soldier('e3', 'Rat', 20.5, 10.5, 'red'), soldier('e4', 'Rat', 24.5, 5.5, 'red'), cursor]);
      scene.events = [startRow()];
      return { project: baseProject(name, packs), scene };
    });
  },
};

const BUILDINGS_TABLE = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Buildings',
  columns: [
    { id: 'name', type: 'text' },
    { id: 'prefab', type: 'prefab' },
    { id: 'w', type: 'number' },
    { id: 'd', type: 'number' },
    { id: 'cost', type: 'number' },
  ],
  rows: [
    { id: 'house', name: 'House', prefab: 'House', w: 2, d: 3, cost: 30 },
    { id: 'wall', name: 'Wall', prefab: 'Wall', w: 1, d: 1, cost: 2 },
  ],
};
const prefabBox = (name: string, w: number, d: number, color: number) => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name,
  root: {
    name,
    tags: ['building'],
    children: [],
    components: { transform: { x: 0, y: 0, h: 0, facing: 2 }, sprite: { shape: 'box', color, w, d, height: 1.5, sortOffset: 0, visible: true }, collider: { w: w * 0.95, d: d * 0.95, height: 1.5, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } },
  },
});
const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';

const builder: Template = {
  id: 'builder',
  name: 'Builder (place buildings, grow a town)',
  description: 'Open ground with a camera you can move, turn and zoom, and a menu of buildings that cost gold. Simulation helpers and control schemes are switched on.',
  build(name) {
    const packs = ['controls', 'sim'];
    return withPacks(packs, () => {
      const map = new TileMap(40, 40);
      map.fill(1, 0);
      const rig = thingOf('e1', 'Camera', 20.5, 20.5, [], { cameraRig: {}, builder: {} }, { sprite: unseen });
      const scene = sceneFrom(map, [rig]);
      scene.variables = [{ name: 'gold', value: 100 }] as SceneData['variables'];
      return {
        project: baseProject(name, packs),
        scene,
        files: { 'assets/tables/Buildings.table.json': json(BUILDINGS_TABLE), 'assets/prefabs/House.prefab.json': json(prefabBox('House', 2, 3, 0xaa8855)), 'assets/prefabs/Wall.prefab.json': json(prefabBox('Wall', 1, 1, 0x888888)) },
      };
    });
  },
};

const pointAndClick: Template = {
  id: 'point-and-click',
  name: 'Point and click (look, use, talk)',
  description: 'A room with a hero who walks where you click and a lamp to look at or use. Choose a verb, click a thing. Control schemes and story are switched on.',
  build(name) {
    const packs = ['controls', 'story', 'inventory'];
    return withPacks(packs, () => {
      const map = walled(20, 14, 3, 5);
      const hero = thingOf('e1', 'Hero', 4.5, 7.5, ['player'], { clickToMove: {} }, { body: playerEntity('x', 0, 0).components.body, sprite: box(0xe8553d, 0.6, 1.4) });
      const lamp = thingOf('e2', 'Lamp', 12.5, 4.5, [], { hotspot: { label: 'Old lamp', look: 'It flickers.', use: 'You pull the chain.', talk: '' } }, { sprite: box(0xf2c94c, 0.5, 1.6) });
      const scene = sceneFrom(map, [hero, lamp]);
      scene.variables = [{ name: 'verb', value: 'look' }] as SceneData['variables'];
      return { project: baseProject(name, packs), scene };
    });
  },
};

export const TEMPLATES: Template[] = [empty, emptyIso, actionAdventure, tactics, builder, roguelike, pointAndClick, starterRoom, puzzleDungeon];

export function templateById(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? empty;
}
