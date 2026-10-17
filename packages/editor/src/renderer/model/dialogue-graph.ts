import type { DialogueData, DialogueNode } from '@tilewright/runtime';

/** Size and spacing of the cards in the graph (pixels in graph space). */
export const NODE_W = 190;
export const NODE_H = 64;
const GAP_X = 70;
const GAP_Y = 28;

/** A card is taller when it has a row per option. */
export function nodeHeight(n: DialogueNode): number {
  return n.type === 'choice' ? 40 + 20 * Math.max(1, n.options.length) : NODE_H;
}

/** Where a link leaves a card, measured from the card's top-left corner. */
export function portOffset(n: DialogueNode, index: number): { x: number; y: number } {
  const h = nodeHeight(n);
  if (n.type === 'choice') return { x: NODE_W, y: 40 + 20 * index + 10 };
  if (n.type === 'branch') return { x: NODE_W, y: index === 0 ? h * 0.38 : h * 0.72 };
  return { x: NODE_W, y: h / 2 };
}

/** One or two lines of what the card says, for its body. */
export function summary(n: DialogueNode): string {
  switch (n.type) {
    case 'line':
      return `${n.speaker ? `${n.speaker}: ` : ''}${n.text || '(empty)'}`;
    case 'choice':
      return n.prompt || '(no question)';
    case 'set':
      return n.op === 'toggle' ? `flip ${n.variable || '(variable)'}` : `${n.op === 'add' ? 'add to' : 'set'} ${n.variable || '(variable)'} = ${String(n.value)}`;
    case 'give':
      return `${n.amount >= 0 ? 'give' : 'take'} ${Math.abs(n.amount)} ${n.item || '(item)'}`;
    case 'branch':
      return n.if.kind === 'item' ? `has ${n.if.atLeast}+ ${n.if.item || '(item)'}?` : `${n.if.name || '(variable)'} ${n.if.op} ${String(n.if.value)}?`;
    default:
      return 'The conversation ends';
  }
}

export type PortKind  = 'next' | 'option' | 'then' | 'else';

/** A place on a node where a link starts. */
export interface Port {
  kind: PortKind;
  /** For options: which one. */
  index?: number;
  label: string;
}

export interface Edge {
  from: string;
  port: Port;
  to: string;
}

/** The links a node can have going out of it. */
export function portsOf(n: DialogueNode): Port[] {
  switch (n.type) {
    case 'line':
    case 'set':
    case 'give':
      return [{ kind: 'next', label: 'then' }];
    case 'choice':
      return n.options.map((o, index) => ({ kind: 'option' as const, index, label: o.text || `option ${index + 1}` }));
    case 'branch':
      return [
        { kind: 'then', label: 'yes' },
        { kind: 'else', label: 'no' },
      ];
    default:
      return [];
  }
}

/** Where a link on a node goes (undefined when it goes nowhere yet). */
export function linkTarget(n: DialogueNode, p: Port): string | undefined {
  switch (n.type) {
    case 'line':
    case 'set':
    case 'give':
      return n.next;
    case 'choice':
      return p.index === undefined ? undefined : n.options[p.index]?.next;
    case 'branch':
      return p.kind === 'then' ? n.then : n.else;
    default:
      return undefined;
  }
}

/** Every link that goes to a node that exists. (A link to a missing node is a problem the checker reports.) */
export function edgesOf(d: DialogueData): Edge[] {
  const ids = new Set(d.nodes.map((n) => n.id));
  const out: Edge[] = [];
  for (const n of d.nodes) {
    for (const port of portsOf(n)) {
      const to = linkTarget(n, port);
      if (to && ids.has(to)) out.push({ from: n.id, port, to });
    }
  }
  return out;
}

/** Point a link at another node (or at nothing, when `to` is undefined). */
export function connect(d: DialogueData, from: string, port: Port, to: string | undefined): DialogueData {
  const nodes = d.nodes.map((n): DialogueNode => {
    if (n.id !== from) return n;
    switch (n.type) {
      case 'line':
      case 'set':
      case 'give':
        return { ...n, next: to };
      case 'choice':
        return { ...n, options: n.options.map((o, i) => (i === port.index ? { ...o, next: to } : o)) };
      case 'branch':
        return port.kind === 'then' ? { ...n, then: to } : { ...n, else: to };
      default:
        return n;
    }
  });
  return { ...d, nodes };
}

/** Nodes the conversation can reach from its start (others are drawn faded: nothing leads to them). */
export function reachable(d: DialogueData): Set<string> {
  const seen = new Set<string>();
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const stack = d.start ? [d.start] : [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    for (const e of edgesOf(d)) if (e.from === id) stack.push(e.to);
  }
  return seen;
}

/**
 * Where every node sits: nodes with a stored position keep it; the others go in columns by distance from the start
 * (start at the left), then unreachable ones in a row below.
 */
export function layout(d: DialogueData): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const edges = edgesOf(d);
  const depth = new Map<string, number>();
  const queue: string[] = d.start && d.nodes.some((n) => n.id === d.start) ? [d.start] : [];
  for (const id of queue) depth.set(id, 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    for (const e of edges) {
      if (e.from === id && !depth.has(e.to)) {
        depth.set(e.to, depth.get(id)! + 1);
        queue.push(e.to);
      }
    }
  }
  const columnY = new Map<number, number>();
  const place = (n: DialogueNode, column: number): { x: number; y: number } => {
    const y = columnY.get(column) ?? 0;
    columnY.set(column, y + nodeHeight(n) + GAP_Y);
    return { x: column * (NODE_W + GAP_X), y };
  };
  for (const n of d.nodes) {
    if (depth.has(n.id)) out.set(n.id, place(n, depth.get(n.id)!));
  }
  // nodes nothing leads to wait in rows under the rest, four to a row
  const used = Math.max(0, ...columnY.values());
  let spare = 0;
  for (const n of d.nodes) {
    if (depth.has(n.id)) continue;
    out.set(n.id, { x: (spare % 4) * (NODE_W + GAP_X), y: used + GAP_Y + Math.floor(spare / 4) * (NODE_H + GAP_Y) });
    spare++;
  }  for (const n of d.nodes) if (n.x !== undefined && n.y !== undefined) out.set(n.id, { x: n.x, y: n.y });
  return out;
}

export function moveNode(d: DialogueData, id: string, x: number, y: number): DialogueData {
  return { ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, x: Math.round(x), y: Math.round(y) } : n)) };
}

/** Remove a node and every link that pointed at it. */
export function removeNode(d: DialogueData, id: string): DialogueData {
  const stripped = d.nodes.filter((n) => n.id !== id).map((n): DialogueNode => {
    switch (n.type) {
      case 'line':
      case 'set':
      case 'give':
        return n.next === id ? { ...n, next: undefined } : n;
      case 'choice':
        return { ...n, options: n.options.map((o) => (o.next === id ? { ...o, next: undefined } : o)) };
      case 'branch':
        return { ...n, then: n.then === id ? undefined : n.then, else: n.else === id ? undefined : n.else };
      default:
        return n;
    }
  });
  return { ...d, nodes: stripped, start: d.start === id ? '' : d.start };
}

/** The graph's bounding box, for "fit to window". */
export function bounds(pos: Map<string, { x: number; y: number }>): { x: number; y: number; w: number; h: number } {
  if (pos.size === 0) return { x: 0, y: 0, w: NODE_W, h: NODE_H };
  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) + NODE_W - x, h: Math.max(...ys) + NODE_H - y };
}

/**
 * Where a new card goes: to the right of the card it will be linked from (moved down until it overlaps nothing), or
 * under everything when it is not linked from anywhere.
 */
export function spotForNew(d: DialogueData, from: string | undefined, height = NODE_H): { x: number; y: number } {
  const pos = layout(d);
  const origin = from ? pos.get(from) : undefined;
  if (!origin) {
    const b = bounds(pos);
    return { x: Math.round(b.x), y: Math.round(d.nodes.length === 0 ? 0 : b.y + b.h + GAP_Y) };
  }
  const x = origin.x + NODE_W + GAP_X;
  let y = origin.y;
  const clash = (): boolean =>
    d.nodes.some((n) => {
      const p = pos.get(n.id)!;
      return x < p.x + NODE_W && x + NODE_W > p.x && y < p.y + nodeHeight(n) + GAP_Y / 2 && y + height + GAP_Y / 2 > p.y;
    });
  while (clash()) y += NODE_H + GAP_Y;
  return { x: Math.round(x), y: Math.round(y) };
}
