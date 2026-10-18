import type { EventAction, EventCondition, EventRow, GraphData, GraphNodeData } from '@tilewright/runtime';
import { describeGraphNode, graphSuccessors } from './graph';

/**
 * Event sheet rows to a graph and back. Rows to a graph always works. A graph to rows works when it has the shape of a
 * sheet: events leading to actions, with branches after the actions, a "repeat" first or a "for each" at the top. A graph
 * with waits, calls or loops in the middle says exactly which box does not fit, and nothing is changed.
 */

type IdMaker = (prefix: string) => string;

const ALWAYS: EventCondition = { type: 'always', params: {}, negate: false };

export function rowsToGraph(rows: readonly EventRow[], newId: IdMaker, name = 'Event sheet'): { graph: GraphData; skipped: number } {
  const graph: GraphData = { id: newId('g'), name, enabled: true, nodes: [], links: [] };
  let skipped = 0;
  const add = (type: string, params: Record<string, unknown>, x: number, y: number): GraphNodeData => {
    const n: GraphNodeData = { id: newId('n'), type, x, y, params, breakpoint: false, comment: '' };
    graph.nodes.push(n);
    return n;
  };
  const link = (from: GraphNodeData, pin: string, to: GraphNodeData): void => void graph.links.push({ from: { node: from.id, pin }, to: { node: to.id, pin: 'in' } });
  const STEP = 250;
  const ROW = 120;
  let y = 0;

  /** The actions of a row after its gate: an optional repeat, then one box per action. Returns how far down it went. */
  const actionsAfter = (row: EventRow, gate: GraphNodeData, pin: string, x: number, atY: number): void => {
    if (row.actions.length === 0) return;
    let from = gate;
    let fromPin = pin;
    let cx = x;
    if (row.repeat > 1) {
      const loop = add('loop', { count: row.repeat }, cx, atY);
      link(from, fromPin, loop);
      from = loop;
      fromPin = 'body';
      cx += STEP;
    }
    for (const a of row.actions) {
      const n = add('action', { action: structuredClone(a) }, cx, atY);
      link(from, fromPin, n);
      from = n;
      fromPin = 'out';
      cx += STEP;
    }
  };

  const gateFor = (row: EventRow, from: { node: GraphNodeData; pin: string } | null, once: boolean, x: number, atY: number): { node: GraphNodeData; pin: string } => {
    if (!from) {
      const e = add('event', { conditions: structuredClone(row.conditions), mode: row.mode, once }, x, atY);
      return { node: e, pin: 'out' };
    }
    const b = add('branch', { conditions: structuredClone(row.conditions), mode: row.mode, once }, x, atY);
    link(from.node, from.pin, b);
    return { node: b, pin: 'true' };
  };

  const emit = (row: EventRow, from: { node: GraphNodeData; pin: string } | null, x: number, atY: number): number => {
    let used = ROW;
    let origin = from;
    let ox = x;
    if (!from && row.forEach) {
      const e = add('event', { conditions: [structuredClone(ALWAYS)], mode: 'all', once: false }, x, atY);
      const f = add('forEach', { over: row.forEach }, x + STEP, atY);
      link(e, 'out', f);
      origin = { node: f, pin: 'body' };
      ox = x + STEP * 2;
    } else if (from && row.forEach) {
      const f = add('forEach', { over: row.forEach }, x, atY);
      link(from.node, from.pin, f);
      origin = { node: f, pin: 'body' };
      ox = x + STEP;
    }
    if (row.actions.length > 0) {
      const gate = gateFor(row, origin, row.once, ox, atY);
      actionsAfter(row, gate.node, gate.pin, ox + STEP, atY);
    }
    if (row.children.length > 0) {
      // children run whenever the parent holds (not only on the tick it became true), so they hang from a gate of their own
      const gate = gateFor(row, origin, false, ox, atY + (row.actions.length > 0 ? ROW : 0));
      let cy = atY + (row.actions.length > 0 ? ROW : 0);
      for (const c of row.children) {
        if (!c.enabled) {
          skipped++;
          continue;
        }
        const h = emit(c, gate, ox + STEP, cy);
        cy += h;
      }
      used = Math.max(used, cy - atY);
    }
    return used;
  };

  for (const row of rows) {
    if (!row.enabled) {
      skipped++;
      continue;
    }
    y += emit(row, null, 0, y);
  }
  return { graph, skipped };
}

export interface GraphToRows {
  rows: EventRow[];
  /** Why part of the graph could not become rows ("" = all of it did). */
  problems: string[];
}

class Unfit extends Error {}

/** The rows a graph says, or the boxes that do not fit a sheet. */
export function graphToRows(graph: GraphData, newId: IdMaker): GraphToRows {
  const problems: string[] = [];
  const rows: EventRow[] = [];
  const base = (over: Partial<EventRow>): EventRow => ({ id: newId('r'), enabled: true, comment: '', mode: 'all', once: false, forEach: '', breakpoint: false, repeat: 1, conditions: [], actions: [], children: [], ...over });
  const conds = (n: GraphNodeData): EventCondition[] => (Array.isArray(n.params.conditions) ? structuredClone(n.params.conditions as EventCondition[]) : []);
  const modeOf = (n: GraphNodeData): 'all' | 'any' => (n.params.mode === 'any' ? 'any' : 'all');

  /** Boxes after a pin as an ordered list of actions, an optional repeat and the branches that follow. */
  const flow = (from: GraphNodeData, pin: string): { actions: EventAction[]; repeat: number; children: EventRow[] } => {
    const actions: EventAction[] = [];
    const children: EventRow[] = [];
    let repeat = 1;
    const walk = (node: GraphNodeData, first: boolean): void => {
      switch (node.type) {
        case 'action':
          if (children.length > 0) throw new Unfit(`"${describeGraphNode(node)}" comes after an "if", but a sheet runs its actions before its sub-events`);
          if (node.params.action) actions.push(structuredClone(node.params.action as EventAction));
          for (const n of graphSuccessors(graph, node.id, 'out')) walk(n, false);
          break;
        case 'loop': {
          if (!first || actions.length > 0 || children.length > 0) throw new Unfit(`"${describeGraphNode(node)}" is not the first thing in its flow, and a sheet can only repeat all of a row's actions`);
          if (graphSuccessors(graph, node.id, 'done').length > 0) throw new Unfit(`"${describeGraphNode(node)}" has something after it finishes, and a sheet cannot do that`);
          const inner = flow(node, 'body');
          if (inner.children.length > 0 || inner.repeat !== 1) throw new Unfit(`"${describeGraphNode(node)}" has an "if" or another repeat inside it`);
          repeat = Math.max(1, Math.min(100, Math.floor(Number(node.params.count ?? 1))));
          actions.push(...inner.actions);
          break;
        }
        case 'branch': {
          if (graphSuccessors(graph, node.id, 'false').length > 0) throw new Unfit(`"${describeGraphNode(node)}" does something when it is not true, and a sheet row only has the true side (add a second event with NOT)`);
          const inner = flow(node, 'true');
          children.push(base({ conditions: conds(node), mode: modeOf(node), once: node.params.once === true, actions: inner.actions, repeat: inner.repeat, children: inner.children }));
          break;
        }
        default:
          throw new Unfit(`"${describeGraphNode(node)}" cannot be shown in an event sheet (only events, actions, repeats at the start and "if" after the actions can)`);
      }
    };
    for (const n of graphSuccessors(graph, from.id, pin)) walk(n, true);
    return { actions, repeat, children };
  };

  for (const node of graph.nodes) {
    if (node.type !== 'event') continue;
    try {
      const out = graphSuccessors(graph, node.id, 'out');
      const c = conds(node);
      const isAlways = c.length === 1 && c[0]!.type === 'always' && !c[0]!.negate;
      const loop = out.length === 1 && out[0]!.type === 'forEach' ? out[0]! : null;
      if (loop && isAlways && node.params.once === false) {
        // event(always) -> for each -> boxes: one row per branch, each looping over the same things
        if (graphSuccessors(graph, loop.id, 'done').length > 0) throw new Unfit(`"${describeGraphNode(loop)}" has something after it finishes, and a sheet cannot do that`);
        for (const b of graphSuccessors(graph, loop.id, 'body')) {
          if (b.type !== 'branch') throw new Unfit(`"${describeGraphNode(b)}" is inside a "for each" without an "if", and a sheet row needs its conditions`);
          if (graphSuccessors(graph, b.id, 'false').length > 0) throw new Unfit(`"${describeGraphNode(b)}" does something when it is not true, and a sheet row only has the true side`);
          const inner = flow(b, 'true');
          rows.push(base({ forEach: String(loop.params.over ?? ''), conditions: conds(b), mode: modeOf(b), once: b.params.once === true, actions: inner.actions, repeat: inner.repeat, children: inner.children }));
        }
        continue;
      }
      const inner = flow(node, 'out');
      rows.push(base({ conditions: c.length > 0 ? c : [structuredClone(ALWAYS)], mode: modeOf(node), once: node.params.once !== false, actions: inner.actions, repeat: inner.repeat, children: inner.children }));
    } catch (e) {
      if (!(e instanceof Unfit)) throw e;
      problems.push(`The event "${describeGraphNode(node)}": ${e.message}.`);
    }
  }
  for (const n of graph.nodes) if (n.type === 'function') problems.push(`The function "${String(n.params.name ?? '')}" has no place in an event sheet.`);
  return { rows, problems };
}
