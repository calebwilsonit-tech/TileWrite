import type { VisionState } from './ai';
import { TreeNode, BehaviorTree, describeNode, noteFired } from '@tilewright/plugin-sdk';
import {
  C,
  emitFx,
  facingOfGridDir,
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

// ---------- running ----------

type Result = 'success' | 'failure' | 'running';

interface NodeMemory {
  /** Seconds this node has been running (waits, walks). */
  t?: number;
  /** An instant action has done its thing; a chance has been rolled. */
  done?: boolean;
  roll?: boolean;
  /** Which child a repeat is on, and how many rounds it has finished. */
  rounds?: number;
  goal?: Cell2;
  nav?: NavState;
  /** Results of the children of a parallel node, so a finished child is not run again. */
  finished?: Record<string, Result>;
}

interface TreeRuntime {
  mem: Record<string, NodeMemory>;
  /** Cooldown nodes: seconds left. */
  cool: Record<string, number>;
  /** Behaviours the tree has switched off. */
  off: string[];
  lostFor: number;
  home: Cell2 | null;
  /** The last result of the whole tree, for the editor and tests. */
  last: Result;
  /** The node ids that were asked in the latest tick, with what each answered (for the editor's live view). */
  trace: Record<string, Result>;
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

/** The mutable things a tick of the tree works with. */
interface Run {
  ctx: SimContext;
  e: Entity;
  tree: BehaviorTree;
  rt: TreeRuntime;
  byId: Map<string, TreeNode>;
  /** What each node answered in the tick before: an action that was not asked then is starting now. */
  before: Record<string, Result>;
  visited: Set<string>;
  flags: ReturnType<typeof aiFlags>;
  moved: boolean;
}

function condition(r: Run, n: Extract<TreeNode, { type: 'condition' }>): boolean {
  const { ctx, e, tree, rt } = r;
  const c = n.condition;
  switch (c.type) {
    case 'sees':
      return (e.get<VisionState>('state:vision')?.seen ?? null) !== null;
    case 'heard':
      return e.get<VisionState>('state:vision')?.heard === true;
    case 'lost':
      return rt.lostFor >= c.seconds;
    case 'near':
      return (nearest(ctx, e, tree.target)?.d ?? Infinity) <= c.cells;
    case 'far':
      return (nearest(ctx, e, tree.target)?.d ?? Infinity) > c.cells;
    case 'health': {
      const h = healthOf(e);
      return h !== undefined && (h.hp / Math.max(1, h.max)) * 100 <= c.percent;
    }
    case 'chance': {
      // rolled once when the question comes up and kept while it keeps being asked, so it does not flicker every tick
      const m = (rt.mem[n.id] ??= {});
      if (m.roll === undefined) m.roll = ctx.rng.next() * 100 < c.percent;
      return m.roll;
    }
    case 'signal':
      return input(e, 'trigger');
    case 'variable':
      return compare(ctx.runtime.vars[c.name], c.op, c.value);
  }
}

function act(r: Run, n: Extract<TreeNode, { type: 'action' }>): Result {
  const { ctx, e, tree, rt } = r;
  const a = n.action;
  const m = (rt.mem[n.id] ??= {});
  const t = e.get<TransformIso>(C.Transform);
  const b = e.get<Body>(C.Body);
  const scale = r.flags.speedScale;
  const walk = (goal: Cell2, speed: number, arrive: number): Result => {
    if (!b || !t) return 'failure';
    r.moved = true;
    m.nav ??= newNav();
    const res = steerTo(ctx, e, goal, speed * scale, m.nav, arrive);
    return res === 'arrived' ? 'success' : res === 'stuck' ? 'failure' : 'running';
  };
  const once = (fn: () => void): Result => {
    if (!m.done) {
      m.done = true;
      fn();
    }
    return 'success';
  };
  switch (a.type) {
    case 'wait':
      m.t = (m.t ?? 0) + ctx.dt;
      if (b) {
        b.vx = b.vy = 0;
        r.moved = true;
      }
      return m.t >= a.seconds ? 'success' : 'running';
    case 'stop':
      if (b) {
        b.vx = b.vy = 0;
        r.moved = true;
      }
      return 'success';
    case 'moveToward': {
      const goal = nearest(ctx, e, tree.target)?.e.get<TransformIso>(C.Transform);
      if (!goal) return 'failure';
      return walk({ x: goal.x, y: goal.y }, a.speed, Math.max(0.2, a.stop));
    }
    case 'moveAway': {
      const near = nearest(ctx, e, tree.target)?.e.get<TransformIso>(C.Transform);
      if (!near || !t) return 'failure';
      const dx = t.x - near.x;
      const dy = t.y - near.y;
      const len = Math.hypot(dx, dy) || 1;
      if (len >= a.cells) {
        if (b) b.vx = b.vy = 0;
        return 'success';
      }
      t.facing = facingOfGridDir(dx, dy);
      return walk({ x: t.x + (dx / len) * 3, y: t.y + (dy / len) * 3 }, a.speed, 0.2) === 'failure' ? 'failure' : 'running';
    }
    case 'goHome':
      return rt.home ? walk(rt.home, a.speed, 0.18) : 'failure';
    case 'wander': {
      if (!t || !rt.home) return 'failure';
      if (!m.goal) m.goal = { x: rt.home.x + (ctx.rng.next() * 2 - 1) * a.radius, y: rt.home.y + (ctx.rng.next() * 2 - 1) * a.radius };
      return walk(m.goal, a.speed, 0.25);
    }
    case 'face': {
      const near = nearest(ctx, e, tree.target)?.e.get<TransformIso>(C.Transform);
      if (!near || !t) return 'failure';
      t.facing = facingOfGridDir(near.x - t.x, near.y - t.y);
      return 'success';
    }
    case 'animation':
      return once(() => {
        const anim = e.get<{ clip: string; time: number; playing: boolean }>('animator');
        if (anim && a.clip) {
          anim.clip = a.clip;
          anim.time = 0;
          anim.playing = true;
        }
      });
    case 'say':
      return once(() => void (a.text && ctx.events.emit('message', { text: ctx.assets.strings.t(a.text) })));
    case 'sound':
      return once(() => void (a.name && emitFx(ctx.runtime, { kind: 'sound', name: a.name })));
    case 'setVariable':
      return once(() => void (ctx.runtime.vars[a.name] = a.value));
    case 'enable':
      return once(() => void (rt.off = rt.off.filter((x) => x !== a.behaviour)));
    case 'disable':
      return once(() => void (a.behaviour && !rt.off.includes(a.behaviour) && rt.off.push(a.behaviour)));
  }
}

function run(r: Run, id: string, depth: number): Result {
  const n = r.byId.get(id);
  if (!n || depth > 40) return 'failure';
  r.visited.add(id);
  const result = ((): Result => {
    switch (n.type) {
      case 'condition':
        return condition(r, n) ? 'success' : 'failure';
      case 'action':
        if (r.before[id] === undefined) noteFired(r.ctx, `t:${r.e.get<{ sceneId?: string }>('meta')?.sceneId ?? String(r.e.id)}:${id}`, n.breakpoint === true, `${r.e.name} (behaviour tree) starts: ${describeNode(n)}`);
        return act(r, n);
      case 'sequence': {
        for (const c of n.children) {
          const res = run(r, c, depth + 1);
          if (res !== 'success') return res;
        }
        return 'success';
      }
      case 'selector': {
        for (const c of n.children) {
          const res = run(r, c, depth + 1);
          if (res !== 'failure') return res;
        }
        return 'failure';
      }
      case 'parallel': {
        const m = (r.rt.mem[n.id] ??= {});
        const done = (m.finished ??= {});
        let running = false;
        let failed = false;
        for (const c of n.children) {
          if (done[c] === 'success') {
            r.visited.add(c);
            continue;
          }
          const res = run(r, c, depth + 1);
          if (res === 'running') running = true;
          else if (res === 'failure') failed = true;
          else done[c] = 'success';
        }
        if (failed) return 'failure';
        return running ? 'running' : 'success';
      }
      case 'inverter': {
        if (!n.child) return 'failure';
        const res = run(r, n.child, depth + 1);
        return res === 'running' ? 'running' : res === 'success' ? 'failure' : 'success';
      }
      case 'succeeder': {
        if (!n.child) return 'success';
        const res = run(r, n.child, depth + 1);
        return res === 'running' ? 'running' : 'success';
      }
      case 'repeat': {
        if (!n.child) return 'failure';
        const m = (r.rt.mem[n.id] ??= {});
        const res = run(r, n.child, depth + 1);
        if (res === 'running') return 'running';
        if (res === 'failure') return 'failure';
        m.rounds = (m.rounds ?? 0) + 1;
        // the child starts afresh next time round
        delete r.rt.mem[n.child];
        r.visited.delete(n.child);
        return n.count > 0 && m.rounds >= n.count ? 'success' : 'running';
      }
      case 'cooldown': {
        if (!n.child) return 'failure';
        if ((r.rt.cool[n.id] ?? 0) > 0) return 'failure';
        const res = run(r, n.child, depth + 1);
        if (res !== 'running') r.rt.cool[n.id] = n.seconds;
        return res;
      }
    }
  })();
  r.rt.trace[id] = result;
  return result;
}

export const behaviorTree = behaviorDef<BehaviorTree>({
  id: 'behaviorTree',
  timing: 'realtime',
  name: 'Behaviour Tree',
  category: 'AI',
  description:
    'Gives an object a way of deciding what to do, as a tree of questions and actions that is asked many times a second. A sequence does things in order and stops at the first that fails; a selector tries things until one works; conditions ask ("does it see the player?"), actions do ("walk toward it", "wait", "switch a behaviour off"). Because the tree is asked again every moment, a high-priority branch (chase the player) interrupts a low-priority one (wander) the instant its condition holds. Draw it in the tree under the settings, or start from the Guard, Archer or Wanderer example. Use either a Behaviour Tree or a State Machine on one object, not both.',
  phase: 'brain',
  defaults: { target: 'player', root: '', nodes: [] },
  fields: [{ key: 'target', label: 'Looks at and moves toward things tagged', type: 'text' }],
  inputs: [{ name: 'trigger', label: 'Trigger', help: 'A "a wire sends it a signal" condition is true while this is on.' }],
  outputs: [],
  requires: {},
  editor: 'behaviorTree',
  summary: (s) => (s.nodes.length === 0 ? 'No nodes yet.' : `${s.nodes.length} node${s.nodes.length === 1 ? '' : 's'}, starting from ${s.nodes.find((n) => n.id === s.root) ? describeNode(s.nodes.find((n) => n.id === s.root)!) : '(nowhere)'}.`),
  update(ctx, e, tree) {
    if (tree.nodes.length === 0) return;
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    const root = byId.has(tree.root) ? tree.root : tree.nodes[0]!.id;
    const t = e.get<TransformIso>(C.Transform);
    const rt = stateOf<TreeRuntime>(e, 'tree', () => ({ mem: {}, cool: {}, off: [], lostFor: 0, home: t ? { x: t.x, y: t.y } : null, last: 'failure', trace: {} }));
    for (const k of Object.keys(rt.cool)) rt.cool[k] = Math.max(0, rt.cool[k]! - ctx.dt);
    const vis = e.get<VisionState>('state:vision');
    rt.lostFor = vis && (vis.seen !== null || vis.heard) ? 0 : rt.lostFor + ctx.dt;
    const flags = aiFlags(e);
    const dead = e.get<{ dead: boolean }>('state:health')?.dead ?? false;
    const b = e.get<Body>(C.Body);
    if (dead || flags.disabled) {
      if (b && flags.disabled) b.vx = b.vy = 0;
      return;
    }
    const before = rt.trace;
    rt.trace = {};
    const r: Run = { ctx, e, tree, rt, byId, before, visited: new Set(), flags, moved: false };
    rt.last = run(r, root, 0);
    // a node that was not asked this tick was interrupted: it starts afresh when it is asked again
    for (const id of Object.keys(rt.mem)) if (!r.visited.has(id)) delete rt.mem[id];
    e.set('state:machineGate', { off: [...rt.off] });
    if (!r.moved && b && !flags.busy) {
      // nothing in the tree is walking this object: stand still unless a behaviour (patrol, chase) is moving it
      if (!e.has('patrol') && !e.has('chase')) b.vx = b.vy = 0;
    }
  },
});
