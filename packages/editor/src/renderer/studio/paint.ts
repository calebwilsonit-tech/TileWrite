import {
  ellipsePoints,
  inBounds,
  isoBoxFaces,
  linePoints,
  mirrored,
  polygonPoints,
  rectPoints,
  type Pt,
  type Size,
  type Symmetry,
} from '@tilewright/runtime';

/** A square brush of `size` pixels centred (as far as possible) on each point; duplicates removed. */
export function expandBrush(points: readonly Pt[], size: number): Pt[] {
  const s = Math.max(1, Math.floor(size));
  if (s === 1) return [...points];
  const off = Math.floor((s - 1) / 2);
  const seen = new Set<number>();
  const out: Pt[] = [];
  for (const p of points) {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const q = { x: p.x - off + x, y: p.y - off + y };
        const k = q.y * 100000 + q.x;
        if (!seen.has(k)) {
          seen.add(k);
          out.push(q);
        }
      }
    }
  }
  return out;
}

/** Mirror every point across the canvas centre as the symmetry settings ask; duplicates removed. */
export function withSymmetry(points: readonly Pt[], size: Size, sym: Symmetry): Pt[] {
  if (!sym.x && !sym.y) return [...points];
  const seen = new Set<number>();
  const out: Pt[] = [];
  for (const p of points) {
    for (const q of mirrored(p, size, sym)) {
      const k = q.y * 100000 + q.x;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(q);
      }
    }
  }
  return out;
}

export interface ShapeOptions {
  size: number;
  filled: boolean;
  sym: Symmetry;
  canvas: Size;
}

/** Pixels a drag from `a` to `b` paints with the given shape tool, clipped to the canvas. */
export function shapePixels(tool: 'pencil' | 'eraser' | 'line' | 'rect' | 'ellipse', a: Pt, b: Pt, o: ShapeOptions): Pt[] {
  let base: Pt[];
  if (tool === 'rect') base = rectPoints(a, b, o.filled);
  else if (tool === 'ellipse') base = ellipsePoints(a, b, o.filled);
  else base = linePoints(a, b);
  // outlines get the brush size; filled shapes already cover their area
  const useBrush = tool === 'pencil' || tool === 'eraser' || tool === 'line' || ((tool === 'rect' || tool === 'ellipse') && !o.filled);
  const brushed = useBrush ? expandBrush(base, o.size) : base;
  return withSymmetry(brushed, o.canvas, o.sym).filter((p) => inBounds(o.canvas, p.x, p.y));
}

/** Darken or lighten "#rrggbbaa" by a factor (alpha is kept). */
export function shadeHex(hex: string, f: number): string {
  const ch = (i: number): string => Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f))).toString(16).padStart(2, '0');
  return `#${ch(1)}${ch(3)}${ch(5)}${hex.slice(7, 9)}`.toLowerCase();
}

export interface IsoStamp {
  top: Pt[];
  left: Pt[];
  right: Pt[];
}

/** Pixels of an isometric box (top and two sides) with its footprint centred on (cx, cy). */
export function isoBoxPixels(cx: number, cy: number, w: number, d: number, h: number, s: number, canvas: Size): IsoStamp {
  const f = isoBoxFaces({ cx, cy, w, d, h, s });
  const clip = (pts: Pt[]): Pt[] => pts.filter((p) => inBounds(canvas, p.x, p.y));
  return { top: clip(polygonPoints(f.top)), left: clip(polygonPoints(f.left)), right: clip(polygonPoints(f.right)) };
}

/** Parse "1, 2, 5-7" (1-based, as shown to people) into 0-based frame indices. Throws a readable error. */
export function parseFrameList(text: string, frameCount: number): number[] {
  const out: number[] = [];
  const t = text.trim();
  if (t === '') return out;
  for (const part of t.split(/[,\s]+/)) {
    if (part === '') continue;
    const range = /^(\d+)-(\d+)$/.exec(part);
    const single = /^\d+$/.test(part);
    if (!range && !single) throw new Error(`"${part}" is not a frame number. Use numbers like 1, 2, 3 or a range like 2-5.`);
    const a = range ? Number(range[1]) : Number(part);
    const b = range ? Number(range[2]) : a;
    if (a < 1 || b < 1 || a > frameCount || b > frameCount) throw new Error(`Frame ${Math.max(a, b)} does not exist; this sprite has ${frameCount} frame${frameCount === 1 ? '' : 's'}.`);
    const step = a <= b ? 1 : -1;
    for (let i = a; i !== b + step; i += step) out.push(i - 1);
  }
  return out;
}

/** Inverse of parseFrameList, collapsing runs: [0,1,2,4] -> "1-3, 5". */
export function formatFrameList(frames: readonly number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < frames.length) {
    let j = i;
    while (j + 1 < frames.length && frames[j + 1] === frames[j]! + 1) j++;
    parts.push(j - i >= 2 ? `${frames[i]! + 1}-${frames[j]! + 1}` : frames.slice(i, j + 1).map((f) => f + 1).join(', '));
    i = j + 1;
  }
  return parts.join(', ');
}
