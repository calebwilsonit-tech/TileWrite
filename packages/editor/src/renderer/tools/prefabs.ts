import { attachBehavior } from '@tilewright/behaviors';
import { resolveInstance, type EntityData, type PrefabData } from '@tilewright/runtime';
import { playerEntity } from '../project/templates';

export interface Prefab {
  id: string;
  label: string;
  hint: string;
  group: 'Basics' | 'Puzzle' | 'Logic' | 'World' | 'Your prefabs';
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

interface Look {
  shape?: 'box' | 'diamond';
  color: number;
  w: number;
  d: number;
  height: number;
}

function thing(name: string, tags: string[], look: Look, x: number, y: number, h: number, behaviours: string[] = [], extra: Record<string, unknown> = {}): Omit<EntityData, 'id'> {
  const components: Record<string, unknown> = {
    transform: { x, y, h, facing: 2 },
    sprite: { shape: look.shape ?? 'box', color: look.color, w: look.w, d: look.d, height: look.height, sortOffset: 0, visible: true },
    ...extra,
  };
  for (const b of behaviours) attachBehavior(components, b);
  return { name, tags, components };
}

const solid = (w: number, d: number, height: number, layer = 16): Record<string, unknown> => ({
  collider: { w, d, height, solid: true, trigger: false, layer, mask: 65535, enabled: true, inside: [] },
});

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
    id: 'logic',
    label: 'Logic gate',
    group: 'Logic',
    hint: 'Combines signals: AND, OR, NOT, latch, toggle, delay, pulse. Wire things into it and out of it.',
    make: (x, y, h) => thing('Logic gate', ['logic'], { color: 0x6aa8ff, w: 0.5, d: 0.5, height: 0.5 }, x, y, h, ['logic']),
  },
  {
    id: 'spawner',
    label: 'Spawner',
    group: 'World',
    hint: 'Creates copies of a prefab on a timer or a signal.',
    make: (x, y, h) => thing('Spawner', ['spawner'], { color: 0xff8844, w: 0.5, d: 0.5, height: 0.5 }, x, y, h, ['spawner']),
  },
  {
    id: 'coin',
    label: 'Pickup (coin)',
    group: 'World',
    hint: 'Disappears when the player touches it and adds to a counter.',
    make: (x, y, h) => thing('Coin', ['pickup'], { color: 0xffd34a, w: 0.4, d: 0.4, height: 0.4 }, x, y, h, ['pickup']),
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

export function allPrefabs(prefabs: ReadonlyMap<string, PrefabData>): Prefab[] {
  return [...PREFABS, ...projectPrefabChoices(prefabs)];
}

export function prefabById(id: string, prefabs: ReadonlyMap<string, PrefabData> = new Map()): Prefab {
  return allPrefabs(prefabs).find((p) => p.id === id) ?? PREFABS[1]!;
}
