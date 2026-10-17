import {
  PARTICLE_PRESETS,
  PARTICLE_PRESET_IDS,
  addImpact,
  addItem,
  autoSlot,
  emitFx,
  requestHitStop,
  itemCount,
  C,
  expandEntities,
  teleportBody,
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
import { input, output, setOutput } from '../signals';
import { damage, heal, healthOf } from '../builtins/combat';
import { beginDialogue, playCutscene } from '../story/director';

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
  if (ref === 'picked') return picked && picked.alive ? [picked] : [];
  if (ref === 'player') return ctx.world.withTag('player');
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
  if (ref === 'player') return 'the player';
  const [kind, ...rest] = ref.split(':');
  const value = rest.join(':');
  if (kind === 'id') return `"${names?.entity(value) ?? value}"`;
  if (kind === 'tag') return `anything tagged "${value}"`;
  if (kind === 'name') return `"${value}"`;
  return ref;
}

// ---------- parameters ----------

export type ParamType = 'number' | 'text' | 'boolean' | 'select' | 'entity' | 'variable' | 'signal' | 'prefab' | 'action' | 'sound';

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
}

const COMPARISONS = [
  { value: '=', label: 'is' },
  { value: '!=', label: 'is not' },
  { value: '>', label: 'is more than' },
  { value: '>=', label: 'is at least' },
  { value: '<', label: 'is less than' },
  { value: '<=', label: 'is at most' },
];

const num = (p: Record<string, unknown>, k: string, d = 0): number => (typeof p[k] === 'number' ? (p[k] as number) : Number(p[k] ?? d) || d);
const str = (p: Record<string, unknown>, k: string): string => String(p[k] ?? '');

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

const entityParam = (key: string, label: string, def = 'player'): ParamSpec => ({ key, label, type: 'entity', default: def });

export const CONDITIONS: ConditionDef[] = [
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
    id: 'every',
    label: 'Every few seconds',
    category: 'Basics',
    params: [{ key: 'seconds', label: 'Seconds', type: 'number', default: 2, min: 0.1, step: 0.1 }],
    describe: (p) => `every ${num(p, 'seconds', 2)} seconds`,
    test: (ctx, p) => ctx.tick > 0 && ctx.tick % Math.max(1, Math.round(num(p, 'seconds', 2) * 60)) === 0,
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
      const raw = str(p, 'value');
      const b: VariableValue = raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw;
      return compare(ctx.runtime.vars[str(p, 'name')], str(p, 'op'), b);
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
    id: 'health',
    label: "An object's health compares",
    category: 'Objects',
    params: [entityParam('who', 'Object', 'player'), { key: 'op', label: 'Is', type: 'select', default: '<=', options: COMPARISONS }, { key: 'value', label: 'Hit points', type: 'number', default: 1, step: 1 }],
    describe: (p, n) => `${describeRef(str(p, 'who'), n)} has ${COMPARISONS.find((c) => c.value === str(p, 'op'))?.label ?? str(p, 'op')} ${num(p, 'value', 1)} hit points`,
    test: (ctx, p, row) =>
      resolveRef(ctx, str(p, 'who'), row.picked).some((e) => {
        const h = healthOf(e);
        return !!h && compare(h.hp, str(p, 'op'), num(p, 'value', 1));
      }),
  },  {
    id: 'hasItem',
    label: 'The player carries an item',
    category: 'Story',
    params: [{ key: 'item', label: 'Item (id)', type: 'text', default: '' }, { key: 'atLeast', label: 'At least how many', type: 'number', default: 1, min: 1, step: 1 }],
    describe: (p) => `the player has at least ${num(p, 'atLeast', 1)} of "${str(p, 'item') || '(item)'}"`,
    test: (ctx, p) => itemCount(ctx.runtime.vars, str(p, 'item')) >= num(p, 'atLeast', 1),
  },  {
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
          { value: 'boss-phase', label: 'a boss enters a new phase' },
          { value: 'boss-defeated', label: 'a boss is defeated' },
          { value: 'echo-made', label: 'an echo is recorded' },
          { value: 'sentence-changed', label: 'a sentence stone changes its word' },
          { value: 'text-formatted', label: 'a text block is reformatted' },
          { value: 'dialogue-started', label: 'a conversation starts' },
          { value: 'dialogue-ended', label: 'a conversation ends' },
          { value: 'cutscene-started', label: 'a cutscene starts' },
          { value: 'cutscene-ended', label: 'a cutscene ends' },
          { value: 'lantern-lit', label: 'a lantern is lit' },
          { value: 'rested', label: 'the player rests at a lantern' },
          { value: 'item-given', label: 'the player receives an item' },
          { value: 'portal', label: 'the player walks through a portal' },
        ],
      },
    ],
    describe: (p) => (COND_EVENT_TEXT[str(p, 'name')] ?? `"${str(p, 'name')}" happens`),
    test: (ctx, p) => ctx.events.of(str(p, 'name')).length > 0,
  },
];

const COND_EVENT_TEXT: Record<string, string> = {
  pickup: 'something is picked up',
  pushed: 'a crate is pushed',
  landed: 'something lands',
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
  'boss-phase': 'a boss enters a new phase',
  'boss-defeated': 'a boss is defeated',
  'echo-made': 'an echo is recorded',
  'sentence-changed': 'a sentence stone changes its word',
  'text-formatted': 'a text block is reformatted',
  'dialogue-started': 'a conversation starts',
  'dialogue-ended': 'a conversation ends',
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
      const v = parseValue(str(p, 'value'));
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
    id: 'damage',
    label: 'Hurt an object',
    category: 'Combat',
    params: [entityParam('who', 'Object', 'player'), { key: 'amount', label: 'Damage', type: 'number', default: 1, min: 0, step: 1 }],
    describe: (p, n) => `hurt ${describeRef(str(p, 'who'), n)} for ${num(p, 'amount', 1)}`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'who'), row.picked)) damage(ctx, e, num(p, 'amount', 1), { ignoreIframes: true });
    },
  },
  {
    id: 'heal',
    label: 'Heal an object',
    category: 'Combat',
    params: [entityParam('who', 'Object', 'player'), { key: 'amount', label: 'Hit points', type: 'number', default: 1, min: 0, step: 1 }],
    describe: (p, n) => `heal ${describeRef(str(p, 'who'), n)} by ${num(p, 'amount', 1)}`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'who'), row.picked)) heal(ctx, e, num(p, 'amount', 1));
    },
  },  {
    id: 'giveItem',
    label: 'Give the player an item',
    category: 'Story',
    params: [{ key: 'item', label: 'Item (id)', type: 'text', default: '' }, { key: 'amount', label: 'How many', type: 'number', default: 1, min: 1, step: 1 }],
    describe: (p) => `give the player ${num(p, 'amount', 1)} of "${str(p, 'item') || '(item)'}"`,
    run(ctx, p) {
      const got = addItem(ctx.runtime.vars, str(p, 'item'), num(p, 'amount', 1), ctx.assets.items.get(str(p, 'item')));
      if (got > 0) autoSlot(ctx.runtime.vars, str(p, 'item'));
      ctx.events.emit('item-given', { item: str(p, 'item'), amount: got });
    },
  },
  {
    id: 'takeItem',
    label: 'Take an item from the player',
    category: 'Story',
    params: [{ key: 'item', label: 'Item (id)', type: 'text', default: '' }, { key: 'amount', label: 'How many', type: 'number', default: 1, min: 1, step: 1 }],
    describe: (p) => `take ${num(p, 'amount', 1)} of "${str(p, 'item') || '(item)'}" from the player`,
    run(ctx, p) {
      addItem(ctx.runtime.vars, str(p, 'item'), -num(p, 'amount', 1));
      ctx.events.emit('item-taken', { item: str(p, 'item') });
    },
  },
  {
    id: 'startDialogue',
    label: 'Start a conversation',
    category: 'Story',
    params: [{ key: 'dialogue', label: 'Dialogue (name)', type: 'text', default: '' }],
    describe: (p) => `start the conversation "${str(p, 'dialogue') || '(dialogue)'}"`,
    run: (ctx, p) => void beginDialogue(ctx, str(p, 'dialogue')),
  },
  {
    id: 'playCutscene',
    label: 'Play a cutscene',
    category: 'Story',
    params: [{ key: 'cutscene', label: 'Cutscene (name)', type: 'text', default: '' }],
    describe: (p) => `play the cutscene "${str(p, 'cutscene') || '(cutscene)'}"`,
    run: (ctx, p) => void playCutscene(ctx, str(p, 'cutscene')),
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
  },  {
    id: 'message',
    label: 'Show a message',
    category: 'Basics',
    params: [{ key: 'text', label: 'Text (use {variable} to show a value)', type: 'text', default: 'Hello!' }],
    describe: (p) => `show the message "${str(p, 'text')}"`,
    run: (ctx, p) => void ctx.events.emit('message', { text: interpolate(ctx.assets.strings.t(str(p, 'text')), ctx.runtime.vars) }),
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
    params: [{ key: 'name', label: 'Event name', type: 'text', default: 'my-event' }],
    describe: (p) => `announce the event "${str(p, 'name')}"`,
    run: (ctx, p) => void ctx.events.emit(str(p, 'name'), {}),
  },
  {
    id: 'sound',
    label: 'Play a sound',
    category: 'Basics',
    params: [{ key: 'name', label: 'Sound (a file in Assets -> Sounds)', type: 'sound', default: '' }, { key: 'volume', label: 'Volume (0 to 1)', type: 'number', default: 1, min: 0, max: 1, step: 0.1 }],
    describe: (p) => `play the sound "${str(p, 'name')}"`,
    run(ctx, p) {
      const name = str(p, 'name');
      ctx.events.emit('sound', { name });
      if (name) emitFx(ctx.runtime, { kind: 'sound', name, volume: p.volume === undefined ? 1 : num(p, 'volume') });
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
  return { id, enabled: true, comment: '', mode: 'all', once: false, forEach: '', repeat: 1, conditions: [newCondition('always')], actions: [], children: [] };
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

function runRows(ctx: SimContext, rows: EventRow[], picked: Entity | undefined): void {
  for (const row of rows) {
    if (!row.enabled) continue;
    const subjects: (Entity | undefined)[] = row.forEach ? resolveRef(ctx, row.forEach, picked) : [picked];
    for (const subject of subjects) {
      const key = subject && row.forEach ? `${row.id}@${subject.id}` : row.id;
      const st = (ctx.runtime.rowState[key] ??= { prev: false, timer: 0 });
      const truth = testRow(ctx, row, subject);
      const fire = row.once ? truth && !st.prev : truth;
      st.prev = truth;
      if (fire) {
        for (let i = 0; i < Math.max(1, row.repeat); i++) {
          for (const a of row.actions) actionDefs.get(a.type)?.run(ctx, a.params, { picked: subject });
        }
      }
      if (truth && row.children.length > 0) runRows(ctx, row.children, subject);
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
}

/** Mistakes in a sheet that would stop a row from doing what it says, in plain English. */
export function checkSheet(rows: readonly EventRow[], facts: SheetFacts, names?: Names): { rowId: string; text: string }[] {
  const out: { rowId: string; text: string }[] = [];
  const assigned = new Set<string>();
  const walk = (list: readonly EventRow[]): void => {
    for (const r of list) {
      for (const a of r.actions) if (a.type === 'setVariable' && str(a.params, 'name')) assigned.add(str(a.params, 'name'));
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
          if (p.type === 'variable' && c.type === 'variable' && str(c.params, p.key) && !facts.variables.has(str(c.params, p.key)) && !assigned.has(str(c.params, p.key)) && !(facts.storyVariables?.has(str(c.params, p.key)) ?? false)) {
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
