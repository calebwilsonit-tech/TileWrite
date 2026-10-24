import type { BlockFace } from '@tilewright/runtime';

/**
 * The geometry of the Blocks tool, apart from the mouse: which block a click puts a new one beside, where a drag ends on the
 * face it began on, and which cells a drag fills. Plain data and functions, so it is tested without a window.
 */

export interface Cell3 {
  x: number;
  y: number;
  z: number;
}

export type Axis = 'x' | 'y' | 'z';

/** The axis a face points along, and which way. */
export function faceNormal(face: BlockFace): { axis: Axis; sign: 1 | -1 } {
  switch (face) {
    case 'top':
      return { axis: 'z', sign: 1 };
    case 'n':
      return { axis: 'y', sign: -1 };
    case 'e':
      return { axis: 'x', sign: 1 };
    case 's':
      return { axis: 'y', sign: 1 };
    default:
      return { axis: 'x', sign: -1 };
  }
}

/** Where a block added against a face goes: the cell on the far side of the face. */
export function cellBeside(hit: Cell3 & { face: BlockFace }): Cell3 {
  const n = faceNormal(hit.face);
  const at = { x: hit.x, y: hit.y, z: hit.z };
  at[n.axis] += n.sign;
  return at;
}

/**
 * Where the line of sight through a point of the screen crosses a flat plane of the grid (`axis` = `value`). `low` and `high`
 * are where the same line of sight meets the floor (level 0) and level 10, so it works however the view is turned.
 */
export function planePoint(low: { x: number; y: number }, high: { x: number; y: number }, axis: Axis, value: number): { x: number; y: number; z: number } | null {
  const a = { x: low.x, y: low.y, z: 0 };
  const d = { x: high.x - low.x, y: high.y - low.y, z: 10 };
  if (Math.abs(d[axis]) < 1e-9) return null;
  const t = (value - a[axis]) / d[axis];
  return { x: a.x + d.x * t, y: a.y + d.y * t, z: a.z + d.z * t };
}

const MOST = 4096;

/**
 * The cells a drag of the Blocks tool fills. A drag begun on a face fills the flat patch of cells in that face's plane from where it
 * began to where it is now: a line when it is dragged straight, a wall when it is dragged up the side of a block, a floor
 * when it is dragged across the top. With `box` (Shift), the patch is built up `layers` cells deep, away from the face.
 */
export function blockDragCells(start: Cell3, end: Cell3, face: BlockFace, box: boolean, layers: number): Cell3[] {
  const n = faceNormal(face);
  const lo = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), z: Math.min(start.z, end.z) };
  const hi = { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y), z: Math.max(start.z, end.z) };
  const range = (axis: Axis): number[] => {
    if (axis === n.axis) {
      // the normal axis stays where the drag began; a box grows away from the face
      const depth = box ? Math.max(1, Math.round(layers)) : 1;
      return Array.from({ length: depth }, (_, k) => start[axis] + k * n.sign);
    }
    const out: number[] = [];
    for (let v = lo[axis]; v <= hi[axis]; v++) out.push(v);
    return out;
  };
  const out: Cell3[] = [];
  for (const x of range('x')) for (const y of range('y')) for (const z of range('z')) if (out.length < MOST) out.push({ x, y, z });
  return out;
}

/** A hotbar of up to nine tiles: a tile that is used and not on it takes the place of the one added longest ago. */
export function useInHotbar(hotbar: readonly number[], next: number, tile: number): { hotbar: number[]; next: number } {
  if (hotbar.includes(tile)) return { hotbar: [...hotbar], next };
  const out = [...hotbar];
  if (out.length < 9) {
    out.push(tile);
    return { hotbar: out, next };
  }
  out[next % 9] = tile;
  return { hotbar: out, next: (next + 1) % 9 };
}
