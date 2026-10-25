import type { VisionState } from './ai';
import { MachineCondition, StateMachine, gatedBehaviours, noteFired } from '@tilewright/plugin-sdk';
import {
  C,
  facingOfGridDir,
  emitFx,
  type Body,
  type Cell2,
  type Entity,
  type SimContext,
  type TransformIso,
  stateOf,
  input,
  newNav,
  steerTo,
  type NavState,
  behaviorDef,
} from '@tilewright/plugin-sdk';
import { aiFlags, healthOf } from '@tilewright/plugin-combat';

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
    // the same record every other kind of logic leaves: the editor lights it, lists it with the rest and can stop the game here
    noteFired(ctx, `m:${e.get<{ sceneId?: string }>('meta')?.sceneId ?? String(e.id)}:${id}`, s.breakpoint === true, `${e.name} (state machine) goes from "${from}" to "${s.name}"`);
  }
}

export const stateMachine = behaviorDef<StateMachine>({
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
