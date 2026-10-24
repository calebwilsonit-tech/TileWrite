import '../../bundled';
import { resolveInstance, type EntityData, type PrefabData, type SpriteData } from '@tilewright/runtime';
import { playerEntity } from '../project/templates';
import { host, solid, thing } from '@tilewright/behaviors';

export interface Prefab {
  id: string;
  label: string;
  hint: string;
  group: string;
  /** Build entity data (without an id) standing at (x, y) on a floor at height h. */
  make(x: number, y: number, h: number): Omit<EntityData, 'id'>;
}

function strip({ id: _id, ...rest }: EntityData): Omit<EntityData, 'id'> {
  return rest;
}

function withHeight(e: Omit<EntityData, 'id'>, h: number): Omit<EntityData, 'id'> {
  const t = e.components.transform as { h: number };
  t.h = h;
  return e;
}

export const PREFABS: Prefab[] = [
  {
    id: 'player',
    label: 'Player start',
    group: 'Basics',
    hint: 'Where the player begins. A scene has one; placing another moves it.',
    make: (x, y, h) => withHeight(strip(playerEntity('', x, y)), h),
  },
  {
    id: 'crate',
    label: 'Crate',
    group: 'Basics',
    hint: 'A solid box the player can push one cell at a time, stand on, and put on pressure plates.',
    make: (x, y, h) => thing('Crate', ['crate'], { color: 0xc9964a, w: 0.9, d: 0.9, height: 1 }, x, y, h, ['pushable'], solid(0.9, 0.9, 1)),
  },
  {
    id: 'pillar',
    label: 'Pillar',
    group: 'Basics',
    hint: 'A tall solid column, good for walking behind.',
    make: (x, y, h) => thing('Pillar', ['pillar'], { color: 0x8e7cc3, w: 0.7, d: 0.7, height: 2.6 }, x, y, h, [], solid(0.7, 0.7, 2.6)),
  },
  {
    id: 'marker',
    label: 'Marker',
    group: 'Basics',
    hint: 'A point you can refer to later (spawn points, targets).',
    make: (x, y, h) => thing('Marker', ['marker'], { shape: 'diamond', color: 0x4ad1c8, w: 0.5, d: 0.5, height: 0.05 }, x, y, h),
  },
  {
    id: 'goal',
    label: 'Goal / exit',
    group: 'Puzzle',
    hint: 'Marks where a puzzle ends. The checks warn if it can be reached without opening a gate, or cannot be reached at all, and the playbot walks to it.',
    make: (x, y, h) => thing('Exit', ['goal'], { shape: 'diamond', color: 0xffd34a, w: 1, d: 1, height: 0.06 }, x, y, h),
  },  {
    id: 'plate',
    label: 'Pressure plate',
    group: 'Puzzle',
    hint: 'Sends a signal while something stands on it. Wire it to a gate.',
    make: (x, y, h) => thing('Pressure plate', ['plate'], { color: 0x8a8fa3, w: 0.9, d: 0.9, height: 0.3 }, x, y, h, ['pressurePlate']),
  },
  {
    id: 'gate',
    label: 'Gate',
    group: 'Puzzle',
    hint: 'A barrier that opens while its signal is on. Wire a plate or lever to it.',
    make: (x, y, h) => thing('Gate', ['gate'], { color: 0x7a5c3a, w: 0.9, d: 0.9, height: 1.6 }, x, y, h, ['gate']),
  },
  {
    id: 'lever',
    label: 'Lever',
    group: 'Puzzle',
    hint: 'The player flips it with the interact button. Sends a signal while on.',
    make: (x, y, h) => thing('Lever', ['lever'], { color: 0xe0866f, w: 0.4, d: 0.4, height: 0.9 }, x, y, h, ['lever']),
  },
  {
    id: 'timer',
    label: 'Timer',
    group: 'Puzzle',
    hint: 'Counts down when its start signal arrives.',
    make: (x, y, h) => thing('Timer', ['timer'], { shape: 'diamond', color: 0xf0b429, w: 0.5, d: 0.5, height: 0.05 }, x, y, h, ['timer']),
  },
  {
    id: 'zone',
    label: 'Trigger zone',
    group: 'Puzzle',
    hint: 'An invisible area that sends a signal while the player is inside.',
    make: (x, y, h) => thing('Trigger zone', ['zone'], { shape: 'diamond', color: 0x4ad1c8, w: 2, d: 2, height: 0.05 }, x, y, h, ['triggerZone']),
  },
  {
    id: 'soundsource',
    label: 'Sound source',
    group: 'Story',
    hint: 'A sound that comes from this spot and gets quieter as the player walks away: a waterfall, a campfire, a dripping pipe. Choose the sound in the Inspector.',
    make: (x, y, h) => thing('Sound source', ['sound-source'], { shape: 'diamond', color: 0x7ad0e8, w: 0.5, d: 0.5, height: 0.05 }, x, y, h, ['soundSource']),
  },
  {
    id: 'portal',
    label: 'Scene portal (door)',
    group: 'Story',
    hint: 'A doorway to another scene (or another spot in this one). Say where it leads in the Inspector.',
    make: (x, y, h) => thing('Portal', ['portal'], { shape: 'diamond', color: 0xb18cff, w: 1, d: 1, height: 0.05 }, x, y, h, ['portal']),
  },
   {
    id: 'flowers',
    label: 'Flowers',
    group: 'Decoration',
    hint: 'A patch of flowers. Decoration has no collision: it is only there to look nice, and has its own layer.',
    make: (x, y, h) => thing('Flowers', ['decoration'], { shape: 'diamond', color: 0xe86fa5, w: 0.7, d: 0.7, height: 0.12 }, x, y, h),
  },
  {
    id: 'rug',
    label: 'Rug',
    group: 'Decoration',
    hint: 'A flat rug for a floor. No collision.',
    make: (x, y, h) => thing('Rug', ['decoration'], { shape: 'diamond', color: 0x9b3d4a, w: 2, d: 1.4, height: 0.04 }, x, y, h),
  },
  {
    id: 'rock',
    label: 'Rock',
    group: 'Decoration',
    hint: 'A small rock you can walk through. For a rock that blocks the way use a Pillar or a Crate.',
    make: (x, y, h) => thing('Rock', ['decoration'], { color: 0x8a8d96, w: 0.5, d: 0.5, height: 0.35 }, x, y, h),
  },
  {
    id: 'bush',
    label: 'Bush',
    group: 'Decoration',
    hint: 'A leafy bush you can walk through.',
    make: (x, y, h) => thing('Bush', ['decoration'], { color: 0x3f8f4a, w: 0.8, d: 0.8, height: 0.7 }, x, y, h),
  },
  {
    id: 'banner',
    label: 'Banner',
    group: 'Decoration',
    hint: 'A tall banner on a pole, for walls and halls. No collision.',
    make: (x, y, h) => thing('Banner', ['decoration'], { color: 0xc9a227, w: 0.2, d: 0.2, height: 1.8 }, x, y, h),
  },
  {
    id: 'logic',
    label: 'Logic gate',
    group: 'Logic',
    hint: 'Combines signals: AND, OR, NOT, latch, toggle, delay, pulse. Wire things into it and out of it.',
    make: (x, y, h) => thing('Logic gate', ['logic'], { color: 0x6aa8ff, w: 0.5, d: 0.5, height: 0.5 }, x, y, h, ['logic']),
  },
  {
    id: 'eventNode',
    label: 'Event node',
    group: 'Logic',
    hint: 'Watches for anything the event sheet can see (a variable, the player coming near, something happening) and sends a signal. Wire it to a gate, a logic gate or an action node.',
    make: (x, y, h) => thing('Event node', ['logic-node'], { shape: 'diamond', color: 0xf0b429, w: 0.45, d: 0.45, height: 0.05 }, x, y, h, ['eventNode']),
  },
  {
    id: 'actionNode',
    label: 'Action node',
    group: 'Logic',
    hint: 'Does a list of actions (change a variable, play a sound, go to a scene, open a screen...) when a signal reaches it. Wire a button, plate or logic gate into it.',
    make: (x, y, h) => thing('Action node', ['logic-node'], { color: 0x6aa8ff, w: 0.45, d: 0.45, height: 0.4 }, x, y, h, ['actionNode']),
  },
  {
    id: 'clickable',
    label: 'Button (clickable)',
    group: 'Logic',
    hint: 'Something the mouse can click. Use Quick actions in the Inspector to say what a click does, or wire its "Clicked" signal.',
    make: (x, y, h) => thing('Button', ['button'], { color: 0xd9534f, w: 0.8, d: 0.8, height: 0.3 }, x, y, h, ['clickable']),
  },
  {
    id: 'spawner',
    label: 'Spawner',
    group: 'World',
    hint: 'Creates copies of a prefab on a timer or a signal.',
    make: (x, y, h) => thing('Spawner', ['spawner'], { color: 0xff8844, w: 0.5, d: 0.5, height: 0.5 }, x, y, h, ['spawner']),
  },
  {
    id: 'platform',
    label: 'Moving platform',
    group: 'World',
    hint: 'A platform that travels back and forth and carries what stands on it.',
    make: (x, y, h) => thing('Moving platform', ['platform'], { color: 0x9aa0b2, w: 1.5, d: 1.5, height: 0.3 }, x, y, h, ['movingPlatform']),
  },
  {
    id: 'floor',
    label: 'Falling floor',
    group: 'World',
    hint: 'Crumbles shortly after something stands on it.',
    make: (x, y, h) => thing('Falling floor', ['floor'], { color: 0xb08a5a, w: 1, d: 1, height: 0.3 }, x, y, h, ['fallingFloor']),
  },
];

/** The project's drawn sprites, for the props and decals made in the tile studio (the studio keeps this up to date). */
let propSprites: ReadonlyMap<string, SpriteData> = new Map();

export function setPropSprites(sprites: ReadonlyMap<string, SpriteData>): void {
  propSprites = sprites;
}

const hash = (x: number, y: number): number => {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

/** A prop sprite as an object: it stands on its footprint, blocks only what it says it blocks, and is drawn in the right order. */
export function propEntity(sprite: SpriteData, x: number, y: number, h: number, pickLook = true): Omit<EntityData, 'id'> {
  const m = sprite.meta!;
  let look = sprite.name;
  if (pickLook && m.variants.length > 0) {
    const total = 1 + m.variants.reduce((n, v) => n + v.weight, 0);
    let at = hash(x, y) * total;
    if (at >= 1) {
      at -= 1;
      for (const v of m.variants) {
        if (at < v.weight) {
          look = v.sprite;
          break;
        }
        at -= v.weight;
      }
    }
  }
  const decal = m.kind === 'decal';
  // a footprint wider than one cell is aligned to the grid: the clicked cell is its corner
  const cx = x - 0.5 + m.footprint.w / 2;
  const cy = y - 0.5 + m.footprint.d / 2;
  const components: Record<string, unknown> = {
    transform: { x: cx, y: cy, h, facing: 2 },
    sprite: { shape: 'box', color: 0x8a8f9c, w: m.footprint.w, d: m.footprint.d, height: decal ? 0.02 : Math.max(0.1, m.heightCells), sortOffset: decal ? -0.5 : m.sortOffset, visible: true, asset: look, ...(decal ? { noShadow: true } : {}) },
  };
  if (!decal && m.collision) {
    components.collider = { w: m.collision.w, d: m.collision.d, height: Math.max(0.5, m.heightCells), solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] };
  }
  if (m.light > 0) components.light = { radius: m.light, color: 0xffd98a, intensity: 1, flicker: 0.1 };
  return { name: sprite.name, tags: [decal ? 'decoration' : 'prop', ...m.tags], components };
}

/** The attachment sprites of the project (windows, torches, rugs), by name. */
export function attachmentSprites(): SpriteData[] {
  return [...propSprites.values()].filter((s) => s.meta?.kind === 'attachment').sort((a, b) => a.name.localeCompare(b.name));
}

export type AttachFace = '+x' | '-x' | '+y' | '-y' | 'top';

export const FACE_OF_BLOCK: Record<string, AttachFace> = { e: '+x', w: '-x', s: '+y', n: '-y', top: 'top' };

/** Where the middle of a spot on a block face is in the world: the cell, the face, how far along it, and the level of the block. */
export function attachmentSpot(cell: { x: number; y: number }, face: AttachFace, along: number, z: number, topHeight = z + 1): { x: number; y: number; h: number } {
  const e = 0.03;
  const a = Math.max(0.05, Math.min(0.95, along));
  switch (face) {
    case '+x':
      return { x: cell.x + 1 - e, y: cell.y + a, h: z + 0.5 };
    case '-x':
      return { x: cell.x + e, y: cell.y + a, h: z + 0.5 };
    case '+y':
      return { x: cell.x + a, y: cell.y + 1 - e, h: z + 0.5 };
    case '-y':
      return { x: cell.x + a, y: cell.y + e, h: z + 0.5 };
    default:
      return { x: cell.x + 0.5, y: cell.y + 0.5, h: topHeight };
  }
}

/** A window, torch or rug fixed to a face of a block. */
export function attachmentEntity(sprite: SpriteData, cell: { x: number; y: number }, face: AttachFace, z: number, along: number, topHeight?: number): Omit<EntityData, 'id'> {
  const m = sprite.meta!;
  const spot = attachmentSpot(cell, face, along, z, topHeight);
  const isRight = m.preset.includes('right');
  const other = m.otherSide;
  const left = isRight ? other : sprite.name;
  const right = isRight ? sprite.name : other;
  const components: Record<string, unknown> = {
    transform: { x: spot.x, y: spot.y, h: spot.h, facing: 2 },
    sprite: { shape: 'box', color: 0x8a8f9c, w: face === 'top' ? 1 : 0.3, d: face === 'top' ? 1 : 0.3, height: face === 'top' ? 0.02 : 0.9, sortOffset: face === 'top' ? -0.3 : 0.4, visible: true, asset: sprite.name, noShadow: true },
    attach: { face, left, right, cell: { ...cell }, z, along },
  };
  if (m.light > 0) components.light = { radius: m.light, color: 0xffd98a, intensity: 1, flicker: 0.12 };
  return { name: sprite.name, tags: ['attachment', ...m.tags], components };
}

/** Props and decals made in the tile studio, as things the Place and Scatter tools can put down. */
export function spritePropChoices(): Prefab[] {
  return [...propSprites.values()]
    .filter((s) => s.meta && (s.meta.kind === 'prop' || s.meta.kind === 'decal'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      id: `sprite:${s.name}`,
      label: s.name,
      group: 'Your props' as const,
      hint: `${s.meta!.kind === 'decal' ? 'A decal' : 'A tall prop'} drawn in the tile studio (${s.meta!.footprint.w} x ${s.meta!.footprint.d} cells${s.meta!.collision ? ', blocks' : ', does not block'}${s.meta!.fade ? ', its top fades when you stand behind it' : ''}).`,
      make: (x: number, y: number, h: number) => propEntity(s, x, y, h),
    }));
}

/** Prefabs made in this project, as things the Place tool can put down. */
export function projectPrefabChoices(prefabs: ReadonlyMap<string, PrefabData>): Prefab[] {
  return [...prefabs.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({
      id: `prefab:${p.name}`,
      label: p.name,
      group: 'Your prefabs' as const,
      hint: `Your prefab "${p.name}". Objects placed from it follow it, except for settings you change on them.`,
      make: (x: number, y: number, h: number): Omit<EntityData, 'id'> => {
        const inst = resolveInstance({ id: '', name: p.name, tags: [], prefab: p.name, components: { transform: { x, y, h, facing: 2 } } }, prefabs);
        if (!inst) return { name: p.name, tags: [], components: { transform: { x, y, h, facing: 2 } }, prefab: p.name };
        const { id: _id, ...rest } = inst;
        return rest;
      },
    }));
}

/** What the plugins that are on added to the Place tool. */
export function pluginPrefabChoices(): Prefab[] {
  return [...host.ext.prefabs.values()].map((p) => ({ id: p.id, label: p.label, hint: p.hint, group: p.group, make: p.make.bind(p) }));
}

export function allPrefabs(prefabs: ReadonlyMap<string, PrefabData>): Prefab[] {
  return [...PREFABS, ...pluginPrefabChoices(), ...spritePropChoices(), ...projectPrefabChoices(prefabs)];
}

export function prefabById(id: string, prefabs: ReadonlyMap<string, PrefabData> = new Map()): Prefab {
  return allPrefabs(prefabs).find((p) => p.id === id) ?? PREFABS[1]!;
}
