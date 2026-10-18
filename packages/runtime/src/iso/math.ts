/** Isometric grid maths. Grid units are tiles; height is in levels. */

export interface IsoConfig {
  tileW: number;
  tileH: number;
  /** Screen pixels per height level. */
  heightPx: number;
  /**
   * Which of the four ways the world is turned on screen (0 = the usual view; each step turns the camera a quarter turn clockwise).
   * With a view other than 0, `mapW` and `mapH` (the map's size in cells) say what the world is turned around.
   */
  view?: ViewRotation;
  mapW?: number;
  mapH?: number;
}

export type ViewRotation = 0 | 1 | 2 | 3;

export const DEFAULT_ISO: IsoConfig = { tileW: 64, tileH: 32, heightPx: 16 };

export interface Vec2 {
  x: number;
  y: number;
}

export interface Cell {
  x: number;
  y: number;
}

/** A direction (not a place) as seen from this view: the world turned a quarter turn per view step. */
export function rotateVec(dx: number, dy: number, view: ViewRotation = 0): Vec2 {
  switch (view) {
    case 1:
      return { x: -dy, y: dx };
    case 2:
      return { x: -dx, y: -dy };
    case 3:
      return { x: dy, y: -dx };
    default:
      return { x: dx, y: dy };
  }
}

/** The opposite of rotateVec: a direction on screen -> the direction in the world. */
export function unrotateVec(dx: number, dy: number, view: ViewRotation = 0): Vec2 {
  return rotateVec(dx, dy, ((4 - view) % 4) as ViewRotation);
}

/** A world position as it sits in the turned world (the map's corner that was at the top stays at the top of the picture). */
export function rotateGrid(gx: number, gy: number, cfg: IsoConfig): Vec2 {
  const view = cfg.view ?? 0;
  if (view === 0) return { x: gx, y: gy };
  const w = cfg.mapW ?? 0;
  const h = cfg.mapH ?? 0;
  switch (view) {
    case 1:
      return { x: h - gy, y: gx };
    case 2:
      return { x: w - gx, y: h - gy };
    default:
      return { x: gy, y: w - gx };
  }
}

export function unrotateGrid(rx: number, ry: number, cfg: IsoConfig): Vec2 {
  const view = cfg.view ?? 0;
  if (view === 0) return { x: rx, y: ry };
  const w = cfg.mapW ?? 0;
  const h = cfg.mapH ?? 0;
  switch (view) {
    case 1:
      return { x: ry, y: h - rx };
    case 2:
      return { x: w - rx, y: h - ry };
    default:
      return { x: w - ry, y: rx };
  }
}

/** Grid (gx, gy) at height h -> screen pixels (origin = grid origin, h = 0). Follows the view rotation. */
export function gridToScreen(gx: number, gy: number, h = 0, cfg: IsoConfig = DEFAULT_ISO): Vec2 {
  const r = cfg.view ? rotateGrid(gx, gy, cfg) : { x: gx, y: gy };
  return {
    x: (r.x - r.y) * (cfg.tileW / 2),
    y: (r.x + r.y) * (cfg.tileH / 2) - h * cfg.heightPx,
  };
}

/** A small step on the ground (dx, dy cells) as a screen offset: like gridToScreen but with no position, only a direction. */
export function relToScreen(dx: number, dy: number, h = 0, cfg: IsoConfig = DEFAULT_ISO): Vec2 {
  const r = rotateVec(dx, dy, cfg.view ?? 0);
  return {
    x: (r.x - r.y) * (cfg.tileW / 2),
    y: (r.x + r.y) * (cfg.tileH / 2) - h * cfg.heightPx,
  };
}

/** Screen pixels -> grid position on the plane at height h. */
export function screenToGrid(sx: number, sy: number, h = 0, cfg: IsoConfig = DEFAULT_ISO): Vec2 {
  const a = sx / (cfg.tileW / 2); // rx - ry
  const b = (sy + h * cfg.heightPx) / (cfg.tileH / 2); // rx + ry
  const r = { x: (a + b) / 2, y: (b - a) / 2 };
  return cfg.view ? unrotateGrid(r.x, r.y, cfg) : r;
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

/** Screen-space intent (right = +x, down = +y) -> unit vector in grid space. Zero in, zero out. `view` is how the world is turned on screen. */
export function screenIntentToGrid(dx: number, dy: number, view: ViewRotation = 0): Vec2 {
  const v = view === 0 ? { x: dx + dy, y: dy - dx } : unrotateVec(dx + dy, dy - dx, view);
  const gx = v.x;
  const gy = v.y;
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
