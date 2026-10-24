import {
  C,
  surfaceAt,
  type Body,
  type Collider,
  type Entity,
  type SimContext,
  type Sprite,
  type TransformIso,
  evalValue,
  resolveValue,
} from '@tilewright/runtime';
import { ghostLayerMask, matchesWho, WHO_OPTIONS, type Who } from './filters';
import { defineBehavior, stateOf } from '../framework';
import { compare } from '../events/sheet';
import { input, output, setOutput } from '../signals';

const collider = (e: Entity): Collider | undefined => e.get<Collider>(C.Collider);
const sprite = (e: Entity): Sprite | undefined => e.get<Sprite>(C.Sprite);
const transform = (e: Entity): TransformIso => e.require<TransformIso>(C.Transform);

/** Live occupants of a trigger area, filtered by who counts. */
export function occupants(ctx: SimContext, e: Entity, who: Who): Entity[] {
  const c = collider(e);
  if (!c) return [];
  const out: Entity[] = [];
  for (const id of c.inside) {
    const o = ctx.world.get(id);
    if (o && matchesWho(o, who)) out.push(o);
  }
  return out;
}

// ---------- pressure plate ----------

export interface PressurePlate {
  activatedBy: Who;
  /** Stays down once pressed. */
  latch: boolean;
  /** How many things must stand on it. */
  needs: number;
  /** Height of the plate's top when pressed (0 = flush with the floor). */
  pressedHeight: number;
}

export const pressurePlate = defineBehavior<PressurePlate>({
  id: 'pressurePlate',
  name: 'Pressure Plate',
  category: 'Puzzle',
  description: 'Sends a signal while something stands on it (or for good once pressed, if it latches). Wire it to a gate, a spawner or a logic node.',
  phase: 'source',
  defaults: { activatedBy: 'anyone', latch: false, needs: 1, pressedHeight: 0.05 },
  fields: [
    { key: 'activatedBy', label: 'Pressed by', type: 'select', options: WHO_OPTIONS },
    { key: 'needs', label: 'How many are needed', type: 'number', min: 1, max: 8, step: 1 },
    { key: 'latch', label: 'Stays down once pressed', type: 'boolean' },
    { key: 'pressedHeight', label: 'Height when pressed', type: 'number', min: 0, max: 1, step: 0.05 },
  ],
  inputs: [],
  outputs: [{ name: 'active', label: 'Pressed', help: 'On while the plate is down.' }],
  requires: { collider: { w: 0.9, d: 0.9, height: 0.4, solid: false, trigger: true, layer: 1, mask: 65535, enabled: true, inside: [] } },
  summary: (s) => `Turns on when ${s.needs > 1 ? `${s.needs} things stand` : s.activatedBy === 'anyone' ? 'anything stands' : `${s.activatedBy === 'player' ? 'the player stands' : s.activatedBy + ' stand'}`} on it${s.latch ? ' and stays on' : ''}.`,
  update(ctx, e, s) {
    const st = stateOf(e, 'pressurePlate', () => ({ latched: false, baseHeight: sprite(e)?.height ?? 0.3 }));
    const pressed = occupants(ctx, e, s.activatedBy).length >= Math.max(1, s.needs);
    if (pressed && s.latch) st.latched = true;
    const active = pressed || st.latched;
    setOutput(e, 'active', active);
    const sp = sprite(e);
    if (sp) sp.height = active ? Math.min(st.baseHeight, s.pressedHeight) : st.baseHeight;
  },
});

// ---------- trigger zone ----------

export interface TriggerZone {
  who: Who;
}

export const triggerZone = defineBehavior<TriggerZone>({
  id: 'triggerZone',
  name: 'Trigger Zone',
  category: 'Puzzle',
  description: 'An invisible area that sends a signal while something is inside it. Use it with wires or event sheets ("when the player is inside...").',
  phase: 'source',
  defaults: { who: 'player' },
  fields: [{ key: 'who', label: 'Counts', type: 'select', options: WHO_OPTIONS }],
  inputs: [],
  outputs: [{ name: 'occupied', label: 'Someone is inside' }],
  requires: { collider: { w: 2, d: 2, height: 2, solid: false, trigger: true, layer: 1, mask: 65535, enabled: true, inside: [] } },
  update(ctx, e, s) {
    setOutput(e, 'occupied', occupants(ctx, e, s.who).length > 0);
  },
});

// ---------- lever ----------

export interface Lever {
  reach: number;
  /** Springs back when you let go of interact. */
  momentary: boolean;
  startOn: boolean;
}

export const lever = defineBehavior<Lever>({
  id: 'lever',
  name: 'Lever',
  category: 'Puzzle',
  description: 'The player flips it with the interact button when standing close. Sends a signal while it is on.',
  phase: 'source',
  defaults: { reach: 1.3, momentary: false, startOn: false },
  fields: [
    { key: 'reach', label: 'How close the player must be', type: 'number', min: 0.5, max: 4, step: 0.1 },
    { key: 'momentary', label: 'Only on while held', type: 'boolean' },
    { key: 'startOn', label: 'Starts on', type: 'boolean' },
  ],
  inputs: [],
  outputs: [{ name: 'on', label: 'On' }],
  requires: {},
  update(ctx, e, s) {
    const st = stateOf(e, 'lever', () => ({ on: s.startOn }));
    const t = transform(e);
    let near = false;
    for (const p of ctx.world.withTag('player')) {
      const pt = p.get<TransformIso>(C.Transform);
      if (pt && Math.hypot(pt.x - t.x, pt.y - t.y) <= s.reach && Math.abs(pt.h - t.h) < 1.5) near = true;
    }
    if (s.momentary) st.on = near && ctx.input.down('interact');
    else if (near && ctx.input.pressed('interact')) st.on = !st.on;
    setOutput(e, 'on', st.on);
    const sp = sprite(e);
    if (sp) sp.color = st.on ? 0x6fe08a : 0xe0866f;
  },
});

// ---------- timer ----------

export interface Timer {
  seconds: number;
  /** Starts by itself when the game starts. */
  autoStart: boolean;
  /** Starts again each time it finishes. */
  loop: boolean;
}

export const timer = defineBehavior<Timer>({
  id: 'timer',
  name: 'Timer',
  category: 'Puzzle',
  description: 'Counts down after its start signal arrives. On while counting; sends a short "done" pulse at the end.',
  phase: 'source',
  defaults: { seconds: 3, autoStart: false, loop: false },
  fields: [
    { key: 'seconds', label: 'Seconds', type: 'number', min: 0.1, max: 600, step: 0.1 },
    { key: 'autoStart', label: 'Start when the game starts', type: 'boolean' },
    { key: 'loop', label: 'Repeat', type: 'boolean' },
  ],
  inputs: [{ name: 'start', label: 'Start', help: 'A rising signal starts (or restarts) the countdown.' }],
  outputs: [
    { name: 'running', label: 'Counting down' },
    { name: 'done', label: 'Finished (one tick)' },
  ],
  requires: {},
  update(ctx, e, s) {
    const st = stateOf(e, 'timer', () => ({ left: s.autoStart ? s.seconds : 0, prev: false }));
    const start = input(e, 'start');
    if (start && !st.prev) st.left = s.seconds;
    st.prev = start;
    let done = false;
    if (st.left > 0) {
      st.left = Math.max(0, st.left - ctx.dt);
      if (st.left === 0) {
        done = true;
        if (s.loop) st.left = s.seconds;
      }
    }
    setOutput(e, 'running', st.left > 0);
    setOutput(e, 'done', done);
  },
});

// ---------- logic node ----------

export type LogicKind = 'and' | 'or' | 'not' | 'xor' | 'nand' | 'nor' | 'latch' | 'toggle' | 'delay' | 'pulse' | 'counter' | 'random' | 'compare';

export interface Logic {
  kind: LogicKind;
  /** Seconds, for delay and pulse. */
  seconds: number;
  /** Counter: turns on when In has turned on this many times. */
  count: number;
  /** Random: the chance (0-100) that each time In turns on, Out turns on. */
  chance: number;
  /** Compare: Out is on while this variable compares true against the value. */
  variable: string;
  op: string;
  value: string;
}

export const logic = defineBehavior<Logic>({
  id: 'logic',
  name: 'Logic Gate',
  category: 'Logic',
  description: 'Combines signals: AND, OR, NOT, XOR, a latch that remembers, a toggle, a delay, a timed pulse, a counter, a random chance or a variable check. Place it in the world and wire things into it.',
  phase: 'logic',
  defaults: { kind: 'and', seconds: 1, count: 3, chance: 50, variable: '', op: '>=', value: '1' },
  fields: [
    {
      key: 'kind',
      label: 'Kind',
      type: 'select',
      options: [
        { value: 'and', label: 'AND: on when all inputs are on' },
        { value: 'or', label: 'OR: on when any input is on' },
        { value: 'not', label: 'NOT: on when the input is off' },
        { value: 'xor', label: 'XOR: on when exactly one is on' },
        { value: 'nand', label: 'NAND: off only when all are on' },
        { value: 'nor', label: 'NOR: on only when all are off' },
        { value: 'latch', label: 'Latch: Set turns on, Reset turns off' },
        { value: 'toggle', label: 'Toggle: flips each time the input turns on' },
        { value: 'delay', label: 'Delay: repeats the input later' },
        { value: 'pulse', label: 'Pulse: on for a while when the input turns on' },
        { value: 'counter', label: 'Counter: on once In has turned on a number of times (Reset starts again)' },
        { value: 'random', label: 'Random: each time In turns on, Out is on by chance' },
        { value: 'compare', label: 'Compare: on while a variable compares true' },
      ],
    },
    { key: 'seconds', label: 'Seconds', type: 'number', min: 0, max: 600, step: 0.1, showWhen: { key: 'kind', is: ['delay', 'pulse'] } },
    { key: 'count', label: 'How many times', type: 'number', min: 1, max: 9999, step: 1, showWhen: { key: 'kind', is: ['counter'] } },
    { key: 'chance', label: 'Chance (%)', type: 'number', min: 0, max: 100, step: 5, showWhen: { key: 'kind', is: ['random'] } },
    { key: 'variable', label: 'Variable', type: 'text', showWhen: { key: 'kind', is: ['compare'] } },
    {
      key: 'op',
      label: 'It must be',
      type: 'select',
      options: [{ value: '=', label: 'equal to' }, { value: '!=', label: 'not equal to' }, { value: '>', label: 'more than' }, { value: '>=', label: 'at least' }, { value: '<', label: 'less than' }, { value: '<=', label: 'at most' }],
      showWhen: { key: 'kind', is: ['compare'] },
    },
    { key: 'value', label: 'Value', type: 'text', showWhen: { key: 'kind', is: ['compare'] } },
  ],
  inputs: [
    { name: 'a', label: 'A' },
    { name: 'b', label: 'B' },
    { name: 'in', label: 'In (for NOT, toggle, delay, pulse)' },
    { name: 'set', label: 'Set (latch)' },
    { name: 'reset', label: 'Reset (latch)' },
  ],
  outputs: [{ name: 'out', label: 'Out' }],
  requires: {},
  summary: (s) => ({ and: 'On when A and B are both on.', or: 'On when A or B is on.', not: 'On when In is off.', xor: 'On when exactly one of A and B is on.', nand: 'Off only when A and B are both on.', nor: 'On only when A and B are both off.', latch: 'Set turns it on and keeps it on until Reset.', toggle: 'Flips each time In turns on.', delay: `Repeats In after ${s.seconds} s.`, pulse: `On for ${s.seconds} s each time In turns on.`, counter: `On after In has turned on ${s.count} times; Reset starts again.`, random: `Each time In turns on, Out is on with a ${s.chance}% chance.`, compare: `On while ${s.variable || '(a variable)'} ${s.op} ${s.value}.` })[s.kind],
  update(ctx, e, s) {
    // Logic nodes run several times per tick while signals settle, so time and edges advance only once per tick.
    const st = stateOf(e, 'logic', () => ({ tick: -1, prevAtStart: {} as Record<string, boolean>, cur: {} as Record<string, boolean>, value: false, fired: -1, timeLeft: 0, queue: [] as { at: number; v: boolean }[], n: 0 }));
    const first = st.tick !== ctx.tick;
    if (first) {
      st.tick = ctx.tick;
      st.prevAtStart = { ...st.cur };
    }
    const a = input(e, 'a');
    const b = input(e, 'b');
    const x = input(e, 'in');
    st.cur = { a, b, in: x, set: input(e, 'set'), reset: input(e, 'reset') };
    const rising = (name: string): boolean => st.cur[name] === true && !st.prevAtStart[name];
    let out = output(e, 'out');
    switch (s.kind) {
      case 'and':
        out = a && b;
        break;
      case 'or':
        out = a || b;
        break;
      case 'not':
        out = !x;
        break;
      case 'xor':
        out = a !== b;
        break;
      case 'nand':
        out = !(a && b);
        break;
      case 'nor':
        out = !(a || b);
        break;
      case 'latch':
        if (st.cur.reset) st.value = false;
        else if (st.cur.set) st.value = true;
        out = st.value;
        break;
      case 'toggle':
        if (rising('in') && st.fired !== ctx.tick) {
          st.value = !st.value;
          st.fired = ctx.tick;
        }
        out = st.value;
        break;
      case 'pulse':
        if (first) st.timeLeft = Math.max(0, st.timeLeft - ctx.dt);
        if (rising('in') && st.fired !== ctx.tick) {
          st.timeLeft = s.seconds;
          st.fired = ctx.tick;
        }
        out = st.timeLeft > 0;
        break;
      case 'counter':
        if (st.cur.reset) st.n = 0;
        else if (rising('in') && st.fired !== ctx.tick) {
          st.n++;
          st.fired = ctx.tick;
        }
        out = st.n >= s.count;
        break;
      case 'random':
        if (rising('in') && st.fired !== ctx.tick) {
          st.value = ctx.rng.next() * 100 < s.chance;
          st.fired = ctx.tick;
        }
        out = st.value;
        break;
      case 'compare': {
        const src = { vars: ctx.runtime.vars, tables: ctx.assets.tables, world: ctx.world };
        out = s.variable !== '' && compare(resolveValue(src, s.variable), s.op, evalValue(src, s.value));
        break;
      }
      case 'delay': {
        const now = ctx.tick;
        if (first) {
          const last = st.queue.at(-1);
          if (!last || last.v !== x) st.queue.push({ at: now + Math.round(s.seconds / ctx.dt), v: x });
          while (st.queue.length > 1 && st.queue[1]!.at <= now) st.queue.shift();
          const head = st.queue[0];
          if (head && head.at <= now) st.value = head.v;
        }
        out = st.value;
        break;
      }
    }
    setOutput(e, 'out', out);
  },
});

// ---------- gate / door ----------

export interface Gate {
  /** Opens when the input is OFF instead of ON. */
  invert: boolean;
  /** Seconds to open or close. */
  speed: number;
  /** Height when closed. */
  closedHeight: number;
  /** Ghosts (recorded copies, spirits) can walk through even when it is closed. */
  ghostsPass: boolean;
}

export const gate = defineBehavior<Gate>({
  id: 'gate',
  name: 'Gate / Door',
  category: 'Puzzle',
  description: 'A solid barrier that slides open while its Open signal is on (or off, if inverted).',
  phase: 'actuator',
  defaults: { invert: false, speed: 0.6, closedHeight: 1.6, ghostsPass: false },
  fields: [
    { key: 'invert', label: 'Open when the signal is OFF', type: 'boolean' },
    { key: 'speed', label: 'Seconds to open', type: 'number', min: 0, max: 10, step: 0.1 },
    { key: 'closedHeight', label: 'Height when closed', type: 'number', min: 0.2, max: 6, step: 0.1 },
    { key: 'ghostsPass', label: 'Ghosts can pass through', type: 'boolean' },
  ],
  inputs: [{ name: 'open', label: 'Open' }],
  outputs: [{ name: 'isOpen', label: 'Fully open' }],
  requires: { collider: { w: 1, d: 1, height: 1.6, solid: true, trigger: false, layer: 1, mask: 65535, enabled: true, inside: [] } },
  summary: (s) => `Opens when its Open signal is ${s.invert ? 'off' : 'on'}, in ${s.speed} s.`,
  update(ctx, e, s) {
    const st = stateOf(e, 'gate', () => ({ open: 0 }));
    const want = input(e, 'open') !== s.invert ? 1 : 0;
    const step = s.speed <= 0 ? 1 : ctx.dt / s.speed;
    st.open = want > st.open ? Math.min(want, st.open + step) : Math.max(want, st.open - step);
    const height = s.closedHeight + (0.05 - s.closedHeight) * st.open;
    const c = collider(e);
    if (c) {
      c.height = Math.max(0.05, height);
      c.enabled = st.open < 0.85;
      // ghosts are allowed through by dropping their layers from this collider's mask
      const ghosts = ghostLayerMask();
      c.mask = s.ghostsPass ? c.mask & ~ghosts : c.mask | ghosts;
    }
    const sp = sprite(e);
    if (sp) sp.height = Math.max(0.05, height);
    setOutput(e, 'isOpen', st.open >= 1);
  },
});

// ---------- pushable ----------

export interface Pushable {
  /** Cells per second while sliding. */
  slideSpeed: number;
}

/** Can a pushable crate at (x, y, z) occupy this spot? (floor, no wall, nothing solid or alive in the way) */
export function spotIsFree(ctx: SimContext, self: Entity, x: number, y: number, z: number, w: number, d: number): boolean {
  const map = ctx.map;
  if (!map) return false;
  for (const [cx, cy] of [[x - w / 2 + 0.05, y - d / 2 + 0.05], [x + w / 2 - 0.05, y - d / 2 + 0.05], [x - w / 2 + 0.05, y + d / 2 - 0.05], [x + w / 2 - 0.05, y + d / 2 - 0.05]] as const) {
    const s = surfaceAt(map, cx, cy, z, { stepUp: 0.35, bodyHeight: 1 });
    if (s.kind !== 'ground' && s.kind !== 'deck') return false;
    if (Math.abs(s.z - z) > 0.35) return false;
  }
  for (const o of ctx.world.query(C.Transform, C.Collider)) {
    if (o === self) continue;
    const oc = collider(o)!;
    if (!oc.solid || !oc.enabled) continue;
    const ot = transform(o);
    if (Math.abs(x - ot.x) < (w + oc.w) / 2 - 0.01 && Math.abs(y - ot.y) < (d + oc.d) / 2 - 0.01 && z < ot.h + oc.height - 0.05 && z + 1 > ot.h + 0.05) return false;
  }
  for (const o of ctx.world.query(C.Transform, C.Body)) {
    if (o === self) continue;
    const ot = transform(o);
    const ob = o.require<Body>(C.Body);
    if (Math.abs(x - ot.x) < w / 2 + ob.radius && Math.abs(y - ot.y) < d / 2 + ob.radius && Math.abs(ot.h - z) < 1) return false;
  }
  return true;
}

export const pushable = defineBehavior<Pushable>({
  id: 'pushable',
  name: 'Pushable',
  category: 'Puzzle',
  description: 'Slides one cell when the player walks into it, as long as the cell beyond is free floor.',
  phase: 'control',
  defaults: { slideSpeed: 6 },
  fields: [{ key: 'slideSpeed', label: 'Slide speed (cells per second)', type: 'number', min: 1, max: 20, step: 0.5 }],
  inputs: [],
  outputs: [],
  requires: { collider: { w: 0.9, d: 0.9, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } },
  update(ctx, e, s) {
    pushStep(ctx, e, stateOf<PushState>(e, 'pushable', () => ({ target: null, dx: 0, dy: 0 })), s.slideSpeed, false);
  },
});

export interface PushState {
  target: { x: number; y: number } | null;
  dx: number;
  dy: number;
}

/**
 * One tick of "slides one cell when walked into". With `slide`, it keeps going in the same direction
 * (like on ice) until the next cell is not free.
 */
export function pushStep(ctx: SimContext, e: Entity, st: PushState, slideSpeed: number, slide: boolean): void {
  const t = transform(e);
  const c = collider(e)!;
  if (st.target) {
    const dx = st.target.x - t.x;
    const dy = st.target.y - t.y;
    const dist = Math.hypot(dx, dy);
    const step = slideSpeed * ctx.dt;
    if (dist <= step) {
      t.x = st.target.x;
      t.y = st.target.y;
      st.target = null;
      const map = ctx.map;
      if (map) {
        const surf = surfaceAt(map, t.x, t.y, t.h + 0.35, { stepUp: 0.35, bodyHeight: 1 });
        if (surf.kind === 'ground' || surf.kind === 'deck') t.h = surf.z;
      }
      if (slide && spotIsFree(ctx, e, t.x + st.dx, t.y + st.dy, t.h, c.w, c.d)) st.target = { x: t.x + st.dx, y: t.y + st.dy };
    } else {
      t.x += (dx / dist) * step;
      t.y += (dy / dist) * step;
    }
    return;
  }
  for (const p of ctx.world.query(C.Transform, C.Body)) {
    const b = p.require<Body>(C.Body);
    if (!b.blockedBy.includes(e.id)) continue;
    const major = Math.abs(b.vx) >= Math.abs(b.vy) ? 'x' : 'y';
    const v = major === 'x' ? b.vx : b.vy;
    if (Math.abs(v) < 0.5) continue;
    const dir = Math.sign(v);
    const tx = Math.floor(t.x) + 0.5 + (major === 'x' ? dir : 0);
    const ty = Math.floor(t.y) + 0.5 + (major === 'y' ? dir : 0);
    if (spotIsFree(ctx, e, tx, ty, t.h, c.w, c.d)) {
      st.target = { x: tx, y: ty };
      st.dx = major === 'x' ? dir : 0;
      st.dy = major === 'y' ? dir : 0;
      ctx.events.emit('pushed', { entity: e.id, by: p.id });
      return;
    }
  }
}