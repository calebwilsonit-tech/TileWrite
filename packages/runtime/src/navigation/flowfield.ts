import { DEFAULT_STEP_DOWN, DEFAULT_STEP_UP, cellWalkable, stepAllowed } from '../physics/terrain';
import type { TileMap } from '../tilemap/tilemap';

/**
 * A flow field: for every cell, how far it is from a goal (counted in steps over the map's real walkable ground), so any number
 * of units heading for the same place can each just step to the cheapest neighbour. One search serves hundreds of units, which is
 * why crowds (a colony, an army) use it instead of a path each.
 */
export interface FlowField {
  w: number;
  h: number;
  /** Cost to the goal from each cell (row by row); Infinity where the goal cannot be reached. */
  cost: Float32Array;
}

export interface FlowOptions {
  stepUp?: number;
  maxDrop?: number;
  /** Cells nothing can walk through (buildings, walls of crates). The goal cells are always allowed. */
  blocked?: (x: number, y: number) => boolean;
  /** Give up beyond this cost (keeps a huge map cheap). */
  maxCost?: number;
}

const SQRT2 = Math.SQRT2;
const DIRS: readonly [number, number, number][] = [
  [0, -1, 1],
  [1, 0, 1],
  [0, 1, 1],
  [-1, 0, 1],
  [1, -1, SQRT2],
  [1, 1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/** Minimal binary heap of [cost, cell]. */
class Heap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= k[i]!) break;
      [k[p], k[i]] = [k[i]!, k[p]!];
      [v[p], v[i]] = [v[i]!, v[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const top: [number, number] = [k[0]!, v[0]!];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length > 0) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l]! < k[m]!) m = l;
        if (r < k.length && k[r]! < k[m]!) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i]!, k[m]!];
        [v[m], v[i]] = [v[i]!, v[m]!];
        i = m;
      }
    }
    return top;
  }
}

/** Work out the cost to reach `goals` from everywhere that can. */
export function buildFlowField(map: TileMap, goals: readonly { x: number; y: number }[], opts: FlowOptions = {}): FlowField {
  const w = map.width;
  const h = map.height;
  const stepUp = opts.stepUp ?? DEFAULT_STEP_UP;
  const maxDrop = opts.maxDrop ?? DEFAULT_STEP_DOWN;
  const maxCost = opts.maxCost ?? Infinity;
  const cost = new Float32Array(w * h).fill(Infinity);
  const heap = new Heap();
  const goalSet = new Set<number>();
  for (const g of goals) {
    const x = Math.floor(g.x);
    const y = Math.floor(g.y);
    if (!map.inBounds(x, y)) continue;
    cost[y * w + x] = 0;
    goalSet.add(y * w + x);
    heap.push(0, y * w + x);
  }
  const walk = (x: number, y: number): boolean => map.inBounds(x, y) && cellWalkable(map, x, y) && (goalSet.has(y * w + x) || !opts.blocked?.(x, y));
  while (heap.size > 0) {
    const [c, cell] = heap.pop();
    if (c > cost[cell]!) continue;
    if (c > maxCost) break;
    const cx = cell % w;
    const cy = (cell - cx) / w;
    for (const [dx, dy, step] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walk(nx, ny)) continue;
      // stepping from the neighbour toward this cell must be allowed (walkers move the other way round)
      if (!stepAllowed(map, nx, ny, cx, cy, stepUp, maxDrop)) continue;
      if (dx !== 0 && dy !== 0 && (!walk(cx + dx, cy) || !walk(cx, cy + dy) || !stepAllowed(map, nx, ny, cx + dx, ny, stepUp, maxDrop) || !stepAllowed(map, nx, ny, nx, cy, stepUp, maxDrop))) continue;
      const nc = c + step;
      const ni = ny * w + nx;
      if (nc < cost[ni]!) {
        cost[ni] = nc;
        heap.push(nc, ni);
      }
    }
  }
  return { w, h, cost };
}

/** The cell centre a walker standing in (x, y) should head for next, or null when it is at the goal or cannot get there. */
export function flowNext(field: FlowField, x: number, y: number): { x: number; y: number } | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= field.w || cy >= field.h) return null;
  const here = field.cost[cy * field.w + cx]!;
  if (!Number.isFinite(here) || here === 0) return null;
  let best: { x: number; y: number } | null = null;
  let bestCost = here;
  for (const [dx, dy] of DIRS) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= field.w || ny >= field.h) continue;
    const c = field.cost[ny * field.w + nx]!;
    if (c < bestCost - 1e-6) {
      bestCost = c;
      best = { x: nx + 0.5, y: ny + 0.5 };
    }
  }
  return best;
}

export function flowCost(field: FlowField, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= field.w || cy >= field.h) return Infinity;
  return field.cost[cy * field.w + cx]!;
}
