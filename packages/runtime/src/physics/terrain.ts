import { EMPTY_TILE, FLAG, SLOPE, SLOPE_RISE, EDGE, type TileMap } from '../tilemap/tilemap';

/** Falling below this height (levels) counts as having fallen out of the world / into a pit. */
export const PIT_KILL_Z = -3;
export const DEFAULT_STEP_UP = 0.35;
export const DEFAULT_STEP_DOWN = 0.4;

export type SurfaceKind = 'ground' | 'deck' | 'pit' | 'void' | 'solid' | 'water';

export interface Surface {
  kind: SurfaceKind;
  /** Height to stand on. -Infinity for pits (no floor); +Infinity for things that can't be stood on. */
  z: number;
}

/** Ground height at a continuous point, including the slope of stairs/ramps. Ignores pits and decks. */
export function groundHeightAt(map: TileMap, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const base = map.getHeight(cx, cy);
  const slope = map.getSlope(cx, cy);
  if (!slope) return base;
  const fx = x - cx;
  const fy = y - cy;
  let t = 0;
  switch (slope.dir) {
    case SLOPE.N:
      t = 1 - fy;
      break;
    case SLOPE.E:
      t = fx;
      break;
    case SLOPE.S:
      t = fy;
      break;
    case SLOPE.W:
      t = 1 - fx;
      break;
  }
  return base + SLOPE_RISE * t;
}

export interface SurfaceQuery {
  /** How far above the feet counts as "stand on it" when choosing between ground and deck. */
  stepUp: number;
  /** Body height, to detect bumping the underside of a deck. */
  bodyHeight: number;
}

/**
 * What would a body with its feet at height z find under the point (x, y)?
 * Chooses between the deck (bridge) and the ground below it using z, so one cell can hold both a
 * bridge and the water/floor under it.
 */
export function surfaceAt(map: TileMap, x: number, y: number, z: number, q: SurfaceQuery): Surface {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (!map.inBounds(cx, cy) || map.getTile(cx, cy) === EMPTY_TILE) return { kind: 'void', z: Infinity };
  const flags = map.getFlags(cx, cy);
  if (map.blockedAt(cx, cy, z, q.bodyHeight)) return { kind: 'solid', z: Infinity };

  const stack = map.getStack(cx, cy);
  if (stack) return stackSurface(map, cx, cy, z, q, flags);
  const deck = map.getDeck(cx, cy);
  if (deck > 0) {
    if (z >= deck - q.stepUp) return { kind: 'deck', z: deck };
    // below the deck: the head must clear its 1-level-thick underside
    if (z + q.bodyHeight > deck - 1 + 1e-6) return { kind: 'solid', z: Infinity };
  }
  if (flags & FLAG.PIT) return { kind: 'pit', z: -Infinity };
  const g = groundHeightAt(map, x, y);
  if (flags & FLAG.WATER) return { kind: 'water', z: g };
  return { kind: 'ground', z: g };
}

/**
 * What a body finds in a cell built block by block: it stands on the highest surface (the floor or the top of a run of blocks)
 * it can step onto from where its feet are, is stopped by blocks it would walk into, and cannot go where a block above would
 * hit its head. That is what lets it walk under an arch and over a balcony.
 */
function stackSurface(map: TileMap, cx: number, cy: number, z: number, q: SurfaceQuery, flags: number): Surface {
  const runs = map.runs(cx, cy);
  const stack = map.getStack(cx, cy)!;
  // inside a block (not just at its top edge): solid
  for (const r of runs) if (z < r.top - q.stepUp - 1e-6 && z + q.bodyHeight > r.bottom + 1e-6 && z >= r.bottom - 1e-6) return { kind: 'solid', z: Infinity };
  // candidate surfaces: the floor and the top of each run
  let best = -Infinity;
  let kind: SurfaceKind = 'pit';
  const hasFloor = stack.floor !== 0 && !(runs[0] && runs[0].bottom === 0);
  if (hasFloor && 0 <= z + q.stepUp) {
    best = 0;
    kind = flags & FLAG.WATER ? 'water' : 'ground';
  }
  for (const r of runs) {
    if (r.top <= z + q.stepUp + 1e-6 && r.top > best) {
      best = r.top;
      kind = 'ground';
    }
  }
  if (best === -Infinity) {
    // no floor and nothing to stand on below: a hole
    return flags & FLAG.PIT || !hasFloor ? { kind: 'pit', z: -Infinity } : { kind: 'ground', z: 0 };
  }
  // a block overhead that would hit the head
  for (const r of runs) if (r.bottom >= best - 1e-6 && r.top > best + 1e-6 && best + q.bodyHeight > r.bottom + 1e-6) return { kind: 'solid', z: Infinity };
  return { kind, z: best };
}

/** Which edge of a cell you cross when stepping from (ax,ay) to the orthogonally adjacent (bx,by). */
export function entersThroughEdge(ax: number, ay: number, bx: number, by: number): number {
  if (bx > ax) return EDGE.W;
  if (bx < ax) return EDGE.E;
  if (by > ay) return EDGE.N;
  if (by < ay) return EDGE.S;
  return 0;
}

/** True if moving between two adjacent cells is forbidden by a one-way edge. */
export function oneWayBlocks(map: TileMap, ax: number, ay: number, bx: number, by: number): boolean {
  if (ax === bx && ay === by) return false;
  return (map.getOneWay(bx, by) & entersThroughEdge(ax, ay, bx, by)) !== 0;
}

/** Can a body stand in this cell at all (not void, not blocked, not a bare pit or water)? A bridge over a pit counts. */
export function cellWalkable(map: TileMap, x: number, y: number): boolean {
  if (!map.inBounds(x, y) || map.getTile(x, y) === EMPTY_TILE) return false;
  const flags = map.getFlags(x, y);
  if (map.cellBlocked(x, y)) return false;
  return map.getDeck(x, y) > 0 || !(flags & (FLAG.PIT | FLAG.WATER));
}

/** Can a walker step from one cell to the orthogonally adjacent one (one-way edges, climbing and drop limits)? */
export function stepAllowed(map: TileMap, ax: number, ay: number, bx: number, by: number, stepUp: number, maxDrop: number): boolean {
  if (oneWayBlocks(map, ax, ay, bx, by)) return false;
  const dx = bx - ax;
  const dy = by - ay;
  const hereEdge = edgeHeight(map, ax, ay, dx, dy);
  const nextEdge = edgeHeight(map, bx, by, -dx, -dy);
  return nextEdge - hereEdge <= stepUp && hereEdge - nextEdge <= maxDrop;
}

/** Cells (4-connected) a body standing at `start` can walk to without falling, step limit `stepUp`. Used by the walk-test tool. */
export function reachableCells(
  map: TileMap,
  start: { x: number; y: number },
  opts: { stepUp?: number; maxDrop?: number; limit?: number; bridges?: ReadonlySet<string> } = {},
): Set<string> {
  const stepUp = opts.stepUp ?? DEFAULT_STEP_UP;
  const maxDrop = opts.maxDrop ?? DEFAULT_STEP_DOWN;
  const limit = opts.limit ?? 100000;
  const key = (x: number, y: number): string => `${x},${y}`;
  const out = new Set<string>([key(start.x, start.y)]);
  const queue = [{ x: start.x, y: start.y }];
  while (queue.length > 0 && out.size < limit) {
    const c = queue.shift()!;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (out.has(key(nx, ny))) continue;
      const bridged = (opts.bridges?.has(key(nx, ny)) ?? false) && map.inBounds(nx, ny) && !map.cellBlocked(nx, ny);
      if (!(cellWalkable(map, nx, ny) || bridged) || !stepAllowed(map, c.x, c.y, nx, ny, stepUp, maxDrop)) continue;
      out.add(key(nx, ny));
      queue.push({ x: nx, y: ny });
    }
  }
  return out;
}
/** Ground height along the middle of the edge of a cell facing (dx, dy). */
function edgeHeight(map: TileMap, cx: number, cy: number, dx: number, dy: number): number {
  const deck = map.getDeck(cx, cy);
  if (deck > 0 && map.getFlags(cx, cy) & (FLAG.PIT | FLAG.WATER)) return deck;
  return groundHeightAt(map, cx + 0.5 + dx * 0.5 - dx * 1e-6, cy + 0.5 + dy * 0.5 - dy * 1e-6);
}
