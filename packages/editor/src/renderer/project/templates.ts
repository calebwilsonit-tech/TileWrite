import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_TILESET,
  FLAG,
  SLOPE,
  TileMap,
  tileMapToRows,
  type EntityData,
  type ProjectData,
  type SceneData,
} from '@tilewright/runtime';

export interface Template {
  id: string;
  name: string;
  description: string;
  build(projectName: string): { project: ProjectData; scene: SceneData };
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

function baseProject(name: string): ProjectData {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name,
    iso: { tileW: 64, tileH: 32, heightPx: 16 },
    tileset: Object.entries(DEFAULT_TILESET).map(([id, t]) => ({ id: Number(id), ...t })),
    autotile: [],
    scenes: [MAIN_SCENE_PATH],
    startScene: MAIN_SCENE_PATH,
  };
}

function sceneFrom(map: TileMap, entities: EntityData[]): SceneData {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, name: 'Main', map: tileMapToRows(map), entities, regions: [], wires: [], variables: [], events: [] };
}

const emptyIso: Template = {
  id: 'empty-iso',
  name: 'Empty isometric world',
  description: 'A flat grass field and a player. Start here and build whatever you like.',
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

export const TEMPLATES: Template[] = [emptyIso, starterRoom, puzzleDungeon];

export function templateById(id: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? emptyIso;
}
