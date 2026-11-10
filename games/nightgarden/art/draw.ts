import { floodPoints, newCel, type Pt } from '@tilewright/runtime';
import { shapePixels } from '../../../packages/editor/src/renderer/studio/paint';

/**
 * The art of Nightgarden is a list of strokes: rectangles, ellipses, lines, pencil dots and fills in named colours.
 * `art.spec.ts` draws every stroke in the editor's Sprite studio with the mouse (the studio's own tools), and this
 * file works out what the same strokes should give, with the studio's own pixel functions, so each picture can be
 * previewed quickly and the studio's result can be checked against it pixel for pixel.
 */

/** The colours of the game. A picture's palette is the colours it names, in the order it names them. */
export const INK = {
  ink: '#141826',
  night: '#1f2540',
  slate: '#343b5c',
  stone: '#5b6384',
  pale: '#8f96b3',
  moon: '#e6ecff',
  pine: '#1e4d3a',
  moss: '#2f7a50',
  leaf: '#55a868',
  lime: '#9bd67a',
  loam: '#3a2a25',
  soil: '#5c4336',
  wood: '#8a5a3c',
  oak: '#b9834f',
  amber: '#f2a93b',
  gold: '#ffd76a',
  glow: '#fff3c4',
  ember: '#e2603a',
  teal: '#2d8f8f',
  aqua: '#5fd0c5',
  sky: '#8fb8ff',
  petal: '#c8dcff',
  plum: '#4a3a7a',
  violet: '#7a5fc0',
  lilac: '#b79cf0',
  pink: '#f08fb8',
  skin: '#f1c9a5',
  tan: '#c9946f',
  red: '#c44d4d',
  blue: '#3e5fa8',
  iron: '#6f7a8c',
  steel: '#454d5e',
  deep: '#23507a',
  water: '#3a7fb5',
  foam: '#7fc4e8',
} as const;
export type Ink = keyof typeof INK;

export type Op =
  | { t: 'rect' | 'ellipse'; c: Ink; a: [number, number]; b: [number, number]; outline?: number }
  | { t: 'line'; c: Ink; a: [number, number]; b: [number, number]; size?: number }
  | { t: 'dots'; c: Ink; pts: [number, number][]; size?: number }
  | { t: 'fill'; c: Ink; at: [number, number] }
  | { t: 'erase'; a: [number, number]; b: [number, number]; size?: number };

/** A filled rectangle from corner to corner (both included). */
export const R = (c: Ink, x0: number, y0: number, x1: number, y1: number): Op => ({ t: 'rect', c, a: [x0, y0], b: [x1, y1] });
/** A filled ellipse inside the box from corner to corner. */
export const E = (c: Ink, x0: number, y0: number, x1: number, y1: number): Op => ({ t: 'ellipse', c, a: [x0, y0], b: [x1, y1] });
/** The outline of a rectangle or an ellipse, `w` pixels thick. */
export const RO = (c: Ink, x0: number, y0: number, x1: number, y1: number, w = 1): Op => ({ t: 'rect', c, a: [x0, y0], b: [x1, y1], outline: w });
export const EO = (c: Ink, x0: number, y0: number, x1: number, y1: number, w = 1): Op => ({ t: 'ellipse', c, a: [x0, y0], b: [x1, y1], outline: w });
/** A line, `size` pixels thick. */
export const L = (c: Ink, x0: number, y0: number, x1: number, y1: number, size = 1): Op => ({ t: 'line', c, a: [x0, y0], b: [x1, y1], size });
/** Single pencil dots. */
export const D = (c: Ink, ...pts: [number, number][]): Op => ({ t: 'dots', c, pts });
/** A flood fill from a point. */
export const F = (c: Ink, x: number, y: number): Op => ({ t: 'fill', c, at: [x, y] });
/** Rub out along a line. */
export const X = (x0: number, y0: number, x1: number, y1: number, size = 1): Op => ({ t: 'erase', a: [x0, y0], b: [x1, y1], size });

export interface Frame {
  /** 'copy' starts from the frame before; 'blank' from nothing. The first frame is always blank. */
  from?: 'copy' | 'blank';
  ms?: number;
  ops: Op[];
}

export interface Clip {
  name: string;
  /** Frame numbers as the studio writes them: "1, 2" or "2-5". */
  all?: string;
  dirs?: Partial<Record<'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE', string>>;
  mirror?: boolean;
  loop?: boolean;
}

export interface Picture {
  name: string;
  w: number;
  h: number;
  /** Where it stands on its cell (default: the middle of the bottom edge). */
  feet?: [number, number];
  frames: Frame[];
  clips?: Clip[];
}

export interface TilePicture extends Picture {
  /** Made on the tile studio's canvas of this kind and sent to the palette under `tile`. */
  preset: 'flat' | 'block';
  tile: { id: number; name: string; water?: boolean; outline?: boolean; faceLevels?: number; animate?: number };
}

/** The colours a picture uses, in first-use order (palette number = index + 1). */
export function paletteOf(p: Picture): Ink[] {
  const out: Ink[] = [];
  for (const f of p.frames) for (const o of f.ops) if (o.t !== 'erase' && !out.includes(o.c)) out.push(o.c);
  return out;
}

/** What the strokes give: one array of palette numbers per frame. */
export function rasterize(p: Picture): Uint8Array[] {
  const size = { w: p.w, h: p.h };
  const pal = paletteOf(p);
  const frames: Uint8Array[] = [];
  for (const f of p.frames) {
    const cel = f.from === 'copy' && frames.length > 0 ? frames.at(-1)!.slice() : newCel(p.w, p.h);
    const put = (pts: readonly Pt[], v: number): void => {
      for (const q of pts) if (q.x >= 0 && q.y >= 0 && q.x < p.w && q.y < p.h) cel[q.y * p.w + q.x] = v;
    };
    const pt = ([x, y]: [number, number]): Pt => ({ x, y });
    for (const o of f.ops) {
      const sym = { x: false, y: false };
      if (o.t === 'rect' || o.t === 'ellipse') put(shapePixels(o.t, pt(o.a), pt(o.b), { size: o.outline ?? 1, filled: o.outline === undefined, sym, canvas: size }), pal.indexOf(o.c) + 1);
      else if (o.t === 'line') put(shapePixels('line', pt(o.a), pt(o.b), { size: o.size ?? 1, filled: true, sym, canvas: size }), pal.indexOf(o.c) + 1);
      else if (o.t === 'erase') put(shapePixels('eraser', pt(o.a), pt(o.b), { size: o.size ?? 1, filled: true, sym, canvas: size }), 0);
      else if (o.t === 'dots') for (const d of o.pts) put(shapePixels('pencil', pt(d), pt(d), { size: o.size ?? 1, filled: true, sym, canvas: size }), pal.indexOf(o.c) + 1);
      else put(floodPoints(cel, size, pt(o.at)), pal.indexOf(o.c) + 1);
    }
    frames.push(cel);
  }
  return frames;
}

/** A frame as RGBA, enlarged `scale` times (for looking at). */
export function rgbaOf(p: Picture, cel: Uint8Array, scale = 1, back?: string): { width: number; height: number; data: Uint8ClampedArray } {
  const pal = paletteOf(p).map((k) => INK[k]);
  const w = p.w * scale;
  const h = p.h * scale;
  const data = new Uint8ClampedArray(w * h * 4);
  const bg = back ? [parseInt(back.slice(1, 3), 16), parseInt(back.slice(3, 5), 16), parseInt(back.slice(5, 7), 16)] : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = cel[Math.floor(y / scale) * p.w + Math.floor(x / scale)]!;
      const i = (y * w + x) * 4;
      if (v === 0) {
        if (bg) data.set([bg[0]!, bg[1]!, bg[2]!, 255], i);
        continue;
      }
      const hex = pal[v - 1]!;
      data.set([parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255], i);
    }
  }
  return { width: w, height: h, data };
}
