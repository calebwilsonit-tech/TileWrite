import { FLAG, type TileMap } from '../tilemap/tilemap';
import type { RegionData } from '../project/schema';

/**
 * Lighting is plain data plus a few pure functions, so behaviours ("is this plant in the light?"), the
 * renderer (darkness with soft shadows) and tests all agree on what is lit.
 * Positions are grid coordinates; heights are levels.
 */

export interface LightSource {
  x: number;
  y: number;
  h: number;
  /** In cells. */
  radius: number;
  color: number;
  /** 0..1: how completely it clears the darkness at its centre. */
  intensity: number;
  /** Walls and tall objects block it. */
  shadows: boolean;
}

export interface LightingModel {
  /** Darkness regions, from the scene. Outside every region it is fully lit. */
  regions: readonly Pick<RegionData, 'x' | 'y' | 'w' | 'h' | 'darkness'>[];
  /** Extra darkness over the whole scene (0 = none). */
  sceneDarkness: number;
  lights: LightSource[];
  /** Does the cell (cx, cy) stop light that travels at height h? */
  blocked(cx: number, cy: number, h: number): boolean;
}

/** Cells that stop light: BLOCK-flagged cells, walls that rise well above the light, and tall solid objects. */
export function makeOccluder(map: TileMap | null, tall: readonly { x: number; y: number; w: number; d: number; top: number }[], tileBlocks?: (tile: number) => boolean): LightingModel['blocked'] {
  const objects = tall.filter((o) => o.top >= 1.2);
  return (cx, cy, h) => {
    if (map) {
      if (!map.inBounds(cx, cy)) return true;
      if (tileBlocks && tileBlocks(map.getTile(cx, cy))) return true;
      if (map.hasFlag(cx, cy, FLAG.BLOCK) && !map.getBlockBand(cx, cy)) return true;
      if (map.getTile(cx, cy) !== 0 && map.topHeight(cx, cy) > h + 1.2) return true;
    }
    for (const o of objects) {
      if (o.top <= h + 0.2) continue;
      if (cx + 0.5 > o.x - o.w / 2 && cx + 0.5 < o.x + o.w / 2 + 0.01 && cy + 0.5 > o.y - o.d / 2 && cy + 0.5 < o.y + o.d / 2 + 0.01) return true;
    }
    return false;
  };
}

/** Darkness (0..1) of the scene at a point before any light is added. */
export function ambientDarkness(model: LightingModel, x: number, y: number): number {
  let d = model.sceneDarkness;
  for (const r of model.regions) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) d = Math.max(d, r.darkness);
  }
  return d;
}

/** How many cells between (ax, ay) and (bx, by) would stop something at height h (never the start or end cell). */
export function blockersBetween(model: LightingModel, ax: number, ay: number, bx: number, by: number, h: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const steps = Math.ceil(Math.hypot(dx, dy) * 4);
  const sx = Math.floor(ax);
  const sy = Math.floor(ay);
  const ex = Math.floor(bx);
  const ey = Math.floor(by);
  let lastX = sx;
  let lastY = sy;
  let count = 0;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.floor(ax + dx * t);
    const cy = Math.floor(ay + dy * t);
    if (cx === lastX && cy === lastY) continue;
    lastX = cx;
    lastY = cy;
    if ((cx === sx && cy === sy) || (cx === ex && cy === ey)) continue;
    if (model.blocked(cx, cy, h)) count++;
  }
  return count;
}

/** Is there a clear line from (ax, ay) to (bx, by)? Walks the cells in between (never the start or end cell). */
export function lineClear(model: LightingModel, ax: number, ay: number, bx: number, by: number, h: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  const steps = Math.ceil(dist * 4);
  const sx = Math.floor(ax);
  const sy = Math.floor(ay);
  const ex = Math.floor(bx);
  const ey = Math.floor(by);
  let lastX = sx;
  let lastY = sy;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.floor(ax + dx * t);
    const cy = Math.floor(ay + dy * t);
    if (cx === lastX && cy === lastY) continue;
    lastX = cx;
    lastY = cy;
    if ((cx === sx && cy === sy) || (cx === ex && cy === ey)) continue;
    if (model.blocked(cx, cy, h)) return false;
  }
  return true;
}

/** Brightness at a point: 1 = fully lit, 0 = pitch dark. Lights fall off smoothly towards their radius. */
export function lightLevel(model: LightingModel, x: number, y: number, h = 0): number {
  const dark = ambientDarkness(model, x, y);
  if (dark <= 0) return 1;
  let cleared = 0;
  for (const l of model.lights) {
    const d = Math.hypot(x - l.x, y - l.y);
    if (d >= l.radius) continue;
    if (l.shadows && !lineClear(model, l.x, l.y, x, y, Math.max(h, l.h))) continue;
    const f = 1 - d / l.radius;
    cleared = Math.max(cleared, l.intensity * Math.min(1, f * 1.6));
  }
  return 1 - dark * (1 - Math.min(1, cleared));
}

/** The question behaviours ask: is this spot lit well enough to count as light? */
export function isLit(model: LightingModel | undefined, x: number, y: number, h = 0, threshold = 0.5): boolean {
  if (!model) return true;
  return lightLevel(model, x, y, h) >= threshold;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The area a light reaches, as a polygon in grid space (fan of rays, stopped by occluders). `radius` may be
 * smaller than the light's own radius to draw the soft rings of its glow.
 */
export function visibilityPolygon(model: LightingModel, l: LightSource, radius: number, rays = 72): Point[] {
  const out: Point[] = [];
  const step = 0.15;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    let r = 0;
    if (l.shadows) {
      let lastX = Math.floor(l.x);
      let lastY = Math.floor(l.y);
      while (r < radius) {
        const nr = Math.min(radius, r + step);
        const px = l.x + cx * nr;
        const py = l.y + cy * nr;
        const gx = Math.floor(px);
        const gy = Math.floor(py);
        if ((gx !== lastX || gy !== lastY) && model.blocked(gx, gy, l.h)) {
          // stop at the wall's face so the wall itself is lit up to its edge
          r = nr;
          break;
        }
        lastX = gx;
        lastY = gy;
        r = nr;
      }
    } else {
      r = radius;
    }
    out.push({ x: l.x + cx * r, y: l.y + cy * r });
  }
  return out;
}
