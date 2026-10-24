import { C, emitFx, facingOfGridDir, type Body, type Cell2, type Entity, type SimContext, type TransformIso } from '@tilewright/runtime';
import { defineBehavior, stateOf } from '../framework';
import { input } from '../signals';
import { aiFlags, healthOf } from './combat';
import { newNav, steerTo, type NavState } from '../nav';
import type { VisionState } from './ai';

/**
 * Behaviour trees for enemies, bosses and anything that makes decisions. A tree is asked what to do many times a second:
 * it starts at the root and asks its children in order. *Sequences* do their children one after another and stop at the
 * first that fails ("see the player, then chase, then shoot"); *selectors* try their children until one works ("chase if
 * you can, otherwise patrol, otherwise wander"). *Conditions* ask a question, *actions* do something (walk, wait, shout,
 * switch a behaviour on or off). Plain data, drawn as a tree in the Inspector.
 */

export type TreeCompare = '=' | '!=' | '>' | '>=' | '<' | '<=';

export type TreeCondition =
  | { type: 'sees' }
  | { type: 'heard' }
  /** Has not seen or heard the target for this many seconds. */
  | { type: 'lost'; seconds: number }
  | { type: 'near'; cells: number }
  | { type: 'far'; cells: number }
  /** Health is at or below this percentage. */
  | { type: 'health'; percent: number }
  /** True this percent of the time (decided once each time the question comes up). */
  | { type: 'chance'; percent: number }
  /** A wire into this object's "trigger" input is on. */
  | { type: 'signal' }
  | { type: 'variable'; name: string; op: TreeCompare; value: number | string | boolean };

export type TreeAction =
  | { type: 'wait'; seconds: number }
  | { type: 'stop' }
  | { type: 'moveToward'; speed: number; stop: number }
  | { type: 'moveAway'; speed: number; cells: number }
  | { type: 'goHome'; speed: number }
  | { type: 'wander'; speed: number; radius: number }
  | { type: 'face' }
  | { type: 'animation'; clip: string }
  | { type: 'say'; text: string }
  | { type: 'sound'; name: string }
  | { type: 'setVariable'; name: string; value: number | string | boolean }
  | { type: 'enable'; behaviour: string }
  | { type: 'disable'; behaviour: string };

export type TreeNodeKind = 'sequence' | 'selector' | 'parallel' | 'inverter' | 'succeeder' | 'repeat' | 'cooldown' | 'condition' | 'action';

interface NodeBase {
  id: string;
  /** A name for the node in the editor ('' = describe it from what it does). */
  name?: string;
  x?: number;
  y?: number;
}

export type TreeNode =
  | (NodeBase & { type: 'sequence' | 'selector' | 'parallel'; children: string[] })
  | (NodeBase & { type: 'inverter' | 'succeeder'; child: string | null })
  | (NodeBase & { type: 'repeat'; child: string | null; count: number })
  | (NodeBase & { type: 'cooldown'; child: string | null; seconds: number })
  | (NodeBase & { type: 'condition'; condition: TreeCondition })
  | (NodeBase & { type: 'action'; action: TreeAction });

export interface BehaviorTree {
  /** Tag of what the object looks at and moves toward or away from. */
  target: string;
  /** Id of the node the tree starts from. */
  root: string;
  nodes: TreeNode[];
}

export const NODE_KIND_LABELS: Record<TreeNodeKind, string> = {
  sequence: 'Does these in order (stops at the first that fails)',
  selector: 'Tries these in order (stops at the first that works)',
  parallel: 'Does all of these at once',
  inverter: 'Turns a yes into a no, and a no into a yes',
  succeeder: 'Counts as done even if its child failed',
  repeat: 'Repeats its child',
  cooldown: 'Lets its child run, then waits before the next time',
  condition: 'Asks a question',
  action: 'Does something',
};

export const CONDITION_KIND_LABELS: Record<TreeCondition['type'], string> = {
  sees: 'it sees its target',
  heard: 'it hears its target',
  lost: 'it has lost its target for a while',
  near: 'its target is close',
  far: 'its target is far away',
  health: 'its health is low',
  chance: 'luck says so',
  signal: 'a wire sends it a signal',
  variable: 'a variable has a value',
};

export const ACTION_KIND_LABELS: Record<TreeAction['type'], string> = {
  wait: 'Wait',
  stop: 'Stand still',
  moveToward: 'Walk toward its target',
  moveAway: 'Walk away from its target',
  goHome: 'Walk back to where it started',
  wander: 'Wander around nearby',
  face: 'Turn to face its target',
  animation: 'Play an animation',
  say: 'Say something',
  sound: 'Play a sound',
  setVariable: 'Set a variable',
  enable: 'Switch a behaviour on',
  disable: 'Switch a behaviour off',
};

export function newTreeCondition(type: TreeCondition['type']): TreeCondition {
  switch (type) {
    case 'lost':
      return { type, seconds: 3 };
    case 'near':
    case 'far':
      return { type, cells: 3 };
    case 'health':
      return { type, percent: 50 };
    case 'chance':
      return { type, percent: 30 };
    case 'variable':
      return { type, name: '', op: '>=', value: 1 };
    default:
      return { type } as TreeCondition;
  }
}

export function newTreeAction(type: TreeAction['type']): TreeAction {
  switch (type) {
    case 'wait':
      return { type, seconds: 1 };
    case 'moveToward':
      return { type, speed: 3.2, stop: 1 };
    case 'moveAway':
      return { type, speed: 3.2, cells: 5 };
    case 'goHome':
      return { type, speed: 2.4 };
    case 'wander':
      return { type, speed: 1.6, radius: 3 };
    case 'animation':
      return { type, clip: '' };
    case 'say':
      return { type, text: '' };
    case 'sound':
      return { type, name: '' };
    case 'setVariable':
      return { type, name: '', value: 1 };
    case 'enable':
    case 'disable':
      return { type, behaviour: '' };
    default:
      return { type } as TreeAction;
  }
}

export function newTreeNode(id: string, kind: TreeNodeKind): TreeNode {
  switch (kind) {
    case 'sequence':
    case 'selector':
    case 'parallel':
      return { id, type: kind, children: [] };
    case 'inverter':
    case 'succeeder':
      return { id, type: kind, child: null };
    case 'repeat':
      return { id, type: kind, child: null, count: 0 };
    case 'cooldown':
      return { id, type: kind, child: null, seconds: 2 };
    case 'condition':
      return { id, type: kind, condition: newTreeCondition('sees') };
    case 'action':
      return { id, type: kind, action: newTreeAction('wait') };
  }
}

/** The ids of a node's children, in order. */
export function childrenOf(n: TreeNode): string[] {
  switch (n.type) {
    case 'sequence':
    case 'selector':
    case 'parallel':
      return n.children;
    case 'condition':
    case 'action':
      return [];
    default:
      return n.child ? [n.child] : [];
  }
}

export function isComposite(n: TreeNode): n is Extract<TreeNode, { children: string[] }> {
  return n.type === 'sequence' || n.type === 'selector' || n.type === 'parallel';
}

export function isDecorator(n: TreeNode): n is Extract<TreeNode, { child: string | null }> {
  return n.type === 'inverter' || n.type === 'succeeder' || n.type === 'repeat' || n.type === 'cooldown';
}

export function describeTreeCondition(c: TreeCondition): string {
  switch (c.type) {
    case 'lost':
      return `it has lost its target for ${c.seconds} s`;
    case 'near':
      return `its target is within ${c.cells} cells`;
    case 'far':
      return `its target is more than ${c.cells} cells away`;
    case 'health':
      return `its health is ${c.percent}% or less`;
    case 'chance':
      return `${c.percent}% chance`;
    case 'variable':
      return `${c.name || '(variable)'} ${c.op} ${String(c.value)}`;
    default:
      return CONDITION_KIND_LABELS[c.type];
  }
}

export function describeTreeAction(a: TreeAction): string {
  switch (a.type) {
    case 'wait':
      return `wait ${a.seconds} s`;
    case 'moveToward':
      return `walk toward its target (stop ${a.stop} cells away)`;
    case 'moveAway':
      return `walk ${a.cells} cells away from its target`;
    case 'goHome':
      return 'walk back to where it started';
    case 'wander':
      return `wander within ${a.radius} cells`;
    case 'animation':
      return `play the animation "${a.clip || '(clip)'}"`;
    case 'say':
      return `say "${a.text || '...'}"`;
    case 'sound':
      return `play the sound "${a.name || '(sound)'}"`;
    case 'setVariable':
      return `set ${a.name || '(variable)'} to ${String(a.value)}`;
    case 'enable':
      return `switch on ${a.behaviour || '(behaviour)'}`;
    case 'disable':
      return `switch off ${a.behaviour || '(behaviour)'}`;
    default:
      return ACTION_KIND_LABELS[a.type].toLowerCase();
  }
}

/** One line saying what a node is (its name, or what it does). */
export function describeNode(n: TreeNode): string {
  if (n.name) return n.name;
  switch (n.type) {
    case 'sequence':
      return 'In order';
    case 'selector':
      return 'First that works';
    case 'parallel':
      return 'All at once';
    case 'inverter':
      return 'Not';
    case 'succeeder':
      return 'Always OK';
    case 'repeat':
      return n.count > 0 ? `Repeat ${n.count} times` : 'Repeat forever';
    case 'cooldown':
      return `Then rest ${n.seconds} s`;
    case 'condition':
      return `If ${describeTreeCondition(n.condition)}`;
    case 'action':
      return describeTreeAction(n.action);
  }
}

/** Mistakes in a tree that would stop it doing what it says, in plain English. */
export function checkTree(t: BehaviorTree, has: (behaviour: string) => boolean = () => true): string[] {
  const out: string[] = [];
  if (t.nodes.length === 0) return ['It has no nodes yet.'];
  const byId = new Map<string, TreeNode>();
  for (const n of t.nodes) {
    if (byId.has(n.id)) out.push(`Two nodes share the id "${n.id}".`);
    byId.set(n.id, n);
  }
  if (!byId.has(t.root)) {
    out.push(`It starts from "${t.root}", which is not one of its nodes.`);
    return out;
  }
  const parents = new Map<string, number>();
  const seen = new Set<string>();
  const walk = (id: string, trail: string[]): void => {
    if (trail.includes(id)) {
      out.push(`The node "${describeNode(byId.get(id)!)}" leads back to itself, so the tree would never end.`);
      return;
    }
    const n = byId.get(id);
    if (!n) return;
    seen.add(id);
    for (const c of childrenOf(n)) {
      if (!byId.has(c)) {
        out.push(`"${describeNode(n)}" has a child that does not exist.`);
        continue;
      }
      parents.set(c, (parents.get(c) ?? 0) + 1);
      walk(c, [...trail, id]);
    }
  };
  walk(t.root, []);
  for (const [id, n] of parents) if (n > 1) out.push(`The node "${describeNode(byId.get(id)!)}" is used in more than one place.`);
  for (const n of t.nodes) {
    if (!seen.has(n.id)) {
      out.push(`The node "${describeNode(n)}" is not connected to the tree, so it never runs.`);
      continue;
    }
    if (isComposite(n) && n.children.length === 0) out.push(`"${describeNode(n)}" has nothing inside it.`);
    if (isDecorator(n) && !n.child) out.push(`"${describeNode(n)}" has nothing to work on: add a child.`);
    if (n.type === 'condition' && n.condition.type === 'variable' && !n.condition.name) out.push(`"${describeNode(n)}" checks a variable but no variable is chosen.`);
    if (n.type === 'action' && n.action.type === 'setVariable' && !n.action.name) out.push(`"${describeNode(n)}" sets a variable but no variable is chosen.`);
    if (n.type === 'action' && (n.action.type === 'enable' || n.action.type === 'disable')) {
      if (!n.action.behaviour) out.push(`"${describeNode(n)}" switches a behaviour but none is chosen.`);
      else if (!has(n.action.behaviour)) out.push(`"${describeNode(n)}" switches the behaviour "${n.action.behaviour}", which this object does not have.`);
    }
    if (n.type === 'action' && n.action.type === 'animation' && !n.action.clip) out.push(`"${describeNode(n)}" plays an animation but none is chosen.`);
  }
  // an infinite loop of instant nodes would freeze nothing (it runs once per tick) but also never do anything useful
  const only = t.nodes.filter((n) => seen.has(n.id));
  if (only.length > 0 && only.every((n) => n.type !== 'action' && n.type !== 'condition' && !isComposite(n) && !isDecorator(n))) out.push('The tree does nothing.');
  return out;
}

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

export const behaviorTree = defineBehavior<BehaviorTree>({
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
    rt.trace = {};
    const r: Run = { ctx, e, tree, rt, byId, visited: new Set(), flags, moved: false };
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

// ---------- examples ----------

const seq = (id: string, children: string[], name?: string): TreeNode => ({ id, type: 'sequence', children, ...(name ? { name } : {}) });
const sel = (id: string, children: string[], name?: string): TreeNode => ({ id, type: 'selector', children, ...(name ? { name } : {}) });
const cond = (id: string, condition: TreeCondition, name?: string): TreeNode => ({ id, type: 'condition', condition, ...(name ? { name } : {}) });
const action = (id: string, a: TreeAction, name?: string): TreeNode => ({ id, type: 'action', action: a, ...(name ? { name } : {}) });

/** The Guard example: chase what it sees, otherwise look around where it lost it, otherwise wander near home. */
export function guardTree(): BehaviorTree {
  return {
    target: 'player',
    root: 'root',
    nodes: [
      sel('root', ['chase', 'search', 'wander'], 'Guard'),
      seq('chase', ['sees', 'run'], 'Chase what it sees'),
      cond('sees', { type: 'sees' }),
      action('run', { type: 'moveToward', speed: 3.4, stop: 0.8 }),
      seq('search', ['lost', 'look', 'home'], 'Look around, then go back'),
      cond('lost', { type: 'lost', seconds: 0.2 }, 'It just lost sight'),
      action('look', { type: 'wait', seconds: 3 }, 'Look around'),
      action('home', { type: 'goHome', speed: 2.4 }),
      action('wander', { type: 'wander', speed: 1.4, radius: 3 }),
    ],
  };
}

/**
 * The Archer example: keeps its distance and closes in when the target is far. Give the object a Ranged Attack too; this
 * tree stands it still and turned toward the target while it is in range, so the shots find their mark.
 */
export function archerTree(): BehaviorTree {
  return {
    target: 'player',
    root: 'root',
    nodes: [
      sel('root', ['flee', 'shoot', 'approach', 'idle'], 'Archer'),
      seq('flee', ['close', 'back'], 'Too close: back off'),
      cond('close', { type: 'near', cells: 3 }),
      action('back', { type: 'moveAway', speed: 3.2, cells: 5 }),
      seq('shoot', ['sees', 'inRange', 'aim', 'hold'], 'In range: take aim'),
      cond('sees', { type: 'sees' }),
      { id: 'inRange', type: 'inverter', child: 'notFar', name: 'Not too far' },
      cond('notFar', { type: 'far', cells: 7 }),
      action('aim', { type: 'face' }),
      action('hold', { type: 'wait', seconds: 0.5 }, 'Hold still for the shot'),
      seq('approach', ['far', 'go'], 'Too far: get closer'),
      cond('far', { type: 'far', cells: 7 }),
      action('go', { type: 'moveToward', speed: 2.6, stop: 5 }),
      action('idle', { type: 'stop' }),
    ],
  };
}

/** The Wanderer example: ambles around home, pausing now and then, and runs when hurt. */
export function wandererTree(): BehaviorTree {
  return {
    target: 'player',
    root: 'root',
    nodes: [
      sel('root', ['hurt', 'amble'], 'Wanderer'),
      seq('hurt', ['low', 'flee'], 'Hurt: run away'),
      cond('low', { type: 'health', percent: 50 }),
      action('flee', { type: 'moveAway', speed: 3.6, cells: 8 }),
      seq('amble', ['go', 'rest'], 'Amble about'),
      action('go', { type: 'wander', speed: 1.3, radius: 4 }),
      action('rest', { type: 'wait', seconds: 2 }),
    ],
  };
}
