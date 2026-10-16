import { DEFAULT_STEP_DOWN, DEFAULT_STEP_UP, cellWalkable, stepAllowed } from '../physics/terrain';
import type { TileMap } from '../tilemap/tilemap';

export interface PathOptions {
  /** Highest step a walker can climb (levels). Defaults to the player's. */
  stepUp?: number;
  /** Furthest it will step down. */
  maxDrop?: number;
  /** Extra cells to avoid (other objects in the way). The start and goal are never considered blocked. */
  blocked?: (x: number, y: number) => boolean;
  /** Give up after looking at this many cells. */
  maxNodes?: number;
  /** Allow diagonal steps (never cutting a corner). */
  diagonal?: boolean;
  /** Radius of the walker: a straight line is only clear if lines this far to either side are clear too. */
  clearance?: number;
}

export interface Cell2 {
  x: number;
  y: number;
}

/** Minimal binary min-heap keyed by f cost; ties break by insertion order so paths are deterministic. */
class Heap {
  private readonly items: { key: number; seq: number; node: number }[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(node: number, key: number): void {
    const items = this.items;
    items.push({ key, seq: this.seq++, node });
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(items[p]!, items[i]!)) break;
      [items[p], items[i]] = [items[i]!, items[p]!];
      i = p;
    }
  }

  pop(): number {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(items[l]!, items[m]!)) m = l;
        if (r < items.length && this.less(items[r]!, items[m]!)) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i]!, items[m]!];
        i = m;
      }
    }
    return top.node;
  }

  private less(a: { key: number; seq: number }, b: { key: number; seq: number }): boolean {
    return a.key < b.key || (a.key === b.key && a.seq < b.seq);
  }
}

const SQRT2 = Math.SQRT2;

/**
 * A* over the cells of the map, honouring heights (stairs and ramps climb, ledges only drop so far), pits,
 * water, walls, one-way edges and decks, exactly like the walk-test tool. Returns the centres of the cells to
 * walk through (the start is not included, the goal is), or null when there is no way.
 */
export function findPath(map: TileMap, from: Cell2, to: Cell2, opts: PathOptions = {}): Cell2[] | null {
  const sx = Math.floor(from.x);
  const sy = Math.floor(from.y);
  const gx = Math.floor(to.x);
  const gy = Math.floor(to.y);
  if (!cellWalkable(map, gx, gy)) return null;
  if (sx === gx && sy === gy) return [{ x: gx + 0.5, y: gy + 0.5 }];
  const stepUp = opts.stepUp ?? DEFAULT_STEP_UP;
  const maxDrop = opts.maxDrop ?? DEFAULT_STEP_DOWN;
  const maxNodes = opts.maxNodes ?? 4000;
  const w = map.width;
  const idx = (x: number, y: number): number => y * w + x;
  const blocked = opts.blocked;
  const free = (x: number, y: number): boolean => cellWalkable(map, x, y) && (!blocked || (x === gx && y === gy) || !blocked(x, y));

  const cost = new Map<number, number>();
  const parent = new Map<number, number>();
  const closed = new Set<number>();
  const heap = new Heap();
  const start = idx(sx, sy);
  cost.set(start, 0);
  const h = (x: number, y: number): number => {
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    return opts.diagonal ? dx + dy + (SQRT2 - 2) * Math.min(dx, dy) : dx + dy;
  };
  heap.push(start, h(sx, sy));
  const dirs: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  if (opts.diagonal) dirs.push([1, -1], [1, 1], [-1, 1], [-1, -1]);

  let expanded = 0;
  while (heap.size > 0 && expanded < maxNodes) {
    const cur = heap.pop();
    if (closed.has(cur)) continue;
    closed.add(cur);
    expanded++;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    if (cx === gx && cy === gy) {
      const out: Cell2[] = [];
      for (let n = cur; n !== start; n = parent.get(n)!) out.push({ x: (n % w) + 0.5, y: Math.floor(n / w) + 0.5 });
      return out.reverse();
    }
    const g = cost.get(cur)!;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!free(nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        // a diagonal needs both of the cells it brushes past to be walkable and steppable
        if (!free(cx + dx, cy) || !free(cx, cy + dy)) continue;
        if (!stepAllowed(map, cx, cy, cx + dx, cy, stepUp, maxDrop) || !stepAllowed(map, cx + dx, cy, nx, ny, stepUp, maxDrop)) continue;
        if (!stepAllowed(map, cx, cy, cx, cy + dy, stepUp, maxDrop) || !stepAllowed(map, cx, cy + dy, nx, ny, stepUp, maxDrop)) continue;
      } else if (!stepAllowed(map, cx, cy, nx, ny, stepUp, maxDrop)) continue;
      const ni = idx(nx, ny);
      if (closed.has(ni)) continue;
      const ng = g + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
      if (ng < (cost.get(ni) ?? Infinity)) {
        cost.set(ni, ng);
        parent.set(ni, cur);
        heap.push(ni, ng + h(nx, ny));
      }
    }
  }
  return null;
}

/** Walk the straight line between two points: is every cell on it walkable and steppable? (path smoothing, "can I just walk there?") */
export function straightWalkable(map: TileMap, a: Cell2, b: Cell2, opts: PathOptions = {}): boolean {
  const r = opts.clearance ?? 0;
  if (r > 0) {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = (-(b.y - a.y) / len) * r;
    const ny = ((b.x - a.x) / len) * r;
    const plain = { ...opts, clearance: 0 };
    return (
      straightWalkable(map, a, b, plain) &&
      straightWalkable(map, { x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, plain) &&
      straightWalkable(map, { x: a.x - nx, y: a.y - ny }, { x: b.x - nx, y: b.y - ny }, plain)
    );
  }
  return straightWalkableLine(map, a, b, opts);
}

function straightWalkableLine(map: TileMap, a: Cell2, b: Cell2, opts: PathOptions): boolean {
  const stepUp = opts.stepUp ?? DEFAULT_STEP_UP;
  const maxDrop = opts.maxDrop ?? DEFAULT_STEP_DOWN;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist * 4));
  let px = Math.floor(a.x);
  let py = Math.floor(a.y);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.floor(a.x + (b.x - a.x) * t);
    const cy = Math.floor(a.y + (b.y - a.y) * t);
    if (cx === px && cy === py) continue;
    if (!cellWalkable(map, cx, cy) || (opts.blocked?.(cx, cy) ?? false)) return false;
    // moving diagonally in one sample: both orthogonal cells must also be fine
    if (cx !== px && cy !== py) {
      if (!cellWalkable(map, cx, py) || !cellWalkable(map, px, cy)) return false;
      if (!stepAllowed(map, px, py, cx, py, stepUp, maxDrop) || !stepAllowed(map, cx, py, cx, cy, stepUp, maxDrop)) return false;
    } else if (!stepAllowed(map, px, py, cx, cy, stepUp, maxDrop)) return false;
    px = cx;
    py = cy;
  }
  return true;
}
