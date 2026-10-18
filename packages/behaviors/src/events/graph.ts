import type { Entity, EventAction, EventCondition, GraphData, GraphNodeData, SimContext } from '@tilewright/runtime';
import { actionDef, conditionDef, describeAction, describeCondition, noteFired, resolveRef, runActionList, testConditionList, withTableRow } from './sheet';

/**
 * Logic graphs: the Blueprint-style level of the logic system. A graph is boxes joined by lines; a flow starts at an
 * event box and follows the lines through actions, branches, loops, delays and calls to other graphs. Every box is
 * made from the same conditions and actions as the event sheet, so the two convert into each other where they can
 * (see graph-convert.ts).
 */

export interface GraphNodeKind {
  id: string;
  label: string;
  help: string;
  /** Output pins, in the order they are drawn (every box except an event or a function also has an "in" pin). */
  outputs: { pin: string; label: string }[];
  /** An entry: nothing leads into it. */
  entry?: boolean;
  defaults: Record<string, unknown>;
}

export const GRAPH_NODE_KINDS: GraphNodeKind[] = [
  { id: 'event', label: 'When...', help: 'Starts a flow when its conditions hold (once, the moment they become true, unless "every tick" is chosen).', outputs: [{ pin: 'out', label: 'then' }], entry: true, defaults: { conditions: [{ type: 'start', params: {}, negate: false }], mode: 'all', once: true } },
  { id: 'function', label: 'Function', help: 'A named flow other graphs can call, like a custom block. Nothing starts it but a Call box.', outputs: [{ pin: 'out', label: 'then' }], entry: true, defaults: { name: 'My function' } },
  { id: 'action', label: 'Do...', help: 'Does one thing: any action from the event sheet.', outputs: [{ pin: 'out', label: 'next' }], defaults: { action: { type: 'message', params: { text: 'Hello!' } } } },
  { id: 'branch', label: 'If...', help: 'Goes one way when its conditions hold and the other way when they do not.', outputs: [{ pin: 'true', label: 'yes' }, { pin: 'false', label: 'no' }], defaults: { conditions: [{ type: 'always', params: {}, negate: false }], mode: 'all', once: false } },
  { id: 'loop', label: 'Repeat', help: 'Runs its body a number of times, then carries on.', outputs: [{ pin: 'body', label: 'each time' }, { pin: 'done', label: 'when done' }], defaults: { count: 3 } },
  { id: 'forEach', label: 'For each...', help: 'Runs its body once for every object with a tag, or for every row of a data table (row.id and row.<column> hold the cells), then carries on.', outputs: [{ pin: 'body', label: 'for each' }, { pin: 'done', label: 'when done' }], defaults: { over: 'tag:enemy' } },
  { id: 'delay', label: 'Wait', help: 'Carries on after some seconds of game time.', outputs: [{ pin: 'out', label: 'then' }], defaults: { seconds: 1 } },
  { id: 'call', label: 'Call function', help: 'Runs a function from this scene and carries on when it is finished.', outputs: [{ pin: 'out', label: 'next' }], defaults: { function: '' } },
];

export const graphNodeKind = (id: string): GraphNodeKind | undefined => GRAPH_NODE_KINDS.find((k) => k.id === id);

const MAX_STEPS = 4000;
const MAX_DEPTH = 24;

interface Run {
  ctx: SimContext;
  graph: GraphData;
  steps: number;
  depth: number;
}

const conditionsOf = (n: GraphNodeData): EventCondition[] => (Array.isArray(n.params.conditions) ? (n.params.conditions as EventCondition[]) : []);
const modeOf = (n: GraphNodeData): 'all' | 'any' => (n.params.mode === 'any' ? 'any' : 'all');
const key = (g: GraphData, n: GraphNodeData, extra = ''): string => `g:${g.id}:${n.id}${extra}`;

/** The boxes a pin leads to, in the order the lines were drawn. */
export function graphSuccessors(g: GraphData, node: string, pin: string): GraphNodeData[] {
  const out: GraphNodeData[] = [];
  for (const l of g.links) {
    if (l.from.node !== node || l.from.pin !== pin) continue;
    const to = g.nodes.find((n) => n.id === l.to.node);
    if (to) out.push(to);
  }
  return out;
}

function follow(run: Run, from: GraphNodeData, pin: string, picked: Entity | undefined): void {
  for (const next of graphSuccessors(run.graph, from.id, pin)) runNode(run, next, picked);
}

/** What a box says, in plain English (for the breakpoint report and the graph's tooltips). */
export function describeGraphNode(n: GraphNodeData): string {
  switch (n.type) {
    case 'event':
      return `when ${conditionsOf(n).map((c) => describeCondition(c)).join(modeOf(n) === 'any' ? ' or ' : ' and ') || 'always'}`;
    case 'action':
      return n.params.action ? describeAction(n.params.action as EventAction) : 'do nothing';
    case 'branch':
      return `if ${conditionsOf(n).map((c) => describeCondition(c)).join(modeOf(n) === 'any' ? ' or ' : ' and ') || 'always'}`;
    case 'loop':
      return `repeat ${Number(n.params.count ?? 1)} times`;
    case 'forEach':
      return `for each ${String(n.params.over ?? '')}`;
    case 'delay':
      return `wait ${Number(n.params.seconds ?? 0)} s`;
    case 'call':
      return `call "${String(n.params.function ?? '')}"`;
    case 'function':
      return `function "${String(n.params.name ?? '')}"`;
    default:
      return n.type;
  }
}

function runNode(run: Run, node: GraphNodeData, picked: Entity | undefined): void {
  const { ctx, graph } = run;
  if (++run.steps > MAX_STEPS) {
    if (run.steps === MAX_STEPS + 1) ctx.events.emit('problem', { text: `The graph "${graph.name}" ran more than ${MAX_STEPS} boxes in one tick (a loop that never ends?), so it was cut short.` });
    return;
  }
  noteFired(ctx, key(graph, node, '#ran'), node.breakpoint, `${graph.name}: ${describeGraphNode(node)}`);
  switch (node.type) {
    case 'action': {
      const a = node.params.action as EventAction | undefined;
      if (a) runActionList(ctx, [a], picked);
      follow(run, node, 'out', picked);
      break;
    }
    case 'branch': {
      const truth = testConditionList(ctx, conditionsOf(node), modeOf(node), picked);
      let pass = truth;
      if (node.params.once === true) {
        const st = (ctx.runtime.rowState[key(graph, node, picked ? `@${picked.id}` : '')] ??= { prev: false, timer: 0 });
        pass = truth && !st.prev;
        st.prev = truth;
      }
      if (pass) follow(run, node, 'true', picked);
      else if (!truth || node.params.once !== true) follow(run, node, 'false', picked);
      break;
    }
    case 'loop': {
      const n = Math.max(0, Math.min(1000, Math.floor(Number(node.params.count ?? 1))));
      for (let i = 0; i < n; i++) follow(run, node, 'body', picked);
      follow(run, node, 'done', picked);
      break;
    }
    case 'forEach': {
      const over = String(node.params.over ?? '');
      if (over.startsWith('table:')) {
        const name = over.slice(6);
        const count = ctx.assets.tables.get(name)?.rows.length ?? 0;
        for (let i = 0; i < count; i++) withTableRow(ctx, name, i, () => follow(run, node, 'body', picked));
      } else {
        for (const e of resolveRef(ctx, over, picked)) follow(run, node, 'body', e);
      }
      follow(run, node, 'done', picked);
      break;
    }
    case 'delay': {
      const st = (ctx.runtime.rowState[key(graph, node)] ??= { prev: false, timer: 0 });
      st.prev = true;
      st.timer = Math.max(0, Number(node.params.seconds ?? 0));
      if (st.timer === 0) {
        st.prev = false;
        follow(run, node, 'out', picked);
      }
      break;
    }
    case 'call': {
      const name = String(node.params.function ?? '');
      const fn = run.ctx.runtime.graphs.flatMap((g) => g.nodes.filter((n) => n.type === 'function' && n.params.name === name).map((n) => ({ g, n })))[0];
      if (!fn) {
        ctx.events.emit('problem', { text: `The graph "${graph.name}" calls a function "${name}" that does not exist.` });
      } else if (run.depth < MAX_DEPTH) {
        const inner: Run = { ctx, graph: fn.g, steps: run.steps, depth: run.depth + 1 };
        follow(inner, fn.n, 'out', picked);
        run.steps = inner.steps;
      }
      follow(run, node, 'out', picked);
      break;
    }
    default:
      break;
  }
}

/** Runs every enabled graph: waits that are over carry on, and each event box whose conditions hold starts its flow. */
export function graphSystem(ctx: SimContext): void {
  for (const graph of ctx.runtime.graphs) {
    if (!graph.enabled) continue;
    const run: Run = { ctx, graph, steps: 0, depth: 0 };
    for (const node of graph.nodes) {
      if (node.type === 'delay') {
        const st = ctx.runtime.rowState[key(graph, node)];
        if (st?.prev) {
          st.timer -= ctx.dt;
          if (st.timer <= 0) {
            st.prev = false;
            follow(run, node, 'out', undefined);
          }
        }
      }
    }
    for (const node of graph.nodes) {
      if (node.type !== 'event') continue;
      const truth = testConditionList(ctx, conditionsOf(node), modeOf(node), undefined);
      const st = (ctx.runtime.rowState[key(graph, node)] ??= { prev: false, timer: 0 });
      const fire = node.params.once === false ? truth : truth && !st.prev;
      st.prev = truth;
      if (fire) {
        noteFired(ctx, key(graph, node, '#ran'), node.breakpoint, `${graph.name}: ${describeGraphNode(node)}`);
        follow(run, node, 'out', undefined);
      }
    }
  }
}

// ---------- checking ----------

export interface GraphProblem {
  graph: string;
  node?: string;
  /** Index of the line the problem is about. */
  link?: number;
  text: string;
}

/** Mistakes in graphs that would stop them from doing what they say, in plain English. */
export function checkGraphs(graphs: readonly GraphData[]): GraphProblem[] {
  const out: GraphProblem[] = [];
  const functions = new Set(graphs.flatMap((g) => g.nodes.filter((n) => n.type === 'function').map((n) => String(n.params.name ?? ''))));
  for (const g of graphs) {
    const ids = new Set(g.nodes.map((n) => n.id));
    g.links.forEach((l, link) => {
      if (!ids.has(l.from.node) || !ids.has(l.to.node)) out.push({ graph: g.id, link, text: `In "${g.name}" a line joins a box that was deleted.` });
    });
    for (const n of g.nodes) {
      const kind = graphNodeKind(n.type);
      if (!kind) {
        out.push({ graph: g.id, node: n.id, text: `In "${g.name}" a box of type "${n.type}" is not known to this version of Tilewright.` });
        continue;
      }
      if (!kind.entry && !g.links.some((l) => l.to.node === n.id)) out.push({ graph: g.id, node: n.id, text: `In "${g.name}" the box "${describeGraphNode(n)}" has nothing leading into it, so it never runs.` });
      if (n.type === 'action') {
        const a = n.params.action as EventAction | undefined;
        if (!a || !actionDef(a.type)) out.push({ graph: g.id, node: n.id, text: `In "${g.name}" a box does an action that is missing${a ? ` ("${a.type}": its pack may be switched off)` : ''}.` });
      }
      if (n.type === 'event' || n.type === 'branch') {
        for (const c of conditionsOf(n)) if (!conditionDef(c.type)) out.push({ graph: g.id, node: n.id, text: `In "${g.name}" a box checks a condition that is missing ("${c.type}").` });
      }
      if (n.type === 'call' && !functions.has(String(n.params.function ?? ''))) out.push({ graph: g.id, node: n.id, text: `In "${g.name}" a Call box calls "${String(n.params.function ?? '')}", which does not exist.` });
      if (kind.entry && n.type === 'event' && !g.links.some((l) => l.from.node === n.id)) out.push({ graph: g.id, node: n.id, text: `In "${g.name}" the box "${describeGraphNode(n)}" does not lead anywhere, so nothing happens.` });
    }
  }
  return out;
}
