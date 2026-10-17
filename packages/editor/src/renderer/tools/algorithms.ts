import { EMPTY_TILE, FLAG, Rng, SLOPE, SLOPE_RISE, type SlopeDir, type TileMap } from '@tilewright/runtime';
import { readCell, type CellData, type CellPatch } from '../model/cells';

export interface P {
  x: number;
  y: number;
}

/** All cells in the rectangle spanned by two corner cells (inclusive, any corner order). */
export function rectCells(a: P, b: P): P[] {
  const out: P[] = [];
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) out.push({ x, y });
  }
  return out;
}

/** Cells along a one-cell-wide line (Bresenham, no gaps, both ends included). */
export function lineBetween(a: P, b: P): P[] {
  const out: P[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** Square brush of `size` cells centred (as far as possible) on (x, y). */
export function brushCells(x: number, y: number, size: number): P[] {
  const s = Math.max(1, Math.floor(size));
  const off = Math.floor((s - 1) / 2);
  return rectCells({ x: x - off, y: y - off }, { x: x - off + s - 1, y: y - off + s - 1 });
}

/** Cells connected (4-way) to the start that satisfy `same`, up to `limit`. */
export function floodFill(map: TileMap, start: P, same: (c: CellData) => boolean, limit = 20000): P[] {
  if (!map.inBounds(start.x, start.y) || !same(readCell(map, start.x, start.y))) return [];
  const seen = new Set<number>([start.y * map.width + start.x]);
  const out: P[] = [];
  const queue: P[] = [start];
  while (queue.length > 0 && out.length < limit) {
    const c = queue.pop()!;
    out.push(c);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (!map.inBounds(nx, ny)) continue;
      const k = ny * map.width + nx;
      if (seen.has(k)) continue;
      seen.add(k);
      if (same(readCell(map, nx, ny))) queue.push({ x: nx, y: ny });
    }
  }
  return out;
}

/** A random subset of `cells`, each kept with probability `density` (0..1). Deterministic for a seed. */
export function scatter(cells: P[], density: number, seed: number): P[] {
  const rng = new Rng(seed);
  return cells.filter(() => rng.next() < density);
}

/** New heights that blend each cell toward the average of itself and its 8 neighbours. Slopes and decks are left alone. */
export function smoothedHeights(map: TileMap, cells: P[]): { x: number; y: number; height: number }[] {
  const out: { x: number; y: number; height: number }[] = [];
  for (const c of cells) {
    if (!map.inBounds(c.x, c.y) || map.getTile(c.x, c.y) === EMPTY_TILE || map.getSlope(c.x, c.y)) continue;
    let sum = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (!map.inBounds(nx, ny) || map.getTile(nx, ny) === EMPTY_TILE) continue;
        sum += map.getHeight(nx, ny);
        n++;
      }
    }
    out.push({ x: c.x, y: c.y, height: Math.round(sum / n) });
  }
  return out;
}

/** The cell you walk up FROM when climbing a slope that rises toward `dir`. */
export function lowSide(x: number, y: number, dir: SlopeDir): P {
  switch (dir) {
    case SLOPE.N:
      return { x, y: y + 1 };
    case SLOPE.E:
      return { x: x - 1, y };
    case SLOPE.S:
      return { x, y: y - 1 };
    case SLOPE.W:
      return { x: x + 1, y };
    default:
      return { x, y };
  }
}

/** The cell you arrive at after climbing. */
export function highSide(x: number, y: number, dir: SlopeDir): P {
  const low = lowSide(x, y, dir);
  return { x: 2 * x - low.x, y: 2 * y - low.y };
}

/** Does the cell have a surface (ground or bridge deck) exactly at `level`, so stairs can top out on it? */
export function meetsTop(map: TileMap, x: number, y: number, level: number): boolean {
  return map.getHeight(x, y) === level || map.getDeck(x, y) === level;
}

export interface SlopePlan {
  patch: CellPatch;
  /** Plain-English problems, e.g. the top of the stairs does not meet the next floor. */
  warnings: string[];
}

/**
 * Turn a cell into stairs or a ramp rising toward `dir`. The base height is copied from the cell
 * it climbs from, so the bottom of the stairs meets the floor automatically.
 */
export function planSlope(map: TileMap, x: number, y: number, dir: SlopeDir, style: 'stairs' | 'ramp'): SlopePlan {
  const warnings: string[] = [];
  const low = lowSide(x, y, dir);
  const high = highSide(x, y, dir);
  let base = map.getHeight(x, y);
  if (map.inBounds(low.x, low.y) && map.getTile(low.x, low.y) !== EMPTY_TILE) {
    base = map.topHeight(low.x, low.y);
  } else {
    warnings.push('Nothing to climb up from: the cell on the low side is empty.');
  }
  if (map.inBounds(high.x, high.y) && map.getTile(high.x, high.y) !== EMPTY_TILE) {
    const top = map.getHeight(high.x, high.y);
    if (!meetsTop(map, high.x, high.y, base + SLOPE_RISE)) {
      warnings.push(`The top of these stairs is at level ${base + SLOPE_RISE} but the next cell is at level ${top}; raise or lower it by hand.`);
    }
  } else {
    warnings.push('The stairs lead nowhere: the cell on the high side is empty.');
  }
  return {
    patch: { slope: dir | (style === 'stairs' ? 8 : 0), height: base, flags: 0, deck: 0, deckTile: 0 },
    warnings,
  };
}

/** What the collision overlay shows for a cell. */
export type CollisionKind = 'void' | 'walkable' | 'blocked' | 'overhead' | 'pit' | 'water' | 'stair' | 'trigger' | 'deck';

/**
 * What a cell is to a walker. `level` is the height of the walker's feet (null = standing on the cell's own floor).
 * 'overhead' is a blocker that exists in the cell but does not reach a walker at that level.
 */
export function collisionKind(map: TileMap, x: number, y: number, level: number | null = null): CollisionKind {
  if (!map.inBounds(x, y) || map.getTile(x, y) === EMPTY_TILE) return 'void';
  const f = map.getFlags(x, y);
  if (f & FLAG.BLOCK) {
    if (!map.getBlockBand(x, y)) return 'blocked';
    if (map.cellBlocked(x, y, level ?? map.walkLevel(x, y))) return 'blocked';
    return 'overhead';
  }
  if (f & FLAG.PIT) return map.getDeck(x, y) > 0 ? 'deck' : 'pit';
  if (f & FLAG.WATER) return map.getDeck(x, y) > 0 ? 'deck' : 'water';
  if (map.getSlope(x, y)) return 'stair';
  if (f & FLAG.TRIGGER) return 'trigger';
  return 'walkable';
}

/** A snapshot of a rectangle of the map, to stamp elsewhere. */
export interface Pattern {
  w: number;
  h: number;
  cells: CellData[];
}

export function capturePattern(map: TileMap, a: P, b: P): Pattern {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const cells: CellData[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(map.inBounds(x, y) ? readCell(map, x, y) : readCell(map, x0, y0));
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, cells };
}

/** Where each cell of `pattern` lands when its top-left corner is placed at (x, y). */
export function stampCells(pattern: Pattern, x: number, y: number): { x: number; y: number; cell: CellData }[] {
  const out: { x: number; y: number; cell: CellData }[] = [];
  for (let j = 0; j < pattern.h; j++) {
    for (let i = 0; i < pattern.w; i++) out.push({ x: x + i, y: y + j, cell: pattern.cells[j * pattern.w + i]! });
  }
  return out;
}
