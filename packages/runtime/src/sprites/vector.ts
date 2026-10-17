import { z } from 'zod';
import { newCel, polygonPoints, setPixel, type Cel, type Pt } from './raster';

/**
 * Vector layers: a layer holds shapes (rectangles, ellipses, paths) that stay editable, and the layer's pixels are
 * what they look like drawn at the sprite's size. The sprite file keeps both, so everything that reads pixels (the
 * game, sprite sheets, the world editor) needs nothing special. Colours are palette indices, as in pixel layers.
 */

const strokeFill = {
  /** Palette index of the fill (0 = no fill). */
  fill: z.number().int().min(0).max(255).default(0),
  /** Palette index of the outline (0 = no outline). */
  stroke: z.number().int().min(0).max(255).default(0),
  /** Outline thickness in pixels. */
  strokeWidth: z.number().min(0.5).max(64).default(1),
};

const PointSchema = z.object({ x: z.number(), y: z.number() });

export const VectorShapeSchema = z.discriminatedUnion('type', [
  z.object({
    ...strokeFill,
    type: z.literal('rect'),
    x: z.number(),
    y: z.number(),
    w: z.number().min(0),
    h: z.number().min(0),
    /** Rounded corners (pixels). */
    radius: z.number().min(0).default(0),
    /** Degrees, around the middle of the rectangle. */
    rotation: z.number().default(0),
  }),
  z.object({
    ...strokeFill,
    type: z.literal('ellipse'),
    cx: z.number(),
    cy: z.number(),
    rx: z.number().min(0),
    ry: z.number().min(0),
    rotation: z.number().default(0),
  }),
  z.object({
    ...strokeFill,
    type: z.literal('path'),
    points: z.array(PointSchema).min(2),
    /** Joins the last point back to the first. */
    closed: z.boolean().default(false),
    /** Curves through the points instead of straight lines. */
    smooth: z.boolean().default(false),
  }),
]);
export type VectorShape = z.infer<typeof VectorShapeSchema>;
export type VectorShapeType = VectorShape['type'];

export const MAX_SHAPES_PER_LAYER = 500;

export function newRectShape(x: number, y: number, w: number, h: number, fill: number, stroke = 0): VectorShape {
  return VectorShapeSchema.parse({ type: 'rect', x, y, w, h, fill, stroke });
}

export function newEllipseShape(cx: number, cy: number, rx: number, ry: number, fill: number, stroke = 0): VectorShape {
  return VectorShapeSchema.parse({ type: 'ellipse', cx, cy, rx, ry, fill, stroke });
}

export function newPathShape(points: Pt[], fill: number, stroke: number, closed = false, smooth = false): VectorShape {
  return VectorShapeSchema.parse({ type: 'path', points, fill, stroke: stroke || (fill === 0 ? 1 : 0), closed, smooth });
}

// ---------- geometry ----------

interface Outline {
  points: Pt[];
  closed: boolean;
}

const rotateAround = (p: Pt, c: Pt, deg: number): Pt => {
  if (deg === 0) return p;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
};

/** Catmull-Rom through the points, 8 steps per span. */
function smoothPoints(pts: readonly Pt[], closed: boolean): Pt[] {
  const n = pts.length;
  if (n < 3) return [...pts];
  const at = (i: number): Pt => (closed ? pts[((i % n) + n) % n]! : pts[Math.max(0, Math.min(n - 1, i))]!);
  const out: Pt[] = [];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let s = 0; s < 8; s++) {
      const t = s / 8;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  if (!closed) out.push({ ...pts[n - 1]! });
  return out;
}

/** The outline of a shape as straight segments. */
export function outlineOf(shape: VectorShape): Outline {
  switch (shape.type) {
    case 'rect': {
      const c = { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
      const r = Math.min(shape.radius, shape.w / 2, shape.h / 2);
      let pts: Pt[];
      if (r <= 0.01) {
        pts = [
          { x: shape.x, y: shape.y },
          { x: shape.x + shape.w, y: shape.y },
          { x: shape.x + shape.w, y: shape.y + shape.h },
          { x: shape.x, y: shape.y + shape.h },
        ];
      } else {
        pts = [];
        const corners: [number, number, number][] = [
          [shape.x + shape.w - r, shape.y + r, -90],
          [shape.x + shape.w - r, shape.y + shape.h - r, 0],
          [shape.x + r, shape.y + shape.h - r, 90],
          [shape.x + r, shape.y + r, 180],
        ];
        for (const [cx, cy, start] of corners) {
          for (let s = 0; s <= 6; s++) {
            const a = ((start + (s / 6) * 90) * Math.PI) / 180;
            pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
          }
        }
      }
      return { points: pts.map((p) => rotateAround(p, c, shape.rotation)), closed: true };
    }
    case 'ellipse': {
      const c = { x: shape.cx, y: shape.cy };
      const n = Math.max(16, Math.min(256, Math.ceil(Math.PI * 2 * Math.max(shape.rx, shape.ry))));
      const pts: Pt[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push(rotateAround({ x: c.x + Math.cos(a) * shape.rx, y: c.y + Math.sin(a) * shape.ry }, c, shape.rotation));
      }
      return { points: pts, closed: true };
    }
    case 'path':
      return { points: shape.smooth ? smoothPoints(shape.points, shape.closed) : shape.points.map((p) => ({ ...p })), closed: shape.closed };
  }
}

function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function distToOutline(px: number, py: number, o: Outline): number {
  let best = Infinity;
  const n = o.points.length;
  for (let i = 0; i < n - 1; i++) best = Math.min(best, distToSegment(px, py, o.points[i]!, o.points[i + 1]!));
  if (o.closed && n > 2) best = Math.min(best, distToSegment(px, py, o.points[n - 1]!, o.points[0]!));
  return best;
}

/** Is the shape's body (its fill area) around this point? */
function insidePolygon(px: number, py: number, pts: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The smallest box around a shape, outline thickness included. */
export function shapeBounds(shape: VectorShape): Box {
  const o = outlineOf(shape);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of o.points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const pad = shape.stroke > 0 ? shape.strokeWidth / 2 : 0;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

/** Is this point on the shape (inside a filled one, or on the outline)? `slop` widens thin lines so they can be clicked. */
export function hitShape(shape: VectorShape, px: number, py: number, slop = 0.75): boolean {
  const o = outlineOf(shape);
  if (shape.fill > 0 && o.points.length >= 3 && insidePolygon(px, py, o.points)) return true;
  const reach = Math.max(shape.stroke > 0 ? shape.strokeWidth / 2 : 0, slop);
  return distToOutline(px, py, o) <= reach;
}

/** The topmost shape under a point (later shapes are on top), or -1. */
export function pickShape(shapes: readonly VectorShape[], px: number, py: number): number {
  for (let i = shapes.length - 1; i >= 0; i--) if (hitShape(shapes[i]!, px, py)) return i;
  return -1;
}

export function moveShape(shape: VectorShape, dx: number, dy: number): VectorShape {
  switch (shape.type) {
    case 'rect':
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    case 'ellipse':
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
    case 'path':
      return { ...shape, points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
}

/** Stretch a shape so it fills `to` instead of `from` (the box it filled before). */
export function resizeShape(shape: VectorShape, from: Box, to: Box): VectorShape {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  const mx = (v: number): number => to.x + (v - from.x) * sx;
  const my = (v: number): number => to.y + (v - from.y) * sy;
  switch (shape.type) {
    case 'rect':
      return { ...shape, x: mx(shape.x), y: my(shape.y), w: shape.w * sx, h: shape.h * sy };
    case 'ellipse':
      return { ...shape, cx: mx(shape.cx), cy: my(shape.cy), rx: shape.rx * Math.abs(sx), ry: shape.ry * Math.abs(sy) };
    case 'path':
      return { ...shape, points: shape.points.map((p) => ({ x: mx(p.x), y: my(p.y) })) };
  }
}

/** Mirror a shape across the middle of a canvas of the given width (or height). */
export function flipShape(shape: VectorShape, axis: 'h' | 'v', size: number): VectorShape {
  const fx = (x: number): number => (axis === 'h' ? size - x : x);
  const fy = (y: number): number => (axis === 'v' ? size - y : y);
  switch (shape.type) {
    case 'rect':
      return { ...shape, x: axis === 'h' ? size - shape.x - shape.w : shape.x, y: axis === 'v' ? size - shape.y - shape.h : shape.y, rotation: -shape.rotation };
    case 'ellipse':
      return { ...shape, cx: fx(shape.cx), cy: fy(shape.cy), rotation: -shape.rotation };
    case 'path':
      return { ...shape, points: shape.points.map((p) => ({ x: fx(p.x), y: fy(p.y) })) };
  }
}

// ---------- drawing into pixels ----------

/** Draw one shape's fill and outline into a cel (palette indices). */
export function drawVectorShape(cel: Cel, w: number, h: number, shape: VectorShape): void {
  const o = outlineOf(shape);
  const size = { w, h };
  if (shape.fill > 0 && o.points.length >= 3) for (const p of polygonPoints(o.points)) setPixel(cel, size, p.x, p.y, shape.fill);
  if (shape.stroke > 0) {
    const half = shape.strokeWidth / 2;
    const b = shapeBounds({ ...shape, stroke: 0 });
    const x0 = Math.max(0, Math.floor(b.x - half - 1));
    const x1 = Math.min(w - 1, Math.ceil(b.x + b.w + half + 1));
    const y0 = Math.max(0, Math.floor(b.y - half - 1));
    const y1 = Math.min(h - 1, Math.ceil(b.y + b.h + half + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (distToOutline(x + 0.5, y + 0.5, o) <= half) cel[y * w + x] = shape.stroke;
  }
}

/** A cel with all the shapes drawn on it, first to last. */
export function rasterizeShapes(shapes: readonly VectorShape[], w: number, h: number): Cel {
  const cel = newCel(w, h);
  for (const s of shapes) drawVectorShape(cel, w, h, s);
  return cel;
}

/** What is wrong with a vector layer's shapes, in plain English. */
export function shapeProblems(shapes: readonly VectorShape[], paletteSize: number): string[] {
  const out: string[] = [];
  if (shapes.length > MAX_SHAPES_PER_LAYER) out.push(`A vector layer holds at most ${MAX_SHAPES_PER_LAYER} shapes (this one has ${shapes.length}).`);
  for (const s of shapes) {
    if (s.fill >= paletteSize || s.stroke >= paletteSize) {
      out.push('A shape uses a colour that is not in the palette.');
      break;
    }
  }
  return out;
}
