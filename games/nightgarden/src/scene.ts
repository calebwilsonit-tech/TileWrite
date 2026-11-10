import { CURRENT_SCHEMA_VERSION, FLAG, TileMap, locomotionController, makeAnimator, pauseButtonRow, tileMapToRows, type EntityData, type SceneData, type WireData } from '@tilewright/runtime';
import { BLOOM_HEIGHT, BRAZIER_RANGE, DARKNESS, FLOOR, LAMP_RANGE, groundLevel, type Room, type Thing } from './model';

/** Tile ids of the project's tileset (see build.ts). */
export const TILE = { path: 1, hedge: 2, soil: 3, terrace: 4, pond: 5 } as const;
/** A hedge stands one level above the path: enough to read as a hedge, low enough not to hide the beds behind it. */
export const HEDGE_TOP = FLOOR + 1;
/** How far above its bed a firefly hovers (levels). */
export const FIREFLY_HOVER = 0.9;

export const scenePath = (roomId: string): string => `scenes/${roomId}.scene.json`;

const solid = (w: number, height: number, layer = 16): Record<string, unknown> => ({ w, d: w, height, solid: true, trigger: false, layer, mask: 65535, enabled: true, inside: [] });
const box = (color: number, w: number, height: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ shape: 'box', color, w, d: w, height, sortOffset: 0, visible: true, ...extra });
/** A drawn picture from the sprite studio (the box is what it is sorted and shaded as). */
const pic = (asset: string, w: number, height: number, extra: Record<string, unknown> = {}): Record<string, unknown> => box(0xffffff, w, height, { asset, ...extra });
const lightOf = (range: number, mode: 'always' | 'whenOn', color = 'warm'): Record<string, unknown> => ({ radius: range + 0.9, intensity: 1, color, shadows: true, flicker: 0.1, mode });

/** The map of a room: the ground, its heights, and what stops walking and light. */
export function roomMap(room: Room): TileMap {
  const map = new TileMap(room.w, room.h);
  for (let y = 0; y < room.h; y++) {
    for (let x = 0; x < room.w; x++) {
      const g = room.ground[y]![x]!;
      if (g === 'void') continue; // no tile: the edge of the world
      if (g === 'hedge') {
        map.set(x, y, TILE.hedge, HEDGE_TOP);
        map.setFlag(x, y, FLAG.BLOCK);
      } else if (g === 'pond') {
        map.set(x, y, TILE.pond, FLOOR);
        map.setFlag(x, y, FLAG.WATER);
      } else map.set(x, y, g === 'trench' ? TILE.soil : g === 'terrace' ? TILE.terrace : TILE.path, groundLevel(g));
    }
  }
  return map;
}

const GROUND_CHAR: Record<string, string> = { hedge: '#', floor: '.', trench: '~', terrace: '^', pond: 'w', void: '_' };
/** The ground as the light rule reads it: one character a cell, row by row. */
export const groundText = (room: Room): string => room.ground.map((row) => row.map((g) => GROUND_CHAR[g]).join('')).join('');

export interface SceneOptions {
  /** The scene the way out leads to. */
  next: string;
  /** Number of the room in the whole game (1-based), for the heads-up display. */
  index: number;
  chapter: string;
  chapterNo: number;
  chapterLine: string;
  chapters: number;
  total: number;
  flyTotal: number;
}

export function roomScene(room: Room, opts: SceneOptions): SceneData {
  const map = roomMap(room);
  const entities: EntityData[] = [];
  const wires: WireData[] = [];
  let n = 0;
  const id = (): string => `e${++n}`;
  const at = (t: Thing): { x: number; y: number; h: number; facing: number } => ({ x: t.x + 0.5, y: t.y + 0.5, h: groundLevel(room.ground[t.y]![t.x]!), facing: 2 });
  const feeds = new Map<number, { entity: string; output: string }[]>();
  const takes = new Map<number, { entity: string; input: string }[]>();
  const feed = (c: number, entity: string, output: string): void => void (feeds.get(c) ?? feeds.set(c, []).get(c)!).push({ entity, output });
  const take = (c: number, entity: string, input: string): void => void (takes.get(c) ?? takes.set(c, []).get(c)!).push({ entity, input });
  const names = new Map<string, number>();
  const name = (base: string): string => {
    const k = (names.get(base) ?? 0) + 1;
    names.set(base, k);
    return `${base} ${k}`;
  };

  for (const t of room.things) {
    const e = id();
    const transform = at(t);
    switch (t.kind) {
      case 'player':
        entities.push({
          id: e,
          name: 'Gardener',
          tags: ['player'],
          components: {
            transform,
            sprite: pic('gardener', 0.6, 1.2),
            animator: makeAnimator({ asset: 'gardener', clip: 'stand', controller: locomotionController({ idle: 'stand', walk: 'walk' }), state: 'idle' }),
            body: {
              vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1.2, state: 'ground', stepUp: 0.35, stepDown: 0.4,
              ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 2, mask: 65535, noclip: false,
              blockedBy: [], blockedTerrain: false,
            },
            script_Gardener: { speed: 5 },
          },
        });
        break;
      case 'lamp': {
        const hand = t.mode === 'hand';
        entities.push({
          id: e,
          name: name(hand ? 'Lamp' : t.mode === 'fixed' ? 'Glow lamp' : 'Wired lamp'),
          tags: ['lamp', ...(hand ? ['handlamp'] : []), ...(t.mode === 'fixed' ? ['glow'] : [])],
          components: {
            transform,
            sprite: pic(t.mode === 'fixed' ? 'glowlamp' : hand ? (t.flag ? 'lamp_on' : 'lamp_off') : 'wirelamp_off', 0.4, 1.1),
            collider: solid(0.5, 1),
            light: lightOf(LAMP_RANGE, t.mode === 'fixed' ? 'always' : 'whenOn', t.mode === 'wired' ? 'cool' : 'warm'),
            ...(t.mode === 'fixed' ? {} : { script_Lamp: { startLit: t.flag === true, byHand: hand, look: hand ? 'lamp' : 'wirelamp' } }),
          },
        });
        if (t.mode === 'wired') take(t.channel!, e, 'power');
        break;
      }
      case 'bloom':
        entities.push({
          id: e,
          name: name(t.bloom === 'duskcap' ? 'Duskcap' : 'Moonbloom'),
          tags: ['bloom', t.bloom!],
          components: {
            transform,
            sprite: pic(`${t.bloom}_0`, 0.9, 0.2),
            collider: solid(0.9, 0.2),
            script_Bloom: { kind: t.bloom!, height: BLOOM_HEIGHT, seconds: 0.5 },
          },
        });
        break;
      case 'crate':
        entities.push({ id: e, name: name('Crate'), tags: ['crate'], components: { transform, sprite: pic('crate', 0.9, 1), collider: solid(0.9, 1), pushable: { slideSpeed: 6 } } });
        break;
      case 'brazier':
        entities.push({
          id: e,
          name: name('Brazier'),
          tags: ['crate', 'brazier'],
          components: { transform, sprite: pic('brazier', 0.9, 1.1), collider: solid(0.9, 1), pushable: { slideSpeed: 6 }, light: lightOf(BRAZIER_RANGE, 'always') },
        });
        break;
      case 'screen':
        entities.push({ id: e, name: name('Screen'), tags: ['crate', 'screen'], components: { transform, sprite: pic('screen', 0.9, 2), collider: solid(0.9, 2), pushable: { slideSpeed: 6 } } });
        break;
      case 'plate':
        entities.push({
          id: e,
          name: name('Plate'),
          tags: ['plate'],
          components: { transform, sprite: pic('plate_up', 0.8, 0.05, { noShadow: true, sortOffset: -0.5 }), script_Plate: {}, script_Shows: { signal: 'active', on: 'plate_down', off: 'plate_up' } },
        });
        feed(t.channel!, e, 'active');
        break;
      case 'stone':
        entities.push({
          id: e,
          name: name(t.flag ? 'Shadestone' : 'Moonstone'),
          tags: ['stone'],
          components: { transform, sprite: pic(t.flag ? 'shadestone_off' : 'moonstone_off', 0.7, 0.05, { noShadow: true, sortOffset: -0.5 }), script_Moonstone: { whenDark: t.flag === true }, script_Shows: { signal: 'active', on: t.flag ? 'shadestone_on' : 'moonstone_on', off: t.flag ? 'shadestone_off' : 'moonstone_off' } },
        });
        feed(t.channel!, e, 'active');
        break;
      case 'gate':
        entities.push({
          id: e,
          name: name('Gate'),
          tags: ['gate'],
          components: { transform, sprite: pic('gate_shut', 1, 2), collider: solid(1, 2, 1), script_Gate: { openWhenOff: t.flag === true, height: 2, seconds: 0.25 } },
        });
        take(t.channel!, e, 'open');
        break;
      case 'exit':
        entities.push({
          id: e,
          name: 'Way out',
          tags: ['wayout'],
          components: { transform, sprite: pic('exit', 0.9, 0.05, { noShadow: true, sortOffset: -0.5 }), animator: makeAnimator({ asset: 'exit', clip: 'glow' }), script_Exit: { room: room.id, next: opts.next } },
        });
        break;
      case 'firefly':
        entities.push({
          id: e,
          name: 'Firefly',
          tags: ['firefly'],
          components: { transform: { ...transform, h: transform.h + FIREFLY_HOVER }, sprite: pic('firefly', 0.3, 0.3, { noShadow: true }), animator: makeAnimator({ asset: 'firefly', clip: 'fly' }), script_Firefly: { room: room.id, hover: FIREFLY_HOVER } },
        });
        break;
    }
  }
  // what the room tells the rest of the game (the heads-up display, the Rooms screen, the chapter card)
  entities.push({
    id: id(),
    name: 'Room',
    tags: ['room'],
    components: {
      // it stands in the middle of the room and the camera stays on it, so a room is one still picture
      transform: { x: room.w / 2, y: room.h / 2, h: FLOOR, facing: 2 },
      roomCamera: { zoom: room.w + room.h <= 12 ? 2 : room.w + room.h <= 16 ? 1.75 : 1.5, on: true },
      script_Room: { room: room.id, name: room.name, no: opts.index, hint: room.hint, chapter: opts.chapter, chapterNo: opts.chapterNo, chapterLine: opts.chapterLine, chapters: opts.chapters, total: opts.total, flyTotal: opts.flyTotal, width: room.w, ground: groundText(room) },
    },
  });
  // the mark that hovers over the lamp the gardener would light
  entities.push({ id: id(), name: 'Lamp mark', tags: ['cursor'], components: { transform: { x: 0.5, y: 0.5, h: 0, facing: 2 }, sprite: pic('cursor', 0.2, 0.2, { noShadow: true, visible: false, sortOffset: 2 }) } });
  for (const [c, outs] of feeds) for (const o of outs) for (const i of takes.get(c) ?? []) wires.push({ id: `w${wires.length + 1}c${c}`, from: o, to: i });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: room.name,
    map: tileMapToRows(map),
    entities,
    regions: [{ id: 'r1', name: room.name, x: 0, y: 0, w: room.w, h: room.h, cameraBounds: false, music: '', darkness: DARKNESS, bossActive: false }],
    wires,
    variables: [],
    events: [pauseButtonRow()],
    graphs: [],
  };
}
