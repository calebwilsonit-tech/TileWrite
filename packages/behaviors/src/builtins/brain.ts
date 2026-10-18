import { C, facingOfGridDir, emitFx, type Body, type Cell2, type Entity, type SimContext, type TransformIso } from '@tilewright/runtime';
import { defineBehavior, stateOf } from '../framework';
import { input } from '../signals';
import { aiFlags, healthOf } from './combat';
import { newNav, steerTo, type NavState, type VisionState } from './ai';

/**
 * State machines for enemies, bosses and anything else with moods. An object is in one *state* at a time (Patrol,
 * Chase, Search...). A state says which behaviours are active, how the object moves on its own, which animation plays and
 * what it says; *transitions* move it to another state when a condition becomes true. Plain data, drawn as a graph in
 * the Inspector.
 */

export type MachineCondition =
  | { type: 'always' }
  | { type: 'sees' }
  | { type: 'heard' }
  /** Has not seen or heard the target for this many seconds. */
  | { type: 'lost'; seconds: number }
  | { type: 'near'; cells: number }
  | { type: 'far'; cells: number }
  /** Health is at or below this percentage. */
  | { type: 'health'; percent: number }
  /** Has been in this state this long. */
  | { type: 'time'; seconds: number }
  /** A wire into this object's "trigger" input is on. */
  | { type: 'signal' }
  | { type: 'variable'; name: string; op: '=' | '!=' | '>' | '>=' | '<' | '<='; value: number | string | boolean }
  /** The walk this state asked for has arrived. */
  | { type: 'arrived' }
  | { type: 'defeated' };

export interface MachineState {
  id: string;
  name: string;
  /** Behaviours that run in this state. Any behaviour named in some state but not this one is switched off here. */
  behaviours: string[];
  /** How the object moves by itself while here. */
  move: 'none' | 'toward' | 'away' | 'home';
  /** Speed of that movement (cells per second). */
  speed: number;
  /** Animation clip to play ('' = leave it). */
  anim: string;
  /** Message shown when entering ('' = none). */
  message: string;
  /** Sound played when entering ('' = none). */
  sound: string;
  /** Position in the editor's graph. */
  x?: number;
  y?: number;
}

export interface MachineTransition {
  id: string;
  /** State id, or '*' for "from any state". */
  from: string;
  to: string;
  when: MachineCondition;
}

export interface StateMachine {
  /** Tag of what the object looks at and moves toward or away from. */
  target: string;
  /** Id of the state it starts in. */
  start: string;
  states: MachineState[];
  transitions: MachineTransition[];
}

export const CONDITION_LABELS: Record<MachineCondition['type'], string> = {
  always: 'right away',
  sees: 'it sees its target',
  heard: 'it hears its target',
  lost: 'it has lost its target for a while',
  near: 'its target is close',
  far: 'its target is far away',
  health: 'its health is low',
  time: 'it has been here a while',
  signal: 'a wire sends it a signal',
  variable: 'a variable has a value',
  arrived: 'it has arrived',
  defeated: 'it is defeated',
};

export function newMachineState(id: string, name: string): MachineState {
  return { id, name, behaviours: [], move: 'none', speed: 3, anim: '', message: '', sound: '' };
}

export function newMachineCondition(type: MachineCondition['type']): MachineCondition {
  switch (type) {
    case 'lost':
    case 'time':
      return { type, seconds: 3 };
    case 'near':
    case 'far':
      return { type, cells: 3 };
    case 'health':
      return { type, percent: 50 };
    case 'variable':
      return { type, name: '', op: '>=', value: 1 };
    default:
      return { type } as MachineCondition;
  }
}

export function describeMachineCondition(c: MachineCondition): string {
  switch (c.type) {
    case 'lost':
      return `it has lost its target for ${c.seconds} s`;
    case 'time':
      return `it has been here ${c.seconds} s`;
    case 'near':
      return `its target is within ${c.cells} cells`;
    case 'far':
      return `its target is more than ${c.cells} cells away`;
    case 'health':
      return `its health is ${c.percent}% or less`;
    case 'variable':
      return `${c.name || '(variable)'} ${c.op} ${String(c.value)}`;
    default:
      return CONDITION_LABELS[c.type];
  }
}

/** Mistakes in a machine that would stop it doing what it says, in plain English. */
export function checkMachine(m: StateMachine, has: (behaviour: string) => boolean = () => true): string[] {
  const out: string[] = [];
  const ids = new Set(m.states.map((s) => s.id));
  if (m.states.length === 0) return ['It has no states yet.'];
  if (!ids.has(m.start)) out.push(`It starts in "${m.start}", which is not one of its states.`);
  const dup = m.states.find((s, i) => m.states.findIndex((x) => x.id === s.id) !== i);
  if (dup) out.push(`Two states share the id "${dup.id}".`);
  for (const t of m.transitions) {
    const label = `The transition ${t.from === '*' ? 'from any state' : `from "${m.states.find((s) => s.id === t.from)?.name ?? t.from}"`} to "${m.states.find((s) => s.id === t.to)?.name ?? t.to}"`;
    if (t.from !== '*' && !ids.has(t.from)) out.push(`${label} starts at a state that does not exist.`);
    if (!ids.has(t.to)) out.push(`${label} goes to a state that does not exist.`);
    if (t.when.type === 'variable' && !t.when.name) out.push(`${label} checks a variable but no variable is chosen.`);
    if (t.from === t.to && t.when.type === 'always') out.push(`${label} loops on itself forever.`);
  }
  const reach = new Set<string>(ids.has(m.start) ? [m.start] : []);
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of m.transitions) {
      if (!ids.has(t.to) || reach.has(t.to)) continue;
      if (t.from === '*' || reach.has(t.from)) {
        reach.add(t.to);
        grew = true;
      }
    }
  }
  for (const s of m.states) if (!reach.has(s.id)) out.push(`The state "${s.name}" can never be reached: nothing leads to it.`);
  for (const s of m.states) for (const b of s.behaviours) if (!has(b)) out.push(`The state "${s.name}" uses the behaviour "${b}", which this object does not have.`);
  const stuck = m.states.filter((s) => !m.transitions.some((t) => t.from === s.id || t.from === '*') && m.states.length > 1);
  for (const s of stuck) out.push(`The state "${s.name}" has no way out: once the object is there it stays there.`);
  return out;
}

interface MachineRuntime {
  current: string;
  timeIn: number;
  lostFor: number;
  nav: NavState;
  /** The walk of this state has arrived. */
  arrived: boolean;
  home: Cell2 | null;
}

const targets = (ctx: SimContext, e: Entity, tag: string): Entity[] => ctx.world.withTag(tag).filter((o) => o !== e && o.alive && !(o.get<{ dead: boolean }>('state:health')?.dead ?? false));

function nearest(ctx: SimContext, e: Entity, tag: string): { e: Entity; d: number } | null {
  const t = e.get<TransformIso>(C.Transform);
  if (!t) return null;
  let best: { e: Entity; d: number } | null = null;
  for (const o of targets(ctx, e, tag)) {
    const ot = o.get<TransformIso>(C.Transform);
    if (!ot) continue;
    const d = Math.hypot(ot.x - t.x, ot.y - t.y);
    if (!best || d < best.d) best = { e: o, d };
  }
  return best;
}

function compare(a: unknown, op: string, b: unknown): boolean {
  if (op === '=') return a === b;
  if (op === '!=') return a !== b;
  const x = typeof a === 'number' ? a : Number(a);
  const y = typeof b === 'number' ? b : Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  return op === '>' ? x > y : op === '>=' ? x >= y : op === '<' ? x < y : x <= y;
}

function holds(ctx: SimContext, e: Entity, m: StateMachine, rt: MachineRuntime, c: MachineCondition): boolean {
  switch (c.type) {
    case 'always':
      return true;
    case 'sees':
      return (e.get<VisionState>('state:vision')?.seen ?? null) !== null;
    case 'heard':
      return e.get<VisionState>('state:vision')?.heard === true;
    case 'lost':
      return rt.lostFor >= c.seconds;
    case 'near':
      return (nearest(ctx, e, m.target)?.d ?? Infinity) <= c.cells;
    case 'far':
      return (nearest(ctx, e, m.target)?.d ?? Infinity) > c.cells;
    case 'health': {
      const h = healthOf(e);
      return h !== undefined && (h.hp / Math.max(1, h.max)) * 100 <= c.percent;
    }
    case 'time':
      return rt.timeIn >= c.seconds;
    case 'signal':
      return input(e, 'trigger');
    case 'variable':
      return compare(ctx.runtime.vars[c.name], c.op, c.value);
    case 'arrived':
      return rt.arrived;
    case 'defeated':
      return e.get<{ dead: boolean }>('state:health')?.dead ?? false;
  }
}

/** The behaviours the machine switches off right now (those named in some state but not the current one). */
export function gatedBehaviours(m: StateMachine, current: string): string[] {
  const all = new Set(m.states.flatMap((s) => s.behaviours));
  const on = new Set(m.states.find((s) => s.id === current)?.behaviours ?? []);
  return [...all].filter((b) => !on.has(b));
}

function enter(ctx: SimContext, e: Entity, m: StateMachine, rt: MachineRuntime, id: string, first: boolean): void {
  const from = rt.current;
  const s = m.states.find((x) => x.id === id);
  if (!s) return;
  rt.current = id;
  rt.timeIn = 0;
  rt.arrived = false;
  rt.nav = newNav();
  const b = e.get<Body>(C.Body);
  if (b) b.vx = b.vy = 0; // the state's own movement (or behaviours) takes over from a standstill
  const anim = e.get<{ clip: string; time: number; playing: boolean }>('animator');
  if (anim && s.anim) {
    anim.clip = s.anim;
    anim.time = 0;
    anim.playing = true;
  }
  if (!first) {
    if (s.message) ctx.events.emit('message', { text: ctx.assets.strings.t(s.message) });
    if (s.sound) emitFx(ctx.runtime, { kind: 'sound', name: s.sound });
    ctx.events.emit('state-changed', { entity: e.id, from, to: id, name: s.name });
  }
}

export const stateMachine = defineBehavior<StateMachine>({
  id: 'stateMachine',
  timing: 'realtime',
  name: 'State Machine',
  category: 'AI',
  description:
    'Gives an object moods: it is in one state at a time (Patrol, Chase, Search, Flee...). Each state says which behaviours run, how it moves by itself, which animation plays and what it says, and arrows between states say when it changes its mind (it sees you, you are close, its health is low, a few seconds have passed...). Draw it in the graph under the settings, or start from the Guard or Boss example.',
  phase: 'brain',
  defaults: { target: 'player', start: '', states: [], transitions: [] },
  fields: [{ key: 'target', label: 'Looks at and moves toward things tagged', type: 'text' }],
  inputs: [{ name: 'trigger', label: 'Trigger', help: 'A "a wire sends it a signal" transition fires while this is on.' }],
  outputs: [],
  requires: {},
  editor: 'stateMachine',
  summary: (s) => (s.states.length === 0 ? 'No states yet.' : `${s.states.length} state${s.states.length === 1 ? '' : 's'}, ${s.transitions.length} transition${s.transitions.length === 1 ? '' : 's'}; starts in ${s.states.find((x) => x.id === s.start)?.name ?? '(nowhere)'}.`),
  update(ctx, e, m) {
    if (m.states.length === 0) return;
    const t = e.get<TransformIso>(C.Transform);
    const rt = stateOf<MachineRuntime>(e, 'machine', () => ({ current: '', timeIn: 0, lostFor: 0, nav: newNav(), arrived: false, home: t ? { x: t.x, y: t.y } : null }));
    if (!m.states.some((s) => s.id === rt.current)) enter(ctx, e, m, rt, m.states.some((s) => s.id === m.start) ? m.start : m.states[0]!.id, true);
    rt.timeIn += ctx.dt;
    const vis = e.get<VisionState>('state:vision');
    rt.lostFor = vis && (vis.seen !== null || vis.heard) ? 0 : rt.lostFor + ctx.dt;

    // the first transition out of this state whose condition holds wins (up to a few in one tick, so chains settle)
    for (let hops = 0; hops < 4; hops++) {
      const hit = m.transitions.find((x) => (x.from === rt.current || x.from === '*') && x.to !== rt.current && m.states.some((s) => s.id === x.to) && holds(ctx, e, m, rt, x.when));
      if (!hit) break;
      enter(ctx, e, m, rt, hit.to, false);
    }

    const state = m.states.find((s) => s.id === rt.current)!;
    e.set('state:machineGate', { off: gatedBehaviours(m, rt.current) });
    const flags = aiFlags(e);
    if (state.behaviours.length === 0 && state.move === 'none') flags.busy = false;
    const b = e.get<Body>(C.Body);
    if (!b || !t) return;
    const dead = e.get<{ dead: boolean }>('state:health')?.dead ?? false;
    if (dead || flags.disabled) return;
    const speed = state.speed * flags.speedScale;
    if (state.move === 'toward') {
      const goal = nearest(ctx, e, m.target)?.e.get<TransformIso>(C.Transform);
      if (goal) rt.arrived = steerTo(ctx, e, { x: goal.x, y: goal.y }, speed, rt.nav, 0.9) === 'arrived';
    } else if (state.move === 'away') {
      const near = nearest(ctx, e, m.target)?.e.get<TransformIso>(C.Transform);
      if (near) {
        const dx = t.x - near.x;
        const dy = t.y - near.y;
        const len = Math.hypot(dx, dy) || 1;
        const goal = { x: t.x + (dx / len) * 4, y: t.y + (dy / len) * 4 };
        rt.arrived = steerTo(ctx, e, goal, speed, rt.nav) === 'arrived';
        t.facing = facingOfGridDir(dx, dy);
      }
    } else if (state.move === 'home' && rt.home) {
      rt.arrived = steerTo(ctx, e, rt.home, speed, rt.nav) === 'arrived';
    }
  },
});

/** The Guard example: patrols, chases what it sees, looks around, and goes back to its route. */
export function guardMachine(): StateMachine {
  const patrol: MachineState = { ...newMachineState('patrol', 'Patrol'), behaviours: ['patrol', 'vision'], x: 20, y: 40 };
  const chase: MachineState = { ...newMachineState('chase', 'Chase'), behaviours: ['vision'], move: 'toward', speed: 3.4, message: '', x: 300, y: 40 };
  const search: MachineState = { ...newMachineState('search', 'Look around'), behaviours: ['vision'], x: 300, y: 200 };
  const back: MachineState = { ...newMachineState('back', 'Go back'), behaviours: ['vision'], move: 'home', speed: 2.4, x: 20, y: 200 };
  const tr = (id: string, from: string, to: string, when: MachineCondition): MachineTransition => ({ id, from, to, when });
  return {
    target: 'player',
    start: 'patrol',
    states: [patrol, chase, search, back],
    transitions: [
      tr('t1', 'patrol', 'chase', { type: 'sees' }),
      tr('t2', 'chase', 'search', { type: 'lost', seconds: 1.5 }),
      tr('t3', 'search', 'chase', { type: 'sees' }),
      tr('t4', 'search', 'back', { type: 'time', seconds: 3 }),
      tr('t5', 'back', 'chase', { type: 'sees' }),
      tr('t6', 'back', 'patrol', { type: 'arrived' }),
    ],
  };
}

/** The Boss example: calm, then aggressive, then desperate and fleeing to recover. */
export function bossMachine(): StateMachine {
  const calm: MachineState = { ...newMachineState('calm', 'Watching'), behaviours: ['vision'], x: 20, y: 40 };
  const attack: MachineState = { ...newMachineState('attack', 'Attack'), behaviours: ['vision', 'damageOnTouch'], move: 'toward', speed: 3, message: 'The boss lunges!', x: 300, y: 40 };
  const rage: MachineState = { ...newMachineState('rage', 'Rage'), behaviours: ['vision', 'damageOnTouch'], move: 'toward', speed: 4.6, message: 'The boss roars!', x: 300, y: 200 };
  const flee: MachineState = { ...newMachineState('flee', 'Back off'), behaviours: ['vision'], move: 'away', speed: 3.5, x: 20, y: 200 };
  const tr = (id: string, from: string, to: string, when: MachineCondition): MachineTransition => ({ id, from, to, when });
  return {
    target: 'player',
    start: 'calm',
    states: [calm, attack, rage, flee],
    transitions: [
      tr('t1', 'calm', 'attack', { type: 'sees' }),
      // the health checks come first, so a wounded boss goes into a rage instead of backing off
      tr('t2', 'attack', 'rage', { type: 'health', percent: 40 }),
      tr('t3', 'flee', 'rage', { type: 'health', percent: 40 }),
      tr('t4', 'attack', 'flee', { type: 'time', seconds: 6 }),
      tr('t5', 'flee', 'attack', { type: 'time', seconds: 2 }),
      tr('t6', 'rage', 'calm', { type: 'lost', seconds: 6 }),    ],
  };
}
