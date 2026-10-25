import { DialogueSchema, GraphSchema, type DialogueData, type GraphData } from '@tilewright/runtime';
import { Canvas, clip, shade } from './canvas';

/**
 * Boxes and arrows for the project's graphs: a scene's logic graphs (drawn where the person put the boxes) and conversations
 * (laid out left to right in steps). Pure data in, a picture and a few lines of words out.
 */

export interface GNode {
  id: string;
  label: string;
  color: number;
  /** Where the person placed it (a logic graph); otherwise the layout decides. */
  x?: number;
  y?: number;
  start?: boolean;
}
export interface GEdge {
  from: string;
  to: string;
  label?: string;
}

export interface GraphPicture {
  png: Uint8Array;
  width: number;
  height: number;
  title: string;
  notes: string[];
}

const MOST_NODES = 90;

export function renderGraph(title: string, nodes: readonly GNode[], edges: readonly GEdge[], extraNotes: readonly string[] = []): GraphPicture {
  const shown = nodes.slice(0, MOST_NODES);
  const ids = new Set(shown.map((n) => n.id));
  const es = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const sizeOf = (n: GNode): { w: number; h: number } => ({ w: Math.max(54, new Canvas(1, 1, null).textWidth(n.label) + 12), h: 20 });

  const pos = new Map<string, { x: number; y: number }>(); // top-left corners
  const placed = shown.every((n) => n.x !== undefined && n.y !== undefined);
  if (placed) {
    const minX = Math.min(...shown.map((n) => n.x!));
    const minY = Math.min(...shown.map((n) => n.y!));
    // the person's own spacing, squeezed when it is much wider than a screen
    const maxX = Math.max(...shown.map((n) => n.x! + sizeOf(n).w));
    const k = Math.min(1, 1200 / Math.max(1, maxX - minX));
    for (const n of shown) pos.set(n.id, { x: 20 + (n.x! - minX) * k, y: 28 + (n.y! - minY) * k });
  } else {
    layered(shown, es, sizeOf, pos);
  }
  let width = 40;
  let height = 48;
  for (const n of shown) {
    const p = pos.get(n.id)!;
    width = Math.max(width, p.x + sizeOf(n).w + 20);
    height = Math.max(height, p.y + sizeOf(n).h + 20);
  }
  const c = new Canvas(Math.ceil(width), Math.ceil(height));
  c.text(8, 8, clip(title, 60), 0x9fb3d0);
  const byId = new Map(shown.map((n) => [n.id, n]));
  for (const e of es) {
    const a = pos.get(e.from)!;
    const b = pos.get(e.to)!;
    const sa = sizeOf(byId.get(e.from)!);
    const sb = sizeOf(byId.get(e.to)!);
    const forward = b.x >= a.x + sa.w - 1;
    const ax = forward ? a.x + sa.w : a.x + sa.w / 2;
    const ay = forward ? a.y + sa.h / 2 : a.y + sa.h;
    const bx = forward ? b.x : b.x + sb.w / 2;
    const by = forward ? b.y + sb.h / 2 : b.y;
    c.arrow(ax, ay, bx, by, forward ? 0x8a93a8 : 0xd08a50);
    if (e.label) c.label((ax + bx) / 2 - c.textWidth(clip(e.label, 10)) / 2, (ay + by) / 2 - 3, clip(e.label, 10), 0xcfd6e6);
  }
  for (const n of shown) {
    const p = pos.get(n.id)!;
    const s = sizeOf(n);
    c.rect(p.x, p.y, s.w, s.h, n.color);
    c.strokeRect(p.x, p.y, s.w, s.h, n.start ? 0xffffff : shade(n.color, 1.5));
    c.text(p.x + 6, p.y + 7, n.label, 0xffffff);
  }
  const notes = [`Graph "${title}": ${nodes.length} box${nodes.length === 1 ? '' : 'es'}, ${edges.length} arrow${edges.length === 1 ? '' : 's'}${nodes.length > shown.length ? ` (the first ${shown.length} are drawn)` : ''}.`, ...extraNotes];
  return { png: c.toPng(), width: c.width, height: c.height, title, notes };
}

/** Steps left to right by the longest way from a start; within a step ordered by where the boxes pointing at them are. */
function layered(nodes: readonly GNode[], edges: readonly GEdge[], sizeOf: (n: GNode) => { w: number; h: number }, pos: Map<string, { x: number; y: number }>): void {
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const n of nodes) {
    out.set(n.id, []);
    into.set(n.id, []);
  }
  // arrows that go back to a box already on the way here are left out of the layering (they would make a loop)
  const layer = new Map<string, number>();
  const state = new Map<string, 1 | 2>();
  const forwardEdges: GEdge[] = [];
  const visit = (id: string): void => {
    state.set(id, 1);
    for (const e of edges.filter((x) => x.from === id)) {
      if (state.get(e.to) === 1) continue;
      forwardEdges.push(e);
      if (!state.has(e.to)) visit(e.to);
    }
    state.set(id, 2);
  };
  const roots = nodes.filter((n) => n.start).concat(nodes.filter((n) => !edges.some((e) => e.to === n.id)));
  for (const r of roots) if (!state.has(r.id)) visit(r.id);
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);
  for (const e of forwardEdges) {
    out.get(e.from)!.push(e.to);
    into.get(e.to)!.push(e.from);
  }
  const depth = (id: string, guard = 0): number => {
    if (layer.has(id)) return layer.get(id)!;
    if (guard > 200) return 0;
    layer.set(id, 0); // in progress
    const d = into.get(id)!.length === 0 ? 0 : 1 + Math.max(...into.get(id)!.map((p) => depth(p, guard + 1)));
    layer.set(id, d);
    return d;
  };
  for (const n of nodes) depth(n.id);
  const columns: string[][] = [];
  for (const n of nodes) (columns[layer.get(n.id)!] ??= []).push(n.id);
  const row = new Map<string, number>();
  columns.forEach((col) => col?.forEach((id, i) => row.set(id, i)));
  for (let pass = 0; pass < 2; pass++) {
    for (const col of columns) {
      if (!col) continue;
      const bary = (id: string): number => {
        const ps = into.get(id)!;
        return ps.length === 0 ? row.get(id)! : ps.reduce((s, p) => s + row.get(p)!, 0) / ps.length;
      };
      col.sort((a, b) => bary(a) - bary(b));
      col.forEach((id, i) => row.set(id, i));
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let x = 20;
  for (const col of columns) {
    if (!col) continue;
    const w = Math.max(...col.map((id) => sizeOf(byId.get(id)!).w));
    col.forEach((id, i) => pos.set(id, { x, y: 28 + i * 34 }));
    x += w + 56;
  }
}

// ---- what the project's graphs are made of ----

const KIND_COLORS: Record<string, number> = { event: 0x3a8f5c, start: 0x3a8f5c, branch: 0xa8802a, condition: 0xa8802a, end: 0x8f3a3a, delay: 0x6a4f9a, loop: 0x6a4f9a, call: 0x2f8a90, line: 0x3a5f94, choice: 0x7a4a8a, set: 0x4f6a3a, give: 0x4f6a3a, function: 0x2f8a90 };

function shortParam(params: Record<string, unknown>): string {
  for (const key of ['text', 'message', 'variable', 'name', 'target', 'scene', 'prefab', 'event', 'condition']) {
    const v = params[key];
    if (typeof v === 'string' && v) return v;
  }
  const first = Object.values(params).find((v) => typeof v === 'string' || typeof v === 'number');
  return first === undefined ? '' : String(first);
}

/** A scene's logic graph, in the places the boxes were put. */
export function graphPicture(input: unknown): GraphPicture | null {
  const g = GraphSchema.safeParse(input);
  if (!g.success) return null;
  return fromLogic(g.data);
}

export function fromLogic(g: GraphData): GraphPicture {
  const nodes: GNode[] = g.nodes.map((n) => ({ id: n.id, label: clip(`${n.type}${shortParam(n.params) ? `: ${shortParam(n.params)}` : ''}`, 30), color: KIND_COLORS[n.type] ?? 0x4a4f60, x: n.x, y: n.y }));
  const edges: GEdge[] = g.links.map((l) => ({ from: l.from.node, to: l.to.node, ...(l.from.pin !== 'out' && l.from.pin !== 'next' ? { label: l.from.pin } : {}) }));
  const notes = g.enabled ? [] : ['This graph is switched off.'];
  const breaks = g.nodes.filter((n) => n.breakpoint).length;
  if (breaks > 0) notes.push(`${breaks} box${breaks === 1 ? ' has' : 'es have'} a breakpoint.`);
  return renderGraph(g.name, nodes, edges, notes);
}

/** A conversation: lines, choices, branches and where each leads. */
export function dialoguePicture(input: unknown): GraphPicture | null {
  const d = DialogueSchema.safeParse(input);
  if (!d.success) return null;
  return fromDialogue(d.data);
}

export function fromDialogue(d: DialogueData): GraphPicture {
  const nodes: GNode[] = d.nodes.map((n) => {
    const what = n.type === 'line' ? `${n.speaker ? `${n.speaker}: ` : ''}${n.text}` : n.type === 'choice' ? n.prompt || 'choice' : n.type === 'set' ? `${n.variable} ${n.op}` : n.type === 'give' ? `${n.item} x${n.amount}` : n.type === 'branch' ? 'branch' : 'end';
    return { id: n.id, label: clip(n.type === 'line' ? what : `${n.type}: ${what}`, 34), color: KIND_COLORS[n.type] ?? 0x4a4f60, start: n.id === d.start };
  });
  const edges: GEdge[] = [];
  for (const n of d.nodes) {
    if (n.type === 'choice') n.options.forEach((o, i) => o.next && edges.push({ from: n.id, to: o.next, label: String(i + 1) }));
    else if (n.type === 'branch') {
      if (n.then) edges.push({ from: n.id, to: n.then, label: 'yes' });
      if (n.else) edges.push({ from: n.id, to: n.else, label: 'no' });
    } else if (n.type !== 'end' && n.next) edges.push({ from: n.id, to: n.next });
  }
  return renderGraph(d.name, nodes, edges, [`It starts at the box with the white outline ("${d.start}").`]);
}
