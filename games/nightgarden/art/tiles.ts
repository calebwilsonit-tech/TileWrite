import { faceAt, tileTemplate } from '../../../packages/editor/src/renderer/tilestudio/make-tile';
import { D, L, type Ink, type Op, type TilePicture } from './draw';

/** The ground of the garden: blocks one level tall (the tile studio's "Full-height block" canvas, 64 x 48). */
export const ISO = { tileW: 64, tileH: 32, heightPx: 16 };
const T = tileTemplate(ISO, 'block', 1);
const TOP = 0;
const LEFT = 1;
const RIGHT = 2;

/** Fill a face with a colour, a row of pixels at a time. */
function face(which: number, c: Ink): Op[] {
  const out: Op[] = [];
  for (let y = 0; y < T.height; y++) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < T.width; x++) {
      if (faceAt(T, x, y) !== which) continue;
      if (x0 < 0) x0 = x;
      x1 = x;
    }
    if (x0 >= 0) out.push(L(c, x0, y, x1, y));
  }
  return out;
}

/** Dots that only land where they are on the face they were meant for. */
function on(which: number, c: Ink, pts: [number, number][]): Op[] {
  const keep = pts.filter(([x, y]) => faceAt(T, x, y) === which);
  return keep.length > 0 ? [D(c, ...keep)] : [];
}

/** A point of the top face from cell coordinates (0..1 across and down the cell). */
const top = (u: number, v: number): [number, number] => [Math.round(31.5 + (u - v) * 32), Math.round((u + v) * 16)];

/** A line across the top face between two cell points, kept on the face. */
function seam(c: Ink, u0: number, v0: number, u1: number, v1: number): Op[] {
  const pts: [number, number][] = [];
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const p = top(u0 + ((u1 - u0) * i) / n, v0 + ((v1 - v0) * i) / n);
    if (!pts.some((q) => q[0] === p[0] && q[1] === p[1])) pts.push(p);
  }
  return on(TOP, c, pts);
}

/** A scatter of dots over a face, the same every time (a tiny number generator). */
function speckle(which: number, c: Ink, count: number, seed: number): Op[] {
  let s = seed;
  const next = (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff);
  const pts: [number, number][] = [];
  for (let i = 0; i < count * 6 && pts.length < count; i++) {
    const p: [number, number] = [Math.floor(next() * T.width), Math.floor(next() * T.height)];
    if (faceAt(T, p[0], p[1]) === which && !pts.some((q) => Math.abs(q[0] - p[0]) < 2 && q[1] === p[1])) pts.push(p);
  }
  return on(which, c, pts);
}

/** Level lines along a side face (courses of stone, layers of earth). */
function courses(which: number, c: Ink, rows: number[]): Op[] {
  const pts: [number, number][] = [];
  for (let x = 0; x < T.width; x++) {
    let first = -1;
    for (let y = 0; y < T.height; y++) {
      if (faceAt(T, x, y) === which) {
        first = y;
        break;
      }
    }
    if (first >= 0) for (const r of rows) pts.push([x, first + r]);
  }
  return on(which, c, pts);
}

const block = (name: string, id: number, ops: Op[], tile: Partial<TilePicture['tile']> = {}): TilePicture => ({ name, w: T.width, h: T.height, preset: 'block', frames: [{ ops }], tile: { id, name, faceLevels: 1, ...tile } });

export const TILES: TilePicture[] = [
  // the garden path: flagstones, four to a cell, with a darker joint round the cell so the grid can be read
  block('path', 1, [
    ...face(TOP, 'stone'),
    ...face(LEFT, 'soil'),
    ...face(RIGHT, 'loam'),
    ...seam('night', 0, 0, 1, 0),
    ...seam('night', 0, 0, 0, 1),
    ...seam('slate', 0.5, 0.04, 0.5, 0.96),
    ...seam('slate', 0.04, 0.5, 0.96, 0.5),
    ...speckle(TOP, 'pale', 9, 7),
    ...speckle(TOP, 'slate', 6, 21),
    ...courses(LEFT, 'slate', [0, 1]),
    ...courses(RIGHT, 'slate', [0, 1]),
    ...courses(LEFT, 'loam', [9]),
    ...speckle(LEFT, 'wood', 8, 3),
    ...speckle(RIGHT, 'soil', 8, 5),
  ]),
  // a clipped hedge: it stops walking and light
  block('hedge', 2, [
    ...face(TOP, 'moss'),
    ...face(LEFT, 'pine'),
    ...face(RIGHT, 'pine'),
    ...speckle(TOP, 'leaf', 46, 11),
    ...speckle(TOP, 'lime', 12, 13),
    ...speckle(TOP, 'pine', 22, 17),
    ...speckle(LEFT, 'moss', 40, 19),
    ...speckle(LEFT, 'leaf', 10, 23),
    ...speckle(RIGHT, 'ink', 40, 29),
    ...speckle(RIGHT, 'moss', 12, 31),
  ]),
  // the turned earth of a sunken bed
  block('soil', 3, [
    ...face(TOP, 'soil'),
    ...face(LEFT, 'loam'),
    ...face(RIGHT, 'loam'),
    ...seam('loam', 0.25, 0.05, 0.25, 0.95),
    ...seam('loam', 0.5, 0.05, 0.5, 0.95),
    ...seam('loam', 0.75, 0.05, 0.75, 0.95),
    ...seam('loam', 0, 0, 1, 0),
    ...seam('loam', 0, 0, 0, 1),
    ...speckle(TOP, 'wood', 12, 37),
    ...speckle(LEFT, 'soil', 14, 41),
    ...speckle(RIGHT, 'ink', 22, 43),
  ]),
  // pale dressed stone of the terraces
  block('terrace', 4, [
    ...face(TOP, 'pale'),
    ...face(LEFT, 'stone'),
    ...face(RIGHT, 'slate'),
    ...seam('stone', 0, 0, 1, 0),
    ...seam('stone', 0, 0, 0, 1),
    ...seam('moon', 0.08, 0.08, 0.92, 0.08),
    ...seam('moon', 0.08, 0.08, 0.08, 0.92),
    ...speckle(TOP, 'moon', 7, 47),
    ...speckle(TOP, 'stone', 6, 53),
    ...courses(LEFT, 'pale', [0]),
    ...courses(RIGHT, 'stone', [0]),
    ...courses(LEFT, 'slate', [8]),
    ...courses(RIGHT, 'night', [8]),
  ]),
  // the lily pond
  block('pond', 5, [
    ...face(TOP, 'water'),
    ...face(LEFT, 'deep'),
    ...face(RIGHT, 'deep'),
    ...seam('deep', 0, 0, 1, 0),
    ...seam('deep', 0, 0, 0, 1),
    ...seam('foam', 0.2, 0.3, 0.45, 0.3),
    ...seam('foam', 0.55, 0.7, 0.85, 0.7),
    ...seam('foam', 0.6, 0.2, 0.75, 0.2),
    ...on(TOP, 'leaf', [top(0.3, 0.7), [top(0.3, 0.7)[0] + 1, top(0.3, 0.7)[1]], [top(0.3, 0.7)[0] + 2, top(0.3, 0.7)[1]], [top(0.3, 0.7)[0] + 1, top(0.3, 0.7)[1] - 1], [top(0.3, 0.7)[0] + 2, top(0.3, 0.7)[1] - 1]]),
    ...on(TOP, 'pink', [[top(0.3, 0.7)[0] + 3, top(0.3, 0.7)[1] - 1]]),
    ...courses(LEFT, 'water', [0]),
    ...courses(RIGHT, 'water', [0]),
    ...speckle(RIGHT, 'ink', 16, 59),
  ], { water: true }),
];

/** Pixels outside the three faces are cut away by the tile studio ("Clip art to the guides"): the same for the preview. */
export function clipTile(cel: Uint8Array): Uint8Array {
  const out = cel.slice();
  for (let y = 0; y < T.height; y++) for (let x = 0; x < T.width; x++) if (faceAt(T, x, y) < 0) out[y * T.width + x] = 0;
  return out;
}
