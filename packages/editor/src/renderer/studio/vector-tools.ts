import { shapeBounds, type Box, type Pt, type VectorShape } from '@tilewright/runtime';

/** The handles drawn around a selected shape: eight on its box, and one on each point of a path. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | `p${number}`;

export interface Handle {
  id: HandleId;
  x: number;
  y: number;
}

/** Round to the nearest `step` (1 for whole pixels, 0.5 for finer paths). */
export const snap = (v: number, step = 1): number => Math.round(v / step) * step;

export function boxHandles(b: Box): Handle[] {
  const { x, y, w, h } = b;
  const mx = x + w / 2;
  const my = y + h / 2;
  return [
    { id: 'nw', x, y },
    { id: 'n', x: mx, y },
    { id: 'ne', x: x + w, y },
    { id: 'e', x: x + w, y: my },
    { id: 'se', x: x + w, y: y + h },
    { id: 's', x: mx, y: y + h },
    { id: 'sw', x, y: y + h },
    { id: 'w', x, y: my },
  ];
}

/** Every handle of a shape: path points first (so they win when they overlap the box), then the box. */
export function handlesOf(shape: VectorShape): Handle[] {
  const out: Handle[] = [];
  if (shape.type === 'path') shape.points.forEach((p, i) => out.push({ id: `p${i}`, x: p.x, y: p.y }));
  out.push(...boxHandles(shapeBounds({ ...shape, stroke: 0 })));
  return out;
}

/** The handle under a point, if any (`reach` is how close counts, in sprite pixels). */
export function handleAt(shape: VectorShape, x: number, y: number, reach: number): Handle | null {
  let best: Handle | null = null;
  let bestD = reach + 1e-9;
  for (const h of handlesOf(shape)) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/** The box that results from dragging one of its handles to (x, y); it never collapses below one pixel. */
export function dragBox(from: Box, id: HandleId, x: number, y: number): Box {
  let x0 = from.x;
  let y0 = from.y;
  let x1 = from.x + from.w;
  let y1 = from.y + from.h;
  // the letters say which sides the handle moves (a corner moves two, a side handle one)
  if (id.includes('w')) x0 = Math.min(x, x1 - 1);
  if (id.includes('e')) x1 = Math.max(x, x0 + 1);
  if (id.includes('n')) y0 = Math.min(y, y1 - 1);
  if (id.includes('s')) y1 = Math.max(y, y0 + 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Move one point of a path. */
export function movePoint(shape: VectorShape, index: number, to: Pt): VectorShape {
  if (shape.type !== 'path' || !shape.points[index]) return shape;
  return { ...shape, points: shape.points.map((p, i) => (i === index ? { x: to.x, y: to.y } : p)) };
}

/** A rectangle through two corners, or an ellipse inscribed in them (null if there is no area at all). */
export function boxOfDrag(a: Pt, b: Pt): Box | null {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x);
  const h = Math.abs(a.y - b.y);
  return w < 1 && h < 1 ? null : { x, y, w: Math.max(w, 1), h: Math.max(h, 1) };
}
