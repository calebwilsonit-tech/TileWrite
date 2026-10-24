import '../../bundled';
import { MAIN_SCENE_PATH, allPluginTemplates, baseProject, crateEntity, playerEntity, sceneFrom, type TemplateDef } from '@tilewright/behaviors';

export { MAIN_SCENE_PATH, crateEntity, playerEntity };
import { FLAG, SLOPE, TileMap } from '@tilewright/runtime';

export type Template = TemplateDef;

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

/** The starters: the plain ones, then those the plugins bring (they are listed whether or not the plugin is on in the project that is open). */
export function listTemplates(): Template[] {
  return [empty, emptyIso, starterRoom, puzzleDungeon, ...allPluginTemplates()];
}

export function templateById(id: string): Template {
  return listTemplates().find((t) => t.id === id) ?? empty;
}
