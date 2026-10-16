/** Isometric grid maths. Grid units are tiles; height is in levels. */

export interface IsoConfig {
  tileW: number;
  tileH: number;
  /** Screen pixels per height level. */
  heightPx: number;
}

export const DEFAULT_ISO: IsoConfig = { tileW: 64, tileH: 32, heightPx: 16 };

export interface Vec2 {
  x: number;
  y: number;
}

export interface Cell {
  x: number;
  y: number;
}

/** Grid (gx, gy) at height h -> screen pixels (origin = grid origin, h = 0). */
export function gridToScreen(gx: number, gy: number, h = 0, cfg: IsoConfig = DEFAULT_ISO): Vec2 {
  return {
    x: (gx - gy) * (cfg.tileW / 2),
    y: (gx + gy) * (cfg.tileH / 2) - h * cfg.heightPx,
  };
}

/** Screen pixels -> grid position on the plane at height h. */
export function screenToGrid(sx: number, sy: number, h = 0, cfg: IsoConfig = DEFAULT_ISO): Vec2 {
  const a = sx / (cfg.tileW / 2); // gx - gy
  const b = (sy + h * cfg.heightPx) / (cfg.tileH / 2); // gx + gy
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Grid position -> the cell that contains it. */
export function cellOf(gx: number, gy: number): Cell {
  return { x: Math.floor(gx), y: Math.floor(gy) };
}

export function cellCenter(c: Cell): Vec2 {
  return { x: c.x + 0.5, y: c.y + 0.5 };
}

/** Screen position -> cell on the plane at height h. */
export function screenToCell(sx: number, sy: number, h = 0, cfg: IsoConfig = DEFAULT_ISO): Cell {
  const g = screenToGrid(sx, sy, h, cfg);
  return cellOf(g.x, g.y);
}

export const NEIGHBOURS_4: readonly Cell[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export const NEIGHBOURS_8: readonly Cell[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

export function neighbours(c: Cell, diagonals = false): Cell[] {
  return (diagonals ? NEIGHBOURS_8 : NEIGHBOURS_4).map((d) => ({ x: c.x + d.x, y: c.y + d.y }));
}

/**
 * The eight facings as seen on SCREEN, clockwise from East.
 * Index: 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE.
 */
export const FACING_NAMES = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;
export type Facing = (typeof FACING_NAMES)[number];

/** Screen-space intent (right = +x, down = +y) -> unit vector in grid space. Zero in, zero out. */
export function screenIntentToGrid(dx: number, dy: number): Vec2 {
  const gx = dx + dy;
  const gy = dy - dx;
  const len = Math.hypot(gx, gy);
  if (len === 0) return { x: 0, y: 0 };
  return { x: gx / len, y: gy / len };
}

/** Facing index (0..7, see FACING_NAMES) of a screen-space direction. */
export function facingOfScreenDir(dx: number, dy: number): number {
  const angle = Math.atan2(dy, dx); // 0 = E, +90deg = S (screen y down)
  return ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
}

/** Facing index of a grid-space direction. */
export function facingOfGridDir(gx: number, gy: number): number {
  const s = gridToScreen(gx, gy, 0);
  return facingOfScreenDir(s.x, s.y * 2); // undo the 2:1 squash so diagonals read as true diagonals
}

/**
 * Cells crossed by the segment from a to b, in order, including both ends
 * (supercover: every cell the line touches, so nothing can slip through a corner).
 */
export function lineCells(a: Cell, b: Cell): Cell[] {
  const nx = Math.abs(b.x - a.x);
  const ny = Math.abs(b.y - a.y);
  const sx = Math.sign(b.x - a.x);
  const sy = Math.sign(b.y - a.y);
  let x = a.x;
  let y = a.y;
  const cells: Cell[] = [{ x, y }];
  for (let ix = 0, iy = 0; ix < nx || iy < ny; ) {
    const decision = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (decision === 0) {
      // the line passes exactly through a corner: touch both orthogonal cells too
      cells.push({ x: x + sx, y }, { x, y: y + sy });
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (decision < 0) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    cells.push({ x, y });
  }
  return cells;
}

/**
 * True if no cell strictly between a and b is blocked.
 * `blocked(cell)` decides; the end cells themselves are never tested.
 */
export function lineOfSight(a: Cell, b: Cell, blocked: (c: Cell) => boolean): boolean {
  const cells = lineCells(a, b);
  for (let i = 1; i < cells.length - 1; i++) {
    const c = cells[i]!;
    if ((c.x === a.x && c.y === a.y) || (c.x === b.x && c.y === b.y)) continue;
    if (blocked(c)) return false;
  }
  return true;
}
