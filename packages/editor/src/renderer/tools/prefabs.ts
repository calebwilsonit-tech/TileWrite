import { attachBehavior } from '@tilewright/behaviors';
import { resolveInstance, type EntityData, type PrefabData } from '@tilewright/runtime';
import { playerEntity } from '../project/templates';

export interface Prefab {
  id: string;
  label: string;
  hint: string;
  group: 'Basics' | 'Puzzle' | 'Story puzzles' | 'Story' | 'Light' | 'Enemies' | 'Logic' | 'World' | 'Decoration' | 'Your prefabs';
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

/** A walking body on the enemy collision layer. */
function enemyBody(radius = 0.3): Record<string, unknown> {
  return {
    body: {
      vx: 0, vy: 0, vz: 0, radius, height: 1.2, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false,
      gravity: 1, peakZ: 0, layer: 4, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null,
    },
  };
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
    id: 'npc',
    label: 'NPC (talks)',
    group: 'Story',
    hint: 'A character the player talks to with Interact. Choose its conversation in the Inspector; write conversations in the Story panel.',
    make: (x, y, h) => thing('Villager', ['npc'], { color: 0x3d8fe8, w: 0.6, d: 0.6, height: 1.2 }, x, y, h, ['npcTalk']),
  },
  {
    id: 'minigame',
    label: 'Minigame (arcade)',
    group: 'Story',
    hint: 'The player plays a small game with Interact. Choose its minigame in the Inspector; make minigames in the Story panel.',
    make: (x, y, h) => thing('Arcade', ['minigame'], { color: 0xd06a1a, w: 0.7, d: 0.7, height: 1.2 }, x, y, h, ['minigameStation']),
  },
  {
    id: 'lanternpost',
    label: 'Lantern post (checkpoint)',
    group: 'Story',
    hint: 'The player lights it and rests with Interact. Defeat returns them to the last post they rested at, and lit posts are in the Travel menu.',
    make: (x, y, h) => thing('Lantern post', ['lantern-post'], { color: 0x6b6f7a, w: 0.4, d: 0.4, height: 1.4 }, x, y, h, ['checkpoint']),
  },
  {
    id: 'portal',
    label: 'Scene portal (door)',
    group: 'Story',
    hint: 'A doorway to another scene (or another spot in this one). Say where it leads in the Inspector.',
    make: (x, y, h) => thing('Portal', ['portal'], { shape: 'diamond', color: 0xb18cff, w: 1, d: 1, height: 0.05 }, x, y, h, ['portal']),
  },
  {
    id: 'cutscene',
    label: 'Cutscene trigger',
    group: 'Story',
    hint: 'Plays a cutscene when the player walks into it. Write cutscenes in the Story panel.',
    make: (x, y, h) => thing('Cutscene trigger', ['cutscene'], { shape: 'diamond', color: 0xffd34a, w: 2, d: 2, height: 0.05 }, x, y, h, ['cutsceneTrigger']),
  },  {
    id: 'stone',
    label: 'Sentence stone',
    group: 'Story puzzles',
    hint: 'A stone with a sentence and one swappable word ("The bridge [ HOLDS ]"). The player swaps the word with Interact; wire each word to what it should change.',
    make: (x, y, h) => thing('Sentence stone', ['stone'], { color: 0x9ea7c4, w: 0.7, d: 0.7, height: 1 }, x, y, h, ['sentenceStone']),
  },
  {
    id: 'text',
    label: 'Text block',
    group: 'Story puzzles',
    hint: 'A block of text. Underlined it becomes a bridge, bold a wall, italic it slides. The player (or a wire) changes the formatting.',
    make: (x, y, h) => thing('Text block', ['text'], { color: 0xb9b4c9, w: 2, d: 1, height: 0.1 }, x, y, h, ['textBlock']),
  },
  {
    id: 'lantern',
    label: 'Lantern (light)',
    group: 'Light',
    hint: 'Lights the area around it. Walls cast shadows. Switch it on and off with a wire if you like.',
    make: (x, y, h) => thing('Lantern', ['light'], { color: 0xffc866, w: 0.4, d: 0.4, height: 1.1 }, x, y, h, ['light']),
  },
  {
    id: 'lightsensor',
    label: 'Light sensor',
    group: 'Light',
    hint: 'Sends a signal while the spot it stands on is lit (or dark). Wire it to a gate.',
    make: (x, y, h) => thing('Light sensor', ['sensor'], { shape: 'diamond', color: 0xffe9a8, w: 0.9, d: 0.9, height: 0.05 }, x, y, h, ['lightSensor']),
  },
  {
    id: 'dough',
    label: 'Rising dough',
    group: 'Light',
    hint: 'Grows taller over time, faster near light. It becomes a taller solid block, so it can turn into a platform or wall.',
    make: (x, y, h) => thing('Rising dough', ['dough'], { color: 0xf3dfb1, w: 0.9, d: 0.9, height: 0.2 }, x, y, h, ['growing']),
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
    id: 'guard',
    label: 'Guard',
    group: 'Enemies',
    hint: 'Walks a route (Patrol path tool), sees you in a cone, hears footsteps, chases you around walls, then searches and goes home. Hurts on touch.',
    make: (x, y, h) =>
      thing('Guard', ['enemy'], { color: 0x9b2d30, w: 0.6, d: 0.6, height: 1.2 }, x, y, h, ['health', 'vision', 'chase', 'patrol', 'damageOnTouch'], enemyBody()),
  },
  {
    id: 'boss',
    label: 'Boss',
    group: 'Enemies',
    hint: 'A tough guard with Boss Phases: faster and stronger as its health runs down. Mark its room with a Region set to "Bosses here only act while the player is inside".',
    make: (x, y, h) => {
      const e = thing('Boss', ['enemy', 'boss'], { color: 0x5b2a86, w: 1.2, d: 1.2, height: 2 }, x, y, h, ['health', 'vision', 'chase', 'damageOnTouch', 'bossPhases'], enemyBody(0.55));
      Object.assign(e.components.health as object, { max: 12, onDeath: 'stay', invulnerableSeconds: 0.5, fallDamage: 0 });
      (e.components.chase as { speed: number }).speed = 2.6;
      (e.components.vision as { range: number; angle: number }).range = 9;
      (e.components.vision as { range: number; angle: number }).angle = 200;
      (e.components.damageOnTouch as { range: number }).range = 0.9;
      return e;
    },
  },
  {
    id: 'spikes',
    label: 'Spikes',
    group: 'Enemies',
    hint: 'A trap that hurts whatever touches it.',
    make: (x, y, h) => thing('Spikes', ['trap'], { shape: 'diamond', color: 0xcfd3dc, w: 0.9, d: 0.9, height: 0.1 }, x, y, h, ['damageOnTouch']),
  },  {
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
