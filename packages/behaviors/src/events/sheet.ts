import {
  PARTICLE_PRESETS,
  PARTICLE_PRESET_IDS,
  addImpact,
  emitFx,
  requestHitStop,
  C,
  evalValue,
  backScreen,
  closeScreen,
  openScreen,
  toggleScreen,
  setClockMode,
  setClockSpeed,
  expandEntities,
  fillValues,
  resolveValue,
  teleportBody,
  GRAVITY_DIRS,
  GRAVITY_NAMES,
  isGravityDir,
  type Body,
  type BlockShape,
  type GravityDir,
  type Collider,
  type Entity,
  type EventAction,
  type EventCondition,
  type EventRow,
  type SimContext,
  type Sprite,
  type TransformIso,
  type VariableValue,
} from '@tilewright/runtime';
import { input, output, setInput, setOutput } from '../signals';
import { blockAtCell, breakBlock, placeBlock, tileByName } from '../builtins/blocks';

/**
 * Event sheets: "When [conditions] do [actions]" rows in plain English, with sub-events, AND/OR,
 * loops and variables. Every condition and action is described here once, and the editor, the Problems
 * panel and the assistant all read the same definitions.
 */

// ---------- references to objects ----------

/**
 * How a row points at objects: `id:e3` (one placed object), `tag:enemy` (all with a tag), `name:Crate`,
 * `player` (the player), or `picked` (the object a "for each" loop is looking at).
 */
export type Ref = string;

export function resolveRef(ctx: SimContext, ref: Ref, picked?: Entity): Entity[] {
  if (!ref) return [];
  if (ref === 'picked' || ref === 'self') return picked && picked.alive ? [picked] : [];
  if (ref === 'player') return ctx.world.withTag('player');
  if (ref === 'turn') {
    const t = ctx.runtime.turns;
    const e = t.active ? ctx.world.get(t.order[t.index] ?? -1) : undefined;
    return e ? [e] : [];
  }
  const [kind, ...rest] = ref.split(':');
  const value = rest.join(':');
  if (kind === 'id') {
    const e = ctx.world.get(ctx.runtime.ids.get(value) ?? -1);
    return e ? [e] : [];
  }
  if (kind === 'tag') return ctx.world.withTag(value);
  if (kind === 'name') return ctx.world.all().filter((e) => e.name === value);
  return [];
}

export interface Names {
  /** Display name of a placed object by its scene id. */
  entity(id: string): string | undefined;
}

export function describeRef(ref: Ref, names?: Names): string {
  if (!ref) return 'nothing chosen';
  if (ref === 'picked') return 'the picked object';
  if (ref === 'self') return 'this object';
  if (ref === 'turn') return 'the unit whose turn it is';
  if (ref === 'player') return 'the player';
  const [kind, ...rest] = ref.split(':');
  const value = rest.join(':');
  if (kind === 'id') return `"${names?.entity(value) ?? value}"`;
  if (kind === 'tag') return `anything tagged "${value}"`;
  if (kind === 'table') return `each row of the table "${value}"`;
  if (kind === 'name') return `"${value}"`;
  return ref;
}

// ---------- parameters ----------

export type ParamType = 'number' | 'text' | 'boolean' | 'select' | 'entity' | 'variable' | 'signal' | 'prefab' | 'action' | 'sound' | 'screen';

export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  default: unknown;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  /** The picker also offers this project's own things of this kind (the editor reads it). */
  extra?: 'events';
}

export const COMPARISONS = [
  { value: '=', label: 'is' },
  { value: '!=', label: 'is not' },
  { value: '>', label: 'is more than' },
  { value: '>=', label: 'is at least' },
  { value: '<', label: 'is less than' },
  { value: '<=', label: 'is at most' },
];

export const num = (p: Record<string, unknown>, k: string, d = 0): number => (typeof p[k] === 'number' ? (p[k] as number) : Number(p[k] ?? d) || d);
export const str = (p: Record<string, unknown>, k: string): string => String(p[k] ?? '');

export function compare(a: VariableValue | undefined, op: string, b: VariableValue): boolean {
  const numeric = typeof a === 'number' && typeof b === 'number';
  const left = numeric ? (a as number) : String(a ?? (typeof b === 'number' ? 0 : ''));
  const right = numeric || typeof b === 'number' ? Number(b) : String(b);
  const l = typeof right === 'number' && typeof left !== 'number' ? Number(left) : left;
  switch (op) {
    case '=':
      return l === right;
    case '!=':
      return l !== right;
    case '>':
      return l > right;
    case '>=':
      return l >= right;
    case '<':
      return l < right;
    case '<=':
      return l <= right;
    default:
      return false;
  }
}

/** Fill {variable} placeholders in a message with the variable's value. */
export function interpolate(text: string, vars: Record<string, VariableValue>): string {
  return text.replace(/\{([^{}]+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export interface RowContext {
  /** The object a "for each" loop is looking at. */
  picked: Entity | undefined;
}

export interface ConditionDef {
  id: string;
  label: string;
  category: string;
  params: ParamSpec[];
  describe(p: Record<string, unknown>, n?: Names): string;
  test(ctx: SimContext, p: Record<string, unknown>, row: RowContext): boolean;
}

export interface ActionDef {
  id: string;
  label: string;
  category: string;
  params: ParamSpec[];
  describe(p: Record<string, unknown>, n?: Names): string;
  run(ctx: SimContext, p: Record<string, unknown>, row: RowContext): void;
}

export const entityParam = (key: string, label: string, def = 'player'): ParamSpec => ({ key, label, type: 'entity', default: def });

const GRAVITY_OPTIONS = GRAVITY_DIRS.map((d) => ({ value: d, label: GRAVITY_NAMES[d] }));

export const CONDITIONS: ConditionDef[] = [
  {
    id: 'gravityIs',
    label: 'Gravity points a way',
    category: 'World',
    params: [
      { key: 'who', label: 'Whose gravity', type: 'select', default: 'scene', options: [{ value: 'scene', label: "the scene's" }, { value: 'player', label: "the player's" }] },
      { key: 'dir', label: 'Toward', type: 'select', default: '-z', options: GRAVITY_OPTIONS },
    ],
    describe: (p) => `gravity (${str(p, 'who') === 'player' ? "the player's" : "the scene's"}) pulls ${GRAVITY_NAMES[str(p, 'dir') as GravityDir] ?? str(p, 'dir')}`,
    test(ctx, p) {
      if (str(p, 'who') !== 'player') return ctx.runtime.gravity === str(p, 'dir');
      const b = ctx.world.withTag('player')[0]?.get<Body>(C.Body);
      return (b?.g ?? b?.gdir ?? ctx.runtime.gravity) === str(p, 'dir');
    },
  },
  {
    id: 'blockAt',
    label: 'There is a block in a place',
    category: 'World',
    params: [
      { key: 'x', label: 'x (cell)', type: 'text', default: '0' },
      { key: 'y', label: 'y (cell)', type: 'text', default: '0' },
      { key: 'z', label: 'Level', type: 'text', default: '0' },
      { key: 'tile', label: 'Of this tile (empty: any)', type: 'text', default: '' },
    ],
    describe: (p) => `there is a ${str(p, 'tile') || 'block'} at ${str(p, 'x')}, ${str(p, 'y')}, level ${str(p, 'z')}`,
    test(ctx, p) {
      const src = { vars: ctx.runtime.vars, tables: ctx.assets.tables, world: ctx.world };
      const at = (k: string): number => Math.floor(Number(evalValue(src, str(p, k))) || 0);
      const b = blockAtCell(ctx, at('x'), at('y'), at('z'));
      if (!b) return false;
      return str(p, 'tile') === '' || tileByName(ctx, str(p, 'tile')) === b.tile;
    },
  },
  {
    id: 'always',
    label: 'Always',
    category: 'Basics',
    params: [],
    describe: () => 'always',
    test: () => true,
  },
  {
    id: 'start',
    label: 'The game starts',
    category: 'Basics',
    params: [],
    describe: () => 'the game starts',
    test: (ctx) => ctx.tick === 0,
  },
  {
    id: 'sceneStart',
    label: 'The scene starts (also after travelling, and when a new run begins)',
    category: 'Basics',
    params: [],
    describe: () => 'the scene starts',
    test: (ctx) => ctx.tick === (ctx.runtime.scratch.get('sceneStartTick') ?? 0),
  },
  {
    id: 'every',
    label: 'Every few seconds',
    category: 'Basics',
    params: [{ key: 'seconds', label: 'Seconds', type: 'number', default: 2, min: 0.1, step: 0.1 }],
    describe: (p) => `every ${num(p, 'seconds', 2)} seconds`,
    test: (ctx, p) => ctx.tick > 0 && ctx.tick % Math.max(1, Math.round(num(p, 'seconds', 2) * 60)) === 0,
  },
  {
    id: 'clockIs',
    label: 'The game clock is',
    category: 'Time',
    params: [{ key: 'mode', label: 'Mode', type: 'select', default: 'paused', options: [{ value: 'realtime', label: 'running in real time' }, { value: 'paused', label: 'paused' }, { value: 'turns', label: 'turn-based' }] }],
    describe: (p) => `the game is ${str(p, 'mode') === 'turns' ? 'turn-based' : str(p, 'mode') === 'paused' ? 'paused' : 'running in real time'}`,
    test: (ctx, p) => ctx.runtime.clock.mode === str(p, 'mode'),
  },
  {
    id: 'chance',
    label: 'Random chance',
    category: 'Basics',
    params: [{ key: 'percent', label: 'Chance each tick (%)', type: 'number', default: 1, min: 0, max: 100, step: 0.5 }],
    describe: (p) => `there is a ${num(p, 'percent', 1)}% chance`,
    test: (ctx, p) => ctx.rng.next() * 100 < num(p, 'percent', 1),
  },
  {
    id: 'variable',
    label: 'A variable compares',
    category: 'Variables',
    params: [
      { key: 'name', label: 'Variable', type: 'variable', default: '' },
      { key: 'op', label: 'Is', type: 'select', default: '>=', options: COMPARISONS },
      { key: 'value', label: 'Value', type: 'text', default: '1' },
    ],
    describe: (p) => `${str(p, 'name') || '(variable)'} ${COMPARISONS.find((c) => c.value === str(p, 'op'))?.label ?? str(p, 'op')} ${str(p, 'value')}`,
    test: (ctx, p) => {
      const src = { vars: ctx.runtime.vars, tables: ctx.assets.tables, world: ctx.world };
      return compare(resolveValue(src, str(p, 'name')), str(p, 'op'), evalValue(src, str(p, 'value')));
    },
  },
  {
    id: 'count',
    label: 'How many objects there are',
    category: 'Variables',
    params: [
      { key: 'tag', label: 'Tag', type: 'text', default: 'enemy' },
      { key: 'op', label: 'Is', type: 'select', default: '=', options: COMPARISONS },
      { key: 'value', label: 'Number', type: 'number', default: 0, step: 1 },
    ],
    describe: (p) => `the number of "${str(p, 'tag')}" objects ${COMPARISONS.find((c) => c.value === str(p, 'op'))?.label ?? ''} ${num(p, 'value')}`,
    test: (ctx, p) => compare(ctx.world.withTag(str(p, 'tag')).length, str(p, 'op'), num(p, 'value')),
  },
  {
    id: 'exists',
    label: 'An object exists',
    category: 'Objects',
    params: [entityParam('who', 'Object', 'tag:enemy')],
    describe: (p, n) => `${describeRef(str(p, 'who'), n)} exists`,
    test: (ctx, p, row) => resolveRef(ctx, str(p, 'who'), row.picked).length > 0,
  },
  {
    id: 'signal',
    label: "An object's signal is on or off",
    category: 'Objects',
    params: [
      entityParam('who', 'Object', ''),
      { key: 'side', label: 'Which side', type: 'select', default: 'output', options: [{ value: 'output', label: 'sends (output)' }, { value: 'input', label: 'receives (input)' }] },
      { key: 'name', label: 'Signal', type: 'signal', default: '' },
      { key: 'state', label: 'Is', type: 'select', default: 'on', options: [{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }] },
    ],
    describe: (p, n) => `${describeRef(str(p, 'who'), n)} ${str(p, 'side') === 'input' ? 'receives' : 'sends'} the signal "${str(p, 'name')}" ${str(p, 'state') === 'off' ? 'off' : 'on'}`,
    test: (ctx, p, row) => {
      const want = str(p, 'state') !== 'off';
      return resolveRef(ctx, str(p, 'who'), row.picked).some((e) => (str(p, 'side') === 'input' ? input(e, str(p, 'name')) : output(e, str(p, 'name'))) === want);
    },
  },
  {
    id: 'inside',
    label: 'Something is inside an area',
    category: 'Objects',
    params: [entityParam('who', 'Who', 'player'), entityParam('zone', 'Inside which trigger area', '')],
    describe: (p, n) => `${describeRef(str(p, 'who'), n)} is inside ${describeRef(str(p, 'zone'), n)}`,
    test: (ctx, p, row) => {
      const who = new Set(resolveRef(ctx, str(p, 'who'), row.picked).map((e) => e.id));
      return resolveRef(ctx, str(p, 'zone'), row.picked).some((z) => z.get<Collider>(C.Collider)?.inside.some((id) => who.has(id)));
    },
  },
  {
    id: 'near',
    label: 'Two objects are close together',
    category: 'Objects',
    params: [entityParam('a', 'First', 'player'), entityParam('b', 'Second', ''), { key: 'cells', label: 'Within (cells)', type: 'number', default: 2, min: 0.1, step: 0.1 }],
    describe: (p, n) => `${describeRef(str(p, 'a'), n)} is within ${num(p, 'cells', 2)} cells of ${describeRef(str(p, 'b'), n)}`,
    test: (ctx, p, row) => {
      const bs = resolveRef(ctx, str(p, 'b'), row.picked);
      return resolveRef(ctx, str(p, 'a'), row.picked).some((a) => {
        const at = a.get<TransformIso>(C.Transform);
        return !!at && bs.some((b) => {
          const bt = b.get<TransformIso>(C.Transform);
          return !!bt && Math.hypot(at.x - bt.x, at.y - bt.y) <= num(p, 'cells', 2);
        });
      });
    },
  },
  {
    id: 'action',
    label: 'The player presses a button',
    category: 'Input',
    params: [
      { key: 'name', label: 'Button', type: 'action', default: 'interact' },
      { key: 'mode', label: 'When it is', type: 'select', default: 'pressed', options: [{ value: 'pressed', label: 'pressed (just now)' }, { value: 'held', label: 'held down' }, { value: 'released', label: 'released (just now)' }] },
    ],
    describe: (p) => `the "${str(p, 'name')}" button is ${str(p, 'mode') || 'pressed'}`,
    test: (ctx, p) => (str(p, 'mode') === 'held' ? ctx.input.down(str(p, 'name')) : str(p, 'mode') === 'released' ? ctx.input.released(str(p, 'name')) : ctx.input.pressed(str(p, 'name'))),
  },
  {
    id: 'entityEvent',
    label: 'Something happens to an object',
    category: 'Objects',
    params: [
      entityParam('who', 'Object', ''),
      {
        key: 'name',
        label: 'What happens to it',
        type: 'select',
        default: 'died',
        options: [
          { value: 'died', label: 'is defeated' },
          { value: 'damaged', label: 'is hurt' },
          { value: 'pickup', label: 'is picked up' },
          { value: 'turn-start', label: 'starts its turn' },
          { value: 'turn-end', label: 'ends its turn' },
          { value: 'unit-moved', label: 'finishes walking' },
          { value: 'landed', label: 'lands' },
          { value: 'gravity-changed', label: 'feels gravity turn' },
          { value: 'noticed', label: 'notices something' },
          { value: 'state-changed', label: 'changes state' },
          { value: 'hotspot-used', label: 'is used (hotspot)' },
          { value: 'boss-defeated', label: 'is defeated (boss)' },
        ],
      },
    ],
    describe: (p, n) => `${describeRef(str(p, 'who'), n)} ${ENTITY_EVENT_TEXT[str(p, 'name')] ?? str(p, 'name')}`,
    test(ctx, p, row) {
      const who = str(p, 'who');
      const ids = new Set<number>();
      // a defeated object is already gone, so its own name is looked up directly and a tag is read from what the event carried
      if (who.startsWith('id:')) {
        const live = ctx.runtime.ids.get(who.slice(3));
        if (live !== undefined) ids.add(live);
      } else for (const e of resolveRef(ctx, who, row.picked)) ids.add(e.id);
      const tag = who.startsWith('tag:') ? who.slice(4) : '';
      return ctx.events.of(str(p, 'name')).some((ev) => ids.has(Number(ev.entity)) || (tag !== '' && Array.isArray(ev.tags) && (ev.tags as string[]).includes(tag)));
    },
  },
  {
    id: 'onEvent',
    label: 'Something happens in the game',
    category: 'Basics',
    params: [
      {
        key: 'name',
        label: 'What happens',
        type: 'select',
        default: 'pickup',
        options: [
          { value: 'pickup', label: 'something is picked up' },
          { value: 'pushed', label: 'a crate is pushed' },
          { value: 'landed', label: 'something lands' },
          { value: 'gravity-changed', label: 'gravity turns for something' },
          { value: 'block-placed', label: 'a block is placed' },
          { value: 'block-broken', label: 'a block is broken' },
          { value: 'fell', label: 'something falls into a pit' },
          { value: 'floor-fell', label: 'a floor crumbles' },
          { value: 'projectile-hit', label: 'a projectile hits' },
          { value: 'spawned', label: 'something is created' },
          { value: 'anim-event', label: 'an animation event fires' },
          { value: 'damaged', label: 'something is hurt' },
          { value: 'died', label: 'something is defeated' },
          { value: 'attack', label: 'the player swings the quill' },
          { value: 'dodge', label: 'the player dodges' },
          { value: 'noticed', label: 'a guard notices something' },
          { value: 'lost', label: 'a guard loses track' },
          { value: 'state-changed', label: 'a character changes state (State Machine)' },
          { value: 'boss-phase', label: 'a boss enters a new phase' },
          { value: 'boss-defeated', label: 'a boss is defeated' },
          { value: 'echo-made', label: 'an echo is recorded' },
          { value: 'sentence-changed', label: 'a sentence stone changes its word' },
          { value: 'text-formatted', label: 'a text block is reformatted' },
          { value: 'dialogue-started', label: 'a conversation starts' },
          { value: 'dialogue-ended', label: 'a conversation ends' },
          { value: 'minigame-started', label: 'a minigame starts' },
          { value: 'minigame-ended', label: 'a minigame ends' },
          { value: 'cutscene-started', label: 'a cutscene starts' },
          { value: 'cutscene-ended', label: 'a cutscene ends' },
          { value: 'lantern-lit', label: 'a lantern is lit' },
          { value: 'rested', label: 'the player rests at a lantern' },
          { value: 'item-given', label: 'the player receives an item' },
          { value: 'portal', label: 'the player walks through a portal' },
          { value: 'battle-started', label: 'a turn-based battle starts' },
          { value: 'turn-start', label: 'a unit\'s turn starts' },
          { value: 'turn-end', label: 'a unit\'s turn ends' },
          { value: 'round-start', label: 'a new round of turns starts' },
          { value: 'battle-won', label: 'a battle is won' },
          { value: 'unit-moved', label: 'a unit finishes walking' },
          { value: 'unit-attacked', label: 'a unit attacks' },
          { value: 'building-placed', label: 'a building is placed' },
          { value: 'orders-given', label: 'units are given an order' },
          { value: 'click-move', label: 'the player clicks to walk somewhere' },
          { value: 'hotspot-used', label: 'a hotspot is used' },
          { value: 'path-end', label: 'something reaches the end of its path' },
          { value: 'wave-started', label: 'a wave of enemies starts' },
          { value: 'wave-cleared', label: 'a wave of enemies is beaten' },
          { value: 'waves-done', label: 'every wave is done' },
          { value: 'produced', label: 'a producer makes something' },
          { value: 'new-day', label: 'a new day begins' },
          { value: 'night-start', label: 'night falls' },
          { value: 'day-start', label: 'the day breaks' },
          { value: 'new-season', label: 'a new season begins' },
          { value: 'activity-done', label: 'a villager finishes what it was doing' },
        ],
        extra: 'events',
      },
    ],
    describe: (p) => (COND_EVENT_TEXT[str(p, 'name')] ?? `"${str(p, 'name')}" happens`),
    test: (ctx, p) => ctx.events.of(str(p, 'name')).length > 0,
  },
];

const ENTITY_EVENT_TEXT: Record<string, string> = {
  died: 'is defeated',
  damaged: 'is hurt',
  pickup: 'is picked up',
  'turn-start': 'starts its turn',
  'turn-end': 'ends its turn',
  'unit-moved': 'finishes walking',
  noticed: 'notices something',
  'state-changed': 'changes state',
  'hotspot-used': 'is used',
  'boss-defeated': 'is defeated',
};

const COND_EVENT_TEXT: Record<string, string> = {
  'path-end': 'something reaches the end of its path',
  'wave-started': 'a wave of enemies starts',
  'wave-cleared': 'a wave of enemies is beaten',
  'waves-done': 'every wave is done',
  'produced': 'a producer makes something',
  'new-day': 'a new day begins',
  'night-start': 'night falls',
  'day-start': 'the day breaks',
  'new-season': 'a new season begins',
  'activity-done': 'a villager finishes what it was doing',
  pickup: 'something is picked up',
  pushed: 'a crate is pushed',
  landed: 'something lands',
  'gravity-changed': 'gravity turns for something',
  'block-placed': 'a block is placed',
  'block-broken': 'a block is broken',
  fell: 'something falls into a pit',
  'floor-fell': 'a floor crumbles',
  'projectile-hit': 'a projectile hits something',
  spawned: 'something is created',
  'anim-event': 'an animation event fires',
  damaged: 'something is hurt',
  died: 'something is defeated',
  attack: 'the player swings the quill',
  dodge: 'the player dodges',
  noticed: 'a guard notices something',
  lost: 'a guard loses track',
  'state-changed': 'a character changes state',
  'boss-phase': 'a boss enters a new phase',
  'boss-defeated': 'a boss is defeated',
  'echo-made': 'an echo is recorded',
  'sentence-changed': 'a sentence stone changes its word',
  'text-formatted': 'a text block is reformatted',
  'dialogue-started': 'a conversation starts',
  'dialogue-ended': 'a conversation ends',
  'minigame-started': 'a minigame starts',
  'minigame-ended': 'a minigame ends',
  'cutscene-started': 'a cutscene starts',
  'cutscene-ended': 'a cutscene ends',
  'lantern-lit': 'a lantern is lit',
  rested: 'the player rests at a lantern',
  'item-given': 'the player receives an item',
  portal: 'the player walks through a portal',
};

const onOff = [{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }, { value: 'toggle', label: 'the other way (toggle)' }];

function parseValue(raw: string): VariableValue {
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

export const ACTIONS: ActionDef[] = [
  {
    id: 'setGravity',
    label: 'Turn gravity',
    category: 'World',
    params: [
      { key: 'who', label: 'For', type: 'select', default: 'scene', options: [{ value: 'scene', label: 'the whole scene' }, { value: 'picked', label: 'the object the row is looking at' }, { value: 'player', label: 'the player' }] },
      { key: 'dir', label: 'Toward', type: 'select', default: '-z', options: GRAVITY_OPTIONS },
    ],
    describe: (p) => `turn gravity ${GRAVITY_NAMES[str(p, 'dir') as GravityDir] ?? str(p, 'dir')} for ${str(p, 'who') === 'scene' ? 'the scene' : str(p, 'who') === 'player' ? 'the player' : 'that object'}`,
    run(ctx, p, row) {
      const dir = str(p, 'dir');
      if (!isGravityDir(dir)) return;
      if (!ctx.compat.blockPhysics) {
        ctx.events.emit('problem', { text: 'This project plays with the older physics, where gravity only points down. Turn on "Bodies collide with every block" in Project settings -> Compatibility to use gravity in other directions.' });
        return;
      }
      if (str(p, 'who') === 'scene') {
        ctx.runtime.gravity = dir;
        return;
      }
      const targets = str(p, 'who') === 'player' ? ctx.world.withTag('player') : row.picked ? [row.picked] : [];
      for (const e of targets) {
        const b = e.get<Body>(C.Body);
        if (b) b.gdir = dir;
      }
    },
  },
  {
    id: 'placeBlock',
    label: 'Place a block',
    category: 'World',
    params: [
      { key: 'x', label: 'x (cell)', type: 'text', default: '0' },
      { key: 'y', label: 'y (cell)', type: 'text', default: '0' },
      { key: 'z', label: 'Level', type: 'text', default: '0' },
      { key: 'tile', label: 'Tile (its name)', type: 'text', default: 'stone' },
      { key: 'shape', label: 'Shape', type: 'select', default: 'cube', options: [{ value: 'cube', label: 'a whole block' }, { value: 'stairs', label: 'stairs' }, { value: 'ramp', label: 'a ramp' }] },
      { key: 'rot', label: 'Stairs and ramps rise toward', type: 'select', default: '0', options: [{ value: '0', label: 'north (low y)' }, { value: '1', label: 'east (high x)' }, { value: '2', label: 'south (high y)' }, { value: '3', label: 'west (low x)' }] },
    ],
    describe: (p) => `place ${str(p, 'shape') === 'cube' ? 'a' : str(p, 'shape')} ${str(p, 'tile')} block at ${str(p, 'x')}, ${str(p, 'y')}, level ${str(p, 'z')}`,
    run(ctx, p) {
      const src = { vars: ctx.runtime.vars, tables: ctx.assets.tables, world: ctx.world };
      const at = (k: string): number => Math.floor(Number(evalValue(src, str(p, k))) || 0);
      const shape = (['cube', 'stairs', 'ramp'].includes(str(p, 'shape')) ? str(p, 'shape') : 'cube') as BlockShape;
      const r = placeBlock(ctx, { x: at('x'), y: at('y'), z: at('z'), tile: str(p, 'tile'), shape, rot: (Number(str(p, 'rot')) & 3) as 0 | 1 | 2 | 3 });
      if (!r.ok) ctx.events.emit('problem', { text: r.why });
    },
  },
  {
    id: 'breakBlock',
    label: 'Break a block',
    category: 'World',
    params: [
      { key: 'x', label: 'x (cell)', type: 'text', default: '0' },
      { key: 'y', label: 'y (cell)', type: 'text', default: '0' },
      { key: 'z', label: 'Level', type: 'text', default: '0' },
    ],
    describe: (p) => `break the block at ${str(p, 'x')}, ${str(p, 'y')}, level ${str(p, 'z')}`,
    run(ctx, p) {
      const src = { vars: ctx.runtime.vars, tables: ctx.assets.tables, world: ctx.world };
      const at = (k: string): number => Math.floor(Number(evalValue(src, str(p, k))) || 0);
      const r = breakBlock(ctx, at('x'), at('y'), at('z'));
      if (!r.ok) ctx.events.emit('problem', { text: r.why });
    },
  },
  {
    id: 'setVariable',
    label: 'Change a variable',
    category: 'Variables',
    params: [
      { key: 'name', label: 'Variable', type: 'variable', default: '' },
      { key: 'op', label: 'Do', type: 'select', default: 'set', options: [{ value: 'set', label: 'set to' }, { value: 'add', label: 'add' }, { value: 'subtract', label: 'subtract' }, { value: 'multiply', label: 'multiply by' }, { value: 'toggle', label: 'flip (true/false)' }] },
      { key: 'value', label: 'Value', type: 'text', default: '1' },
    ],
    describe: (p) => {
      const n = str(p, 'name') || '(variable)';
      switch (str(p, 'op')) {
        case 'add':
          return `add ${str(p, 'value')} to ${n}`;
        case 'subtract':
          return `subtract ${str(p, 'value')} from ${n}`;
        case 'multiply':
          return `multiply ${n} by ${str(p, 'value')}`;
        case 'toggle':
          return `flip ${n}`;
        default:
          return `set ${n} to ${str(p, 'value')}`;
      }
    },
    run(ctx, p) {
      const name = str(p, 'name');
      if (!name) return;
      const cur = ctx.runtime.vars[name];
      const v = evalValue({ vars: ctx.runtime.vars, tables: ctx.assets.tables, world: ctx.world }, str(p, 'value'));
      switch (str(p, 'op')) {
        case 'add':
          ctx.runtime.vars[name] = (typeof cur === 'number' ? cur : 0) + Number(v);
          break;
        case 'subtract':
          ctx.runtime.vars[name] = (typeof cur === 'number' ? cur : 0) - Number(v);
          break;
        case 'multiply':
          ctx.runtime.vars[name] = (typeof cur === 'number' ? cur : 0) * Number(v);
          break;
        case 'toggle':
          ctx.runtime.vars[name] = !cur;
          break;
        default:
          ctx.runtime.vars[name] = v;
      }
    },
  },
  {
    id: 'rollTable',
    label: 'Roll a random row of a table (loot, random events)',
    category: 'Variables',
    params: [
      { key: 'table', label: 'Table', type: 'text', default: 'Loot' },
      { key: 'weight', label: 'Column that says how likely a row is (empty: all equally likely)', type: 'text', default: 'weight' },
      { key: 'into', label: 'Keep the row in variables starting with', type: 'text', default: 'roll' },
    ],
    describe: (p) => `roll a random row of the table "${str(p, 'table')}" (into ${str(p, 'into') || 'roll'}.id, ${str(p, 'into') || 'roll'}.<column>)`,
    // uses the game's seeded random numbers, so a replay or a run with the same seed rolls the same things
    run(ctx, p) {
      const rows = ctx.assets.tables.get(str(p, 'table'))?.rows ?? [];
      const into = str(p, 'into') || 'roll';
      const col = str(p, 'weight');
      const weightOf = (r: Record<string, unknown>): number => (col ? Math.max(0, Number(r[col] ?? 0)) : 1);
      const total = rows.reduce((n, r) => n + weightOf(r), 0);
      if (rows.length === 0 || total <= 0) return void (ctx.runtime.vars[`${into}.id`] = '');
      let at = ctx.rng.next() * total;
      const row = rows.find((r) => (at -= weightOf(r)) < 0) ?? rows[rows.length - 1]!;
      for (const [k, v] of Object.entries(row)) ctx.runtime.vars[`${into}.${k}`] = v as VariableValue;
    },
  },
  {
    id: 'setClock',
    label: 'Pause or resume the game, or change its speed',
    category: 'Time',
    params: [
      { key: 'mode', label: 'Clock', type: 'select', default: 'realtime', options: [{ value: 'realtime', label: 'run in real time' }, { value: 'paused', label: 'pause' }, { value: 'turns', label: 'go by turns' }] },
      { key: 'speed', label: 'Speed', type: 'select', default: '1', options: [{ value: '1', label: 'Normal (1x)' }, { value: '2', label: 'Fast (2x)' }, { value: '4', label: 'Faster (4x)' }, { value: '8', label: 'Fastest (8x)' }] },
    ],
    describe: (p) => `${str(p, 'mode') === 'paused' ? 'pause the game' : str(p, 'mode') === 'turns' ? 'switch to turn-based time' : `run the game at ${str(p, 'speed') || '1'}x`}`,
    run(ctx, p) {
      setClockMode(ctx.runtime.clock, str(p, 'mode') === 'paused' ? 'paused' : str(p, 'mode') === 'turns' ? 'turns' : 'realtime');
      setClockSpeed(ctx.runtime.clock, Number(str(p, 'speed') || 1));
    },
  },
  {
    id: 'newRun',
    label: 'Start a new run (roguelike): new seed, nothing carried over',
    category: 'Basics',
    params: [{ key: 'scene', label: 'Scene to start in (empty = this one)', type: 'text', default: '' }],
    describe: (p) => `start a new run${str(p, 'scene') ? ` in ${str(p, 'scene')}` : ''}`,
    run(ctx, p) {
      const vars = ctx.runtime.vars;
      const count = (Number(vars['run.count']) || 0) + 1;
      // everything is forgotten except what describes the runs themselves
      const keep: Record<string, VariableValue> = {};
      for (const k of Object.keys(vars)) if (k.startsWith('run.') || k.startsWith('best.')) keep[k] = vars[k]!;
      for (const k of Object.keys(vars)) delete vars[k];
      Object.assign(vars, keep);
      vars['run.count'] = count;
      vars['run.seed'] = ctx.rng.int(1, 2 ** 30);
      ctx.runtime.travel = { scene: str(p, 'scene'), spawn: '', fresh: true };
      ctx.events.emit('new-run', { count });
    },
  },
  {
    id: 'setSignal',
    label: "Turn an object's signal on or off",
    category: 'Objects',
    params: [entityParam('who', 'Object', ''), { key: 'name', label: 'Signal it sends', type: 'signal', default: '' }, { key: 'state', label: 'Turn it', type: 'select', default: 'on', options: onOff }],
    describe: (p, n) => `turn ${describeRef(str(p, 'who'), n)}'s signal "${str(p, 'name')}" ${str(p, 'state') === 'toggle' ? 'the other way' : str(p, 'state') === 'off' ? 'off' : 'on'}`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'who'), row.picked)) {
        const cur = output(e, str(p, 'name'));
        setOutput(e, str(p, 'name'), str(p, 'state') === 'toggle' ? !cur : str(p, 'state') !== 'off');
      }
    },
  },
  {
    id: 'sendSignal',
    label: "Send a signal into an object (open a gate, start a timer...)",
    category: 'Objects',
    params: [entityParam('who', 'Object', ''), { key: 'name', label: 'Signal it receives', type: 'signal', default: '' }, { key: 'state', label: 'Turn it', type: 'select', default: 'on', options: [...onOff, { value: 'pulse', label: 'on for a moment (a pulse)' }] }],
    describe: (p, n) => `${str(p, 'state') === 'toggle' ? 'flip' : str(p, 'state') === 'off' ? 'turn off' : str(p, 'state') === 'pulse' ? 'pulse' : 'turn on'} ${describeRef(str(p, 'who'), n)}'s "${str(p, 'name')}" input`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'who'), row.picked)) {
        const name = str(p, 'name');
        const cur = input(e, name);
        const state = str(p, 'state');
        setInput(e, name, state === 'toggle' ? !cur : state !== 'off');
        if (state === 'pulse') {
          // wires leave the input alone when nothing feeds it, so a pulse is switched off again two ticks later
          const list = (ctx.runtime.scratch.get('pulses') as { id: number; name: string; tick: number }[] | undefined) ?? [];
          list.push({ id: e.id, name, tick: ctx.tick });
          ctx.runtime.scratch.set('pulses', list);
        }
      }
    },
  },
  {
    id: 'destroy',
    label: 'Remove an object',
    category: 'Objects',
    params: [entityParam('who', 'Object', 'picked')],
    describe: (p, n) => `remove ${describeRef(str(p, 'who'), n)}`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'who'), row.picked)) ctx.world.destroy(e);
    },
  },
  {
    id: 'spawn',
    label: 'Create an object from a prefab',
    category: 'Objects',
    params: [
      { key: 'prefab', label: 'Prefab', type: 'prefab', default: '' },
      entityParam('at', 'Where (an object)', ''),
      { key: 'dx', label: 'Shift X (cells)', type: 'number', default: 0, step: 0.5 },
      { key: 'dy', label: 'Shift Y (cells)', type: 'number', default: 0, step: 0.5 },
    ],
    describe: (p, n) => `create "${str(p, 'prefab') || '(prefab)'}" at ${describeRef(str(p, 'at'), n)}`,
    run(ctx, p, row) {
      const prefab = ctx.assets.prefabs.get(str(p, 'prefab'));
      if (!prefab) {
        ctx.events.emit('problem', { text: `An event creates the prefab "${str(p, 'prefab')}", which does not exist.` });
        return;
      }
      const at = resolveRef(ctx, str(p, 'at'), row.picked)[0]?.get<TransformIso>(C.Transform);
      const id = `spawn#${ctx.tick}.${ctx.runtime.ids.size}`;
      const { entities } = expandEntities([{ id, name: prefab.name, tags: [], prefab: prefab.name, components: { transform: { x: (at?.x ?? 0) + num(p, 'dx'), y: (at?.y ?? 0) + num(p, 'dy'), h: at?.h ?? 0 } } }], ctx.assets.prefabs);
      for (const data of entities) {
        const e = ctx.world.spawn({ name: data.name, tags: data.tags, components: structuredClone(data.components) });
        e.set('meta', { sceneId: data.id });
        ctx.runtime.ids.set(data.id, e.id);
        const c = e.get<{ inside?: number[] }>(C.Collider);
        if (c) c.inside = [];
      }
    },
  },
  {
    id: 'teleport',
    label: 'Move an object to another object',
    category: 'Objects',
    params: [entityParam('who', 'Move', 'player'), entityParam('to', 'To', '')],
    describe: (p, n) => `move ${describeRef(str(p, 'who'), n)} to ${describeRef(str(p, 'to'), n)}`,
    run(ctx, p, row) {
      const dest = resolveRef(ctx, str(p, 'to'), row.picked)[0]?.get<TransformIso>(C.Transform);
      if (!dest) return;
      for (const e of resolveRef(ctx, str(p, 'who'), row.picked)) teleportBody(ctx, e, dest.x, dest.y, dest.h);
    },
  },
  {
    id: 'travel',
    label: 'Go to another scene',
    category: 'Story',
    params: [{ key: 'scene', label: 'Scene file (empty = this one)', type: 'text', default: '' }, { key: 'spawn', label: 'Appear at (object name, or "x,y")', type: 'text', default: '' }],
    describe: (p) => `go to ${str(p, 'scene') || 'this scene'}${str(p, 'spawn') ? ` at "${str(p, 'spawn')}"` : ''}`,
    run(ctx, p) {
      if (!ctx.runtime.travel) ctx.runtime.travel = { scene: str(p, 'scene') || ctx.runtime.scene, spawn: str(p, 'spawn') };
    },
  },
  {
    id: 'saveGame',
    label: 'Save the game (autosave)',
    category: 'Story',
    params: [],
    describe: () => 'save the game',
    run: (ctx) => void ctx.events.emit('save-request', { slot: 'autosave' }),
  },
  {
    id: 'uiScreen',
    label: 'Open or close an interface screen',
    category: 'Interface',
    params: [
      { key: 'op', label: 'Do', type: 'select', default: 'open', options: [{ value: 'open', label: 'open' }, { value: 'close', label: 'close' }, { value: 'toggle', label: 'open or close' }, { value: 'back', label: 'go back one screen' }, { value: 'closeAll', label: 'close every screen' }] },
      { key: 'screen', label: 'Screen', type: 'screen', default: '' },
    ],
    describe: (p) => (str(p, 'op') === 'back' ? 'go back one screen' : str(p, 'op') === 'closeAll' ? 'close every screen' : `${str(p, 'op') || 'open'} the screen "${str(p, 'screen')}"`),
    run(ctx, p) {
      const host = { runtime: ctx.runtime, assets: ctx.assets };
      switch (str(p, 'op')) {
        case 'close':
          return closeScreen(host, str(p, 'screen'));
        case 'toggle':
          return toggleScreen(host, str(p, 'screen'));
        case 'back':
          return backScreen(host);
        case 'closeAll':
          ctx.runtime.ui.stack = [];
          ctx.runtime.ui.modal = false;
          ctx.runtime.ui.blocking = false;
          return;
        default:
          if (!openScreen(host, str(p, 'screen'))) ctx.events.emit('problem', { text: `The screen "${str(p, 'screen')}" does not exist.` });
      }
    },
  },
  {
    id: 'loadGame',
    label: 'Load a saved game (continue)',
    category: 'Story',
    params: [{ key: 'slot', label: 'Save slot', type: 'text', default: 'autosave' }],
    describe: (p) => `load the saved game "${str(p, 'slot') || 'autosave'}"`,
    run: (ctx, p) => void ctx.events.emit('load-request', { slot: str(p, 'slot') || 'autosave' }),
  },
  {
    id: 'quitGame',
    label: 'Quit the game',
    category: 'Story',
    params: [],
    describe: () => 'quit the game',
    run: (ctx) => void ctx.events.emit('quit-request', {}),
  },
  {
    id: 'message',
    label: 'Show a message',
    category: 'Basics',
    params: [{ key: 'text', label: 'Text (use {variable} to show a value)', type: 'text', default: 'Hello!' }],
    describe: (p) => `show the message "${str(p, 'text')}"`,
    run: (ctx, p) => void ctx.events.emit('message', { text: fillValues(ctx.assets.strings.t(str(p, 'text')), { vars: ctx.runtime.vars, tables: ctx.assets.tables, world: ctx.world }) }),
  },
  {
    id: 'setVisible',
    label: 'Show or hide an object',
    category: 'Objects',
    params: [entityParam('who', 'Object', 'picked'), { key: 'visible', label: 'Make it', type: 'select', default: 'shown', options: [{ value: 'shown', label: 'visible' }, { value: 'hidden', label: 'hidden' }] }],
    describe: (p, n) => `${str(p, 'visible') === 'hidden' ? 'hide' : 'show'} ${describeRef(str(p, 'who'), n)}`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'who'), row.picked)) {
        const s = e.get<Sprite>(C.Sprite);
        if (s) s.visible = str(p, 'visible') !== 'hidden';
      }
    },
  },
  {
    id: 'setEnabled',
    label: 'Turn an object solid or non-solid',
    category: 'Objects',
    params: [entityParam('who', 'Object', 'picked'), { key: 'state', label: 'Make its collision', type: 'select', default: 'on', options: [{ value: 'on', label: 'active' }, { value: 'off', label: 'switched off' }] }],
    describe: (p, n) => `switch ${describeRef(str(p, 'who'), n)}'s collision ${str(p, 'state') === 'off' ? 'off' : 'on'}`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'who'), row.picked)) {
        const c = e.get<Collider>(C.Collider);
        if (c) c.enabled = str(p, 'state') !== 'off';
      }
    },
  },
  {
    id: 'setProperty',
    label: 'Change any setting of an object',
    category: 'Advanced',
    params: [entityParam('who', 'Object', 'picked'), { key: 'component', label: 'Part (e.g. sprite, transform)', type: 'text', default: 'sprite' }, { key: 'key', label: 'Setting', type: 'text', default: 'color' }, { key: 'value', label: 'New value', type: 'text', default: '' }],
    describe: (p, n) => `set ${describeRef(str(p, 'who'), n)}'s ${str(p, 'component')}.${str(p, 'key')} to ${str(p, 'value')}`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'who'), row.picked)) {
        const comp = e.get<Record<string, unknown>>(str(p, 'component'));
        if (comp && typeof comp === 'object' && str(p, 'key') in comp) comp[str(p, 'key')] = parseValue(str(p, 'value'));
      }
    },
  },
  {
    id: 'emit',
    label: 'Announce an event',
    category: 'Advanced',
    params: [{ key: 'name', label: 'Event name', type: 'text', default: 'my-event', extra: 'events' }],
    describe: (p) => `announce the event "${str(p, 'name')}"`,
    run: (ctx, p) => void ctx.events.emit(str(p, 'name'), {}),
  },
  {
    id: 'sound',
    label: 'Play a sound',
    category: 'Basics',
    params: [
      { key: 'name', label: 'Sound (a file in Assets -> Sounds)', type: 'sound', default: '' },
      { key: 'volume', label: 'Volume (0 to 1)', type: 'number', default: 1, min: 0, max: 1, step: 0.1 },
      entityParam('at', 'Heard from (optional: quieter and to one side when far from the player)', ''),
      { key: 'far', label: 'Farthest it can be heard (cells)', type: 'number', default: 16, min: 2, max: 80, step: 1 },
    ],
    describe: (p, n) => `play the sound "${str(p, 'name')}"${str(p, 'at') ? ` from ${describeRef(str(p, 'at'), n)}` : ''}`,
    run(ctx, p, row) {
      const name = str(p, 'name');
      ctx.events.emit('sound', { name });
      if (!name) return;
      const volume = p.volume === undefined ? 1 : num(p, 'volume');
      const source = str(p, 'at') ? resolveRef(ctx, str(p, 'at'), row.picked)[0]?.get<TransformIso>(C.Transform) : undefined;
      emitFx(ctx.runtime, { kind: 'sound', name, volume, ...(source ? { at: { x: source.x, y: source.y, near: 2, far: p.far === undefined ? 16 : num(p, 'far') } } : {}) });
    },
  },
  {
    id: 'music',
    label: 'Change the music',
    category: 'Basics',
    params: [{ key: 'name', label: 'Music (a file in Assets -> Sounds; empty = silence)', type: 'sound', default: '' }],
    describe: (p) => (str(p, 'name') ? `play the music "${str(p, 'name')}"` : 'fade the music out'),
    run: (ctx, p) => void emitFx(ctx.runtime, { kind: 'music', name: str(p, 'name') }),
  },
  {
    id: 'particles',
    label: 'Burst of sparks, dust or glow',
    category: 'Effects',
    params: [
      entityParam('at', 'Where', 'player'),
      { key: 'effect', label: 'Kind', type: 'select', default: 'spark', options: PARTICLE_PRESET_IDS.map((id) => ({ value: id, label: PARTICLE_PRESETS[id]!.label })) },
      { key: 'count', label: 'How many (0 = the usual amount)', type: 'number', default: 0, min: 0, max: 80, step: 1 },
    ],
    describe: (p, n) => `throw ${PARTICLE_PRESETS[str(p, 'effect')]?.label.toLowerCase() ?? str(p, 'effect')} at ${describeRef(str(p, 'at'), n)}`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'at'), row.picked)) {
        const t = e.get<TransformIso>(C.Transform);
        if (t) emitFx(ctx.runtime, { kind: 'burst', preset: str(p, 'effect'), x: t.x, y: t.y, h: t.h, ...(num(p, 'count') > 0 ? { count: num(p, 'count') } : {}) });
      }
    },
  },
  {
    id: 'shake',
    label: 'Shake the screen',
    category: 'Effects',
    params: [{ key: 'pixels', label: 'How hard (pixels)', type: 'number', default: 5, min: 0, max: 14, step: 0.5 }],
    describe: (p) => `shake the screen (${num(p, 'pixels')} pixels)`,
    run: (ctx, p) => void addImpact(ctx.runtime, num(p, 'pixels')),
  },
  {
    id: 'hitStop',
    label: 'Freeze the game for a moment',
    category: 'Effects',
    params: [{ key: 'seconds', label: 'Seconds (0.05 is a good hit)', type: 'number', default: 0.08, min: 0, max: 0.2, step: 0.01 }],
    describe: (p) => `freeze the game for ${num(p, 'seconds')} seconds`,
    run: (ctx, p) => void requestHitStop(ctx.runtime, Math.round(num(p, 'seconds') * 60)),
  },
];

const conditionDefs = new Map(CONDITIONS.map((c) => [c.id, c]));
const actionDefs = new Map(ACTIONS.map((a) => [a.id, a]));
/** Every block ever defined, whether its pack is on or not. */
const conditionShelf = new Map(conditionDefs);
const actionShelf = new Map(actionDefs);

export function registerCondition(def: ConditionDef): void {
  conditionShelf.set(def.id, def);
  if (!conditionDefs.has(def.id)) CONDITIONS.push(def);
  else CONDITIONS[CONDITIONS.findIndex((c) => c.id === def.id)] = def;
  conditionDefs.set(def.id, def);
}

export function registerAction(def: ActionDef): void {
  actionShelf.set(def.id, def);
  if (!actionDefs.has(def.id)) ACTIONS.push(def);
  else ACTIONS[ACTIONS.findIndex((a) => a.id === def.id)] = def;
  actionDefs.set(def.id, def);
}

export function unregisterCondition(id: string): void {
  conditionDefs.delete(id);
  const i = CONDITIONS.findIndex((c) => c.id === id);
  if (i >= 0) CONDITIONS.splice(i, 1);
}

export function unregisterAction(id: string): void {
  actionDefs.delete(id);
  const i = ACTIONS.findIndex((a) => a.id === id);
  if (i >= 0) ACTIONS.splice(i, 1);
}

export const shelvedCondition = (id: string): ConditionDef | undefined => conditionShelf.get(id);
export const shelvedAction = (id: string): ActionDef | undefined => actionShelf.get(id);

/** Take blocks out of the registry and hand them over (a pack installs them again when it is turned on). */
export function takeConditions(ids: readonly string[]): ConditionDef[] {
  const out = ids.map((id) => conditionDefs.get(id)).filter((d): d is ConditionDef => !!d);
  for (const id of ids) unregisterCondition(id);
  return out;
}

export function takeActions(ids: readonly string[]): ActionDef[] {
  const out = ids.map((id) => actionDefs.get(id)).filter((d): d is ActionDef => !!d);
  for (const id of ids) unregisterAction(id);
  return out;
}

export const conditionDef = (id: string): ConditionDef | undefined => conditionDefs.get(id);
export const actionDef = (id: string): ActionDef | undefined => actionDefs.get(id);

/** A new condition or action with its default parameters. */
export function newCondition(id: string): EventCondition {
  const def = conditionDefs.get(id);
  return { type: id, params: Object.fromEntries((def?.params ?? []).map((p) => [p.key, structuredClone(p.default)])), negate: false };
}

export function newAction(id: string): EventAction {
  const def = actionDefs.get(id);
  return { type: id, params: Object.fromEntries((def?.params ?? []).map((p) => [p.key, structuredClone(p.default)])) };
}

export function newRow(id: string): EventRow {
  return { id, enabled: true, comment: '', mode: 'all', once: false, forEach: '', breakpoint: false, repeat: 1, conditions: [newCondition('always')], actions: [], children: [] };
}

// ---------- plain English ----------

export function describeCondition(c: EventCondition, n?: Names): string {
  const def = conditionDefs.get(c.type);
  const text = def ? def.describe(c.params, n) : `(unknown condition "${c.type}")`;
  return c.negate ? `NOT ${text}` : text;
}

export function describeAction(a: EventAction, n?: Names): string {
  const def = actionDefs.get(a.type);
  return def ? def.describe(a.params, n) : `(unknown action "${a.type}")`;
}

/** "When A and B, then X and Y" as a sentence. */
export function describeRow(row: EventRow, n?: Names): string {
  const conds = row.conditions.filter((c) => c.type !== 'always' || row.conditions.length === 1);
  const joiner = row.mode === 'any' ? ' or ' : ' and ';
  const when = conds.length === 0 || (conds.length === 1 && conds[0]!.type === 'always') ? 'Always' : `When ${conds.map((c) => describeCondition(c, n)).join(joiner)}`;
  const acts = row.actions.length === 0 ? 'do nothing yet' : row.actions.map((a) => describeAction(a, n)).join(', then ');
  const loop = row.forEach ? `For each ${describeRef(row.forEach, n).replace('anything tagged ', 'thing tagged ')}: ` : '';
  const extras = [row.once ? 'only the moment it becomes true' : '', row.repeat > 1 ? `${row.repeat} times` : ''].filter(Boolean).join(', ');
  return `${loop}${when}, ${acts}${extras ? ` (${extras})` : ''}.`;
}

// ---------- running ----------

/**
 * Remember that a row, wire node or graph box just ran (the editor lights it up while the game plays) and, when it has a
 * breakpoint, announce "logic-break" so the editor can stop the game there.
 */
export function noteFired(ctx: SimContext, id: string, breakpoint: boolean, what: string): void {
  let fired = ctx.runtime.scratch.get('fired') as Map<string, number> | undefined;
  if (!fired) ctx.runtime.scratch.set('fired', (fired = new Map()));
  fired.set(id, ctx.tick);
  if (breakpoint) ctx.events.emit('logic-break', { id, text: what });
}

/** Do all (or any) of these conditions hold now? Used by the logic nodes and graph boxes that are not event rows. */
export function testConditionList(ctx: SimContext, conditions: readonly EventCondition[], mode: 'all' | 'any', picked?: Entity): boolean {
  return testRow(ctx, { conditions: conditions as EventCondition[], mode } as EventRow, picked);
}

/** Run actions in order, as an event row would. */
export function runActionList(ctx: SimContext, actions: readonly EventAction[], picked?: Entity): void {
  for (const a of actions) actionDefs.get(a.type)?.run(ctx, a.params, { picked });
}

function testRow(ctx: SimContext, row: EventRow, picked: Entity | undefined): boolean {
  if (row.conditions.length === 0) return true;
  const results = row.conditions.map((c) => {
    const def = conditionDefs.get(c.type);
    if (!def) return false;
    const r = def.test(ctx, c.params, { picked });
    return c.negate ? !r : r;
  });
  return row.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/** Variables that exist while a row loops over a table: row.id and row.<column>. */
export function withTableRow<T>(ctx: SimContext, tableName: string, rowIndex: number, run: () => T): T | undefined {
  const t = ctx.assets.tables.get(tableName);
  const r = t?.rows[rowIndex];
  if (!t || !r) return undefined;
  const set: string[] = [];
  const put = (k: string, v: VariableValue): void => {
    set.push(k);
    ctx.runtime.vars[k] = v;
  };
  put('row.id', r.id);
  for (const c of t.columns) put(`row.${c.id}`, (r[c.id] ?? '') as VariableValue);
  try {
    return run();
  } finally {
    for (const k of set) delete ctx.runtime.vars[k];
  }
}

/** Run rows as another piece of logic's own (a custom behaviour on one object): `scope` keeps their memory apart from the scene's. */
export function runEventRows(ctx: SimContext, rows: EventRow[], picked: Entity | undefined, scope: string): void {
  runRows(ctx, rows, picked, scope);
}

function runRows(ctx: SimContext, rows: EventRow[], picked: Entity | undefined, scope = ''): void {
  for (const row of rows) {
    if (!row.enabled) continue;
    if (row.forEach.startsWith('table:')) {
      // "for each row of a table": the row's cells are the variables row.id, row.<column>
      const name = row.forEach.slice(6);
      const count = ctx.assets.tables.get(name)?.rows.length ?? 0;
      for (let i = 0; i < count; i++) {
        withTableRow(ctx, name, i, () => {
          const st = (ctx.runtime.rowState[`${scope}${row.id}@row${i}`] ??= { prev: false, timer: 0 });
          const truth = testRow(ctx, row, picked);
          const fire = row.once ? truth && !st.prev : truth;
          st.prev = truth;
          if (fire) {
            noteFired(ctx, `${scope}${row.id}`, row.breakpoint, describeRow(row));
            for (let n = 0; n < Math.max(1, row.repeat); n++) for (const a of row.actions) actionDefs.get(a.type)?.run(ctx, a.params, { picked });
          }
          if (truth && row.children.length > 0) runRows(ctx, row.children, picked, scope);
        });
      }
      continue;
    }
    const subjects: (Entity | undefined)[] = row.forEach ? resolveRef(ctx, row.forEach, picked) : [picked];
    for (const subject of subjects) {
      const key = scope + (subject && row.forEach ? `${row.id}@${subject.id}` : row.id);
      const st = (ctx.runtime.rowState[key] ??= { prev: false, timer: 0 });
      const truth = testRow(ctx, row, subject);
      const fire = row.once ? truth && !st.prev : truth;
      st.prev = truth;
      if (fire) {
        noteFired(ctx, `${scope}${row.id}`, row.breakpoint, describeRow(row));
        for (let i = 0; i < Math.max(1, row.repeat); i++) {
          for (const a of row.actions) actionDefs.get(a.type)?.run(ctx, a.params, { picked: subject });
        }
      }
      if (truth && row.children.length > 0) runRows(ctx, row.children, subject, scope);
    }
  }
}

/** Runs the scene's event sheet top to bottom, once per tick. */
export function eventSheetSystem(ctx: SimContext): void {
  if (ctx.runtime.sheet.length > 0) runRows(ctx, ctx.runtime.sheet, undefined);
}

// ---------- checking ----------

export interface SheetFacts {
  /** Scene ids of placed objects. */
  entityIds: ReadonlySet<string>;
  tags: ReadonlySet<string>;
  variables: ReadonlySet<string>;
  prefabs: ReadonlySet<string>;
  /** Variables that conversations and cutscenes set (so a row may check them without setting them itself). */
  storyVariables?: ReadonlySet<string>;
  /** Names of the project's sound files; when given, sounds that do not exist are reported. */
  sounds?: ReadonlySet<string>;
  /** Names of the project's data tables. */
  tables?: ReadonlySet<string>;
}

/** Mistakes in a sheet that would stop a row from doing what it says, in plain English. */
export function checkSheet(rows: readonly EventRow[], facts: SheetFacts, names?: Names): { rowId: string; text: string }[] {
  const out: { rowId: string; text: string }[] = [];
  const assigned = new Set<string>();
  const walk = (list: readonly EventRow[]): void => {
    for (const r of list) {
      for (const a of r.actions) if (a.type === 'setVariable' && str(a.params, 'name')) assigned.add(str(a.params, 'name'));
      // paying and receiving resources (name:amount, ...) makes those variables
      for (const a of r.actions) if (a.type === 'earn' || a.type === 'spend') for (const part of (str(a.params, a.type === 'earn' ? 'gains' : 'costs') || '').split(',')) if (part.split(':')[0]!.trim()) assigned.add(part.split(':')[0]!.trim());
      for (const a of r.actions) if (a.type === 'pickup') continue;
      walk(r.children);
    }
  };
  walk(rows);
  const refOk = (ref: string, where: string, rowId: string, allowPicked: boolean): void => {
    if (!ref) return;
    if (ref === 'picked') {
      if (!allowPicked) out.push({ rowId, text: `${where}: "the picked object" only works inside a "for each" row.` });
      return;
    }
    if (ref === 'player') return;
    const [kind, ...rest] = ref.split(':');
    const v = rest.join(':');
    if (kind === 'table') {
      if (facts.tables && !facts.tables.has(v)) out.push({ rowId, text: `${where}: there is no data table called "${v}".` });
      return;
    }
    if (kind === 'id' && !facts.entityIds.has(v)) out.push({ rowId, text: `${where}: the object ${describeRef(ref, names)} no longer exists.` });
    else if (kind === 'tag' && !facts.tags.has(v)) out.push({ rowId, text: `${where}: no object has the tag "${v}".` });
  };
  const check = (list: readonly EventRow[], inLoop: boolean): void => {
    for (const r of list) {
      const loop = inLoop || r.forEach !== '';
      if (r.forEach) refOk(r.forEach, 'The loop', r.id, inLoop);
      for (const c of r.conditions) {
        const def = conditionDefs.get(c.type);
        if (!def) {
          out.push({ rowId: r.id, text: `A condition of type "${c.type}" is not known to this version of Tilewright.` });
          continue;
        }
        for (const p of def.params) {
          if (p.type === 'entity') refOk(str(c.params, p.key), `"${def.label}"`, r.id, loop);
          // names with a dot (wave.state, turn.round, time.day, a table cell) belong to the engine or to a table, not to the scene
          if (p.type === 'variable' && c.type === 'variable' && str(c.params, p.key) && !str(c.params, p.key).includes('.') && !facts.variables.has(str(c.params, p.key)) && !assigned.has(str(c.params, p.key)) && !(facts.storyVariables?.has(str(c.params, p.key)) ?? false)) {
            out.push({ rowId: r.id, text: `The variable "${str(c.params, p.key)}" is checked but never set anywhere, so it is always 0.` });
          }
        }
      }
      for (const a of r.actions) {
        const def = actionDefs.get(a.type);
        if (!def) {
          out.push({ rowId: r.id, text: `An action of type "${a.type}" is not known to this version of Tilewright.` });
          continue;
        }
        for (const p of def.params) {
          if (p.type === 'entity') refOk(str(a.params, p.key), `"${def.label}"`, r.id, loop);
          if (p.type === 'prefab' && str(a.params, p.key) && !facts.prefabs.has(str(a.params, p.key))) out.push({ rowId: r.id, text: `The prefab "${str(a.params, p.key)}" does not exist.` });
          if (p.type === 'sound' && str(a.params, p.key) && facts.sounds && !facts.sounds.has(str(a.params, p.key))) out.push({ rowId: r.id, text: `The sound "${str(a.params, p.key)}" is not in Assets -> Sounds, so nothing will play.` });
        }
        if (a.type === 'setVariable' && !str(a.params, 'name')) out.push({ rowId: r.id, text: 'An action changes a variable but no variable is chosen.' });
        if (a.type === 'spawn' && !str(a.params, 'prefab')) out.push({ rowId: r.id, text: 'An action creates an object but no prefab is chosen.' });
      }
      check(r.children, loop);
    }
  };
  check(rows, false);
  return out;
}
