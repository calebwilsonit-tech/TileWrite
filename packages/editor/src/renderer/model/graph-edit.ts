import { actionPinsOf, graphNodeKind, newAction, newCondition, type ActionNode, type EventNode, GRAPH_NODE_KINDS } from '@tilewright/behaviors';
import type { EntityData, EventAction, EventCondition, GraphData, GraphNodeData } from '@tilewright/runtime';
import type { EditorDoc } from './doc';
import { eventNodeFor, ownedNodes, quickOf } from './logic-edit';

/** Pure edits of logic graphs. The graph editor calls these and hands the result to `doc.setGraphs` (one undo step each). */

export type Graphs = readonly GraphData[];

const replace = (graphs: Graphs, id: string, fn: (g: GraphData) => GraphData): GraphData[] => graphs.map((g) => (g.id === id ? fn(structuredClone(g)) : structuredClone(g)));

let counter = 0;
/** An id that is not used by any box of the graph. */
export function freeNodeId(g: GraphData): string {
  const used = new Set(g.nodes.map((n) => n.id));
  let id = `n${++counter}`;
  while (used.has(id)) id = `n${++counter}`;
  return id;
}

export function newGraph(graphs: Graphs, name: string): { graphs: GraphData[]; id: string } {
  let n = graphs.length + 1;
  while (graphs.some((g) => g.id === `g${n}`)) n++;
  const id = `g${n}`;
  return { id, graphs: [...structuredClone(graphs as GraphData[]), { id, name, enabled: true, nodes: [], links: [] }] };
}

export function defaultParams(type: string): Record<string, unknown> {
  return structuredClone(graphNodeKind(type)?.defaults ?? {});
}

export function addNode(graphs: Graphs, graphId: string, type: string, x: number, y: number, params?: Record<string, unknown>): { graphs: GraphData[]; id: string } {
  let id = '';
  const next = replace(graphs, graphId, (g) => {
    id = freeNodeId(g);
    g.nodes.push({ id, type, x: Math.round(x), y: Math.round(y), params: params ?? defaultParams(type), breakpoint: false, comment: '' });
    return g;
  });
  return { graphs: next, id };
}

export function updateNode(graphs: Graphs, graphId: string, nodeId: string, fn: (n: GraphNodeData) => void): GraphData[] {
  return replace(graphs, graphId, (g) => {
    const n = g.nodes.find((x) => x.id === nodeId);
    if (n) fn(n);
    return g;
  });
}

export function moveNodes(graphs: Graphs, graphId: string, ids: readonly string[], dx: number, dy: number): GraphData[] {
  return replace(graphs, graphId, (g) => {
    for (const n of g.nodes) {
      if (!ids.includes(n.id)) continue;
      n.x = Math.round(n.x + dx);
      n.y = Math.round(n.y + dy);
    }
    return g;
  });
}

/** Whether a line from a box's output pin to another box makes sense (and why not). */
export function canLink(g: GraphData, from: string, pin: string, to: string): string | null {
  const a = g.nodes.find((n) => n.id === from);
  const b = g.nodes.find((n) => n.id === to);
  if (!a || !b) return 'One of the boxes is gone.';
  if (from === to) return 'A box cannot lead into itself.';
  if (!graphNodeKind(a.type)?.outputs.some((o) => o.pin === pin)) return `"${graphNodeKind(a.type)?.label ?? a.type}" has no "${pin}" output.`;
  if (graphNodeKind(b.type)?.entry) return `Nothing can lead into a "${graphNodeKind(b.type)!.label}" box: it starts a flow.`;
  if (g.links.some((l) => l.from.node === from && l.from.pin === pin && l.to.node === to)) return 'Those two are already joined.';
  // a flow that loops back on itself would never end
  const seen = new Set<string>();
  const stack = [to];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === from) return 'That would make the flow go round in a circle. Use a Repeat box for loops.';
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const l of g.links) if (l.from.node === cur) stack.push(l.to.node);
  }
  return null;
}

export function addLink(graphs: Graphs, graphId: string, from: string, pin: string, to: string): GraphData[] {
  return replace(graphs, graphId, (g) => {
    if (canLink(g, from, pin, to) === null) g.links.push({ from: { node: from, pin }, to: { node: to, pin: 'in' } });
    return g;
  });
}

export function removeLink(graphs: Graphs, graphId: string, index: number): GraphData[] {
  return replace(graphs, graphId, (g) => {
    g.links.splice(index, 1);
    return g;
  });
}

export function removeNodes(graphs: Graphs, graphId: string, ids: readonly string[]): GraphData[] {
  return replace(graphs, graphId, (g) => {
    g.nodes = g.nodes.filter((n) => !ids.includes(n.id));
    g.links = g.links.filter((l) => !ids.includes(l.from.node) && !ids.includes(l.to.node));
    return g;
  });
}

/**
 * Collapse a connected group of boxes into a function of its own and put one Call box in its place. The group needs one way
 * in (a box that something outside leads to, or the only box without an entry) and at most one way out.
 */
export function collapseToFunction(graphs: Graphs, graphId: string, ids: readonly string[], name: string): { graphs: GraphData[]; problem?: string; functionId?: string } {
  const g = graphs.find((x) => x.id === graphId);
  if (!g) return { graphs: structuredClone(graphs as GraphData[]), problem: 'That graph is gone.' };
  const set = new Set(ids);
  const inside = g.nodes.filter((n) => set.has(n.id));
  if (inside.length === 0) return { graphs: structuredClone(graphs as GraphData[]), problem: 'Select the boxes to collapse first.' };
  if (inside.some((n) => graphNodeKind(n.type)?.entry)) return { graphs: structuredClone(graphs as GraphData[]), problem: 'An event or function box cannot be collapsed (it starts a flow).' };
  const entering = g.links.filter((l) => !set.has(l.from.node) && set.has(l.to.node));
  const leaving = g.links.filter((l) => set.has(l.from.node) && !set.has(l.to.node));
  const entryIds = new Set(entering.map((l) => l.to.node));
  const hasIncoming = new Set(g.links.filter((l) => set.has(l.to.node) && set.has(l.from.node)).map((l) => l.to.node));
  for (const n of inside) if (!hasIncoming.has(n.id)) entryIds.add(n.id);
  if (entryIds.size !== 1) return { graphs: structuredClone(graphs as GraphData[]), problem: `The selection needs exactly one way in, and it has ${entryIds.size}.` };
  if (new Set(leaving.map((l) => `${l.from.node}/${l.from.pin}/${l.to.node}`)).size > 1) return { graphs: structuredClone(graphs as GraphData[]), problem: 'The selection has more than one way out. Select fewer boxes.' };
  const entry = inside.find((n) => entryIds.has(n.id))!;
  if (graphs.some((x) => x.nodes.some((n) => n.type === 'function' && n.params.name === name))) return { graphs: structuredClone(graphs as GraphData[]), problem: `There is already a function called "${name}".` };

  const minX = Math.min(...inside.map((n) => n.x));
  const minY = Math.min(...inside.map((n) => n.y));
  const made = newGraph(graphs, `Function: ${name}`);
  const fnGraph = made.graphs.find((x) => x.id === made.id)!;
  fnGraph.nodes.push({ id: 'fn', type: 'function', x: 0, y: 0, params: { name }, breakpoint: false, comment: '' });
  for (const n of inside) fnGraph.nodes.push({ ...structuredClone(n), x: n.x - minX + 260, y: n.y - minY });
  fnGraph.links.push({ from: { node: 'fn', pin: 'out' }, to: { node: entry.id, pin: 'in' } });
  for (const l of g.links) if (set.has(l.from.node) && set.has(l.to.node)) fnGraph.links.push(structuredClone(l));

  const callId = freeNodeId(g);
  const out = made.graphs.map((x) => {
    if (x.id !== graphId) return x;
    const copy = structuredClone(x);
    copy.nodes = copy.nodes.filter((n) => !set.has(n.id));
    copy.nodes.push({ id: callId, type: 'call', x: entry.x, y: entry.y, params: { function: name }, breakpoint: false, comment: '' });
    copy.links = copy.links
      .filter((l) => !(set.has(l.from.node) && set.has(l.to.node)))
      .filter((l) => !(set.has(l.from.node) && !set.has(l.to.node)))
      .map((l) => (set.has(l.to.node) ? { ...l, to: { node: callId, pin: 'in' } } : l));
    const exit = leaving[0];
    if (exit) copy.links.push({ from: { node: callId, pin: 'out' }, to: { node: exit.to.node, pin: 'in' } });
    return copy;
  });
  return { graphs: out, functionId: made.id };
}

// ---------- from wires and quick actions ----------

const mkNode = (g: GraphData, type: string, x: number, y: number, params: Record<string, unknown>): GraphNodeData => {
  const n: GraphNodeData = { id: freeNodeId(g), type, x, y, params, breakpoint: false, comment: '' };
  g.nodes.push(n);
  return n;
};

/**
 * The wires and nodes made for one object's event, as a graph: an event box (the signal or condition), then one box per
 * action. `remove` lists what the editor deletes in exchange, so the logic does not run twice.
 */
export function wiresToGraph(doc: EditorDoc, ownerId: string, pinId: string, newId: string): { graph: GraphData; remove: string[] } | null {
  const owner = doc.getEntity(ownerId);
  const node = ownedNodes(doc, ownerId).find((n) => quickOf(n)!.role === 'actions' && quickOf(n)!.pin === pinId);
  if (!owner || !node) return null;
  const actions = (node.components.actionNode as ActionNode).actions;
  const eventNode = eventNodeFor(doc, ownerId, pinId);
  const g: GraphData = { id: newId, name: `${owner.name}: ${pinId.split('.').pop() ?? pinId}`, enabled: true, nodes: [], links: [] };
  let conditions: EventCondition[];
  if (eventNode) {
    conditions = structuredClone((eventNode.components.eventNode as EventNode).conditions);
  } else {
    const output = doc.wires.find((w) => w.to.entity === node.id && w.to.input === 'do')?.from.output ?? pinId.split('.').pop() ?? '';
    conditions = [{ ...newCondition('signal'), params: { who: `id:${ownerId}`, side: 'output', name: output, state: 'on' } }];
  }
  const ev = mkNode(g, 'event', 0, 0, { conditions, mode: eventNode ? ((eventNode.components.eventNode as EventNode).mode ?? 'all') : 'all', once: true });
  let prev: GraphNodeData = ev;
  actions.forEach((a, i) => {
    const n = mkNode(g, 'action', 280 * (i + 1), 0, { action: structuredClone(a) });
    g.links.push({ from: { node: prev.id, pin: 'out' }, to: { node: n.id, pin: 'in' } });
    prev = n;
  });
  return { graph: g, remove: [node.id, ...(eventNode ? [eventNode.id] : [])] };
}

/** Make the nodes' actions into a flow of boxes (for a graph that starts from a free-standing action node). */
export function actionNodeToBoxes(entity: EntityData): EventAction[] {
  return structuredClone((entity.components.actionNode as ActionNode | undefined)?.actions ?? []);
}

/** The pick-list for the search box: every kind of box, every action, every condition, with the words to match. */
export interface BoxChoice {
  id: string;
  label: string;
  group: string;
  make(): { type: string; params: Record<string, unknown> };
}

export function boxChoices(actionList: readonly { id: string; label: string; category: string }[], conditionList: readonly { id: string; label: string; category: string }[]): BoxChoice[] {
  const out: BoxChoice[] = [];
  for (const k of GRAPH_NODE_KINDS) {
    if (k.id === 'action') continue;
    out.push({ id: `kind.${k.id}`, label: `${k.label} (${k.help.split('.')[0]})`, group: 'Flow', make: () => ({ type: k.id, params: defaultParams(k.id) }) });
  }
  for (const a of actionList) out.push({ id: `do.${a.id}`, label: `Do: ${a.label}`, group: a.category, make: () => ({ type: 'action', params: { action: newAction(a.id) } }) });
  for (const c of conditionList) {
    out.push({ id: `when.${c.id}`, label: `When: ${c.label}`, group: c.category, make: () => ({ type: 'event', params: { conditions: [newCondition(c.id)], mode: 'all', once: true } }) });
    out.push({ id: `if.${c.id}`, label: `If: ${c.label}`, group: c.category, make: () => ({ type: 'branch', params: { conditions: [newCondition(c.id)], mode: 'all', once: false } }) });
  }
  return out;
}

/** Ready-made boxes for one object: everything it can be told to do ("Gate: Open"), so the picker only offers what is valid for it. */
export function targetChoices(entity: EntityData): BoxChoice[] {
  return actionPinsOf(entity.components).map((p) => ({ id: `obj.${entity.id}.${p.id}`, label: `${entity.name}: ${p.label}`, group: entity.name, make: () => ({ type: 'action', params: { action: p.make(`id:${entity.id}`) } }) }));
}

/** Open a quick action's (or a wire's) logic as a graph, in exchange for its nodes: one undo step. */
export function openAsGraph(doc: EditorDoc, ownerId: string, pinId: string): string | null {
  let n = doc.graphs.length + 1;
  while (doc.graphs.some((g) => g.id === `g${n}`)) n++;
  const made = wiresToGraph(doc, ownerId, pinId, `g${n}`);
  if (!made) return null;
  const id = made.graph.id;
  doc.history.batch('Open as a graph', () => {
    doc.setGraphs('Add the graph', [...doc.graphs, made.graph]);
    doc.removeEntities(made.remove, 'Replace the nodes with the graph');
  });
  return id;
}

/** Search-as-you-type: every word typed has to appear somewhere in the label or group. */
export function searchBoxes(choices: readonly BoxChoice[], text: string): BoxChoice[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return choices.slice(0, 40);
  return choices.filter((c) => words.every((w) => `${c.label} ${c.group}`.toLowerCase().includes(w))).slice(0, 40);
}
