import { screenIntentToGrid } from '../iso/math';

/**
 * Which way "down" is. Gravity pulls along one of the six axis directions (the scene has one, and any object can have its own),
 * and everything that walks, falls or is drawn works in that frame: a body stands on the face that is under its feet, and
 * "up" is the way a jump goes. The world's own axes stay what they always were (x and y along the floor, z up in levels).
 */
export type GravityDir = '-z' | '+z' | '-x' | '+x' | '-y' | '+y';

export const GRAVITY_DIRS: readonly GravityDir[] = ['-z', '+z', '-x', '+x', '-y', '+y'];

/** The normal one: down. */
export const DOWN: GravityDir = '-z';

export type Axis = 'x' | 'y' | 'z';

export interface GravityFrame {
  dir: GravityDir;
  /** The axis gravity pulls along, and +1 or -1 for the way. */
  axis: Axis;
  sign: 1 | -1;
  /** Unit vectors: the way gravity pulls, and the way up (where a jump goes). */
  g: readonly [number, number, number];
  up: readonly [number, number, number];
  /** The two axes of the plane the body walks on, in a fixed order (the first is the one nearer to x). */
  plane: readonly [Axis, Axis];
}

const AXES: Record<Axis, number> = { x: 0, y: 1, z: 2 };
export const axisIndex = (a: Axis): number => AXES[a];

const FRAMES = new Map<GravityDir, GravityFrame>();
for (const dir of GRAVITY_DIRS) {
  const axis = dir[1] as Axis;
  const sign: 1 | -1 = dir[0] === '+' ? 1 : -1;
  const g: [number, number, number] = [0, 0, 0];
  g[AXES[axis]] = sign;
  const plane = (['x', 'y', 'z'] as Axis[]).filter((a) => a !== axis) as [Axis, Axis];
  FRAMES.set(dir, { dir, axis, sign, g, up: [-g[0], -g[1], -g[2]], plane });
}

export function gravityFrame(dir: GravityDir | undefined): GravityFrame {
  return FRAMES.get(dir ?? DOWN) ?? FRAMES.get(DOWN)!;
}

export function isGravityDir(v: unknown): v is GravityDir {
  return typeof v === 'string' && FRAMES.has(v as GravityDir);
}

/** Plain-English names for the six directions (the editor and the logic blocks show these). */
export const GRAVITY_NAMES: Record<GravityDir, string> = {
  '-z': 'down (the floor)',
  '+z': 'up (the ceiling)',
  '-x': 'toward the west wall (low x)',
  '+x': 'toward the east wall (high x)',
  '-y': 'toward the north wall (low y)',
  '+y': 'toward the south wall (high y)',
};

/** An axis box in grid space: x and y in cells, z in levels. */
export interface Aabb {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/**
 * The box a body occupies. `feet` is the point on the surface it stands on, in grid space; the body reaches `height` from
 * there along "up" and `radius` to each side on the other two axes.
 */
export function bodyBox(frame: GravityFrame, feet: { x: number; y: number; h: number }, radius: number, height: number): Aabb {
  const p = [feet.x, feet.y, feet.h];
  const lo = [p[0]! - radius, p[1]! - radius, p[2]! - radius];
  const hi = [p[0]! + radius, p[1]! + radius, p[2]! + radius];
  const a = AXES[frame.axis];
  if (frame.sign === -1) {
    // up is +axis: from the feet upward
    lo[a] = p[a]!;
    hi[a] = p[a]! + height;
  } else {
    lo[a] = p[a]! - height;
    hi[a] = p[a]!;
  }
  return { x0: lo[0]!, x1: hi[0]!, y0: lo[1]!, y1: hi[1]!, z0: lo[2]!, z1: hi[2]! };
}

/** Where the feet are for a box (the inverse of `bodyBox`). */
export function feetOf(frame: GravityFrame, box: Aabb, radius: number): { x: number; y: number; h: number } {
  const lo = [box.x0, box.y0, box.z0];
  const hi = [box.x1, box.y1, box.z1];
  const c = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
  const a = AXES[frame.axis];
  c[a] = frame.sign === -1 ? lo[a]! : hi[a]!;
  void radius;
  return { x: c[0]!, y: c[1]!, h: c[2]! };
}

/** Where the feet go when gravity turns, so the body stays around the same middle (it is not pushed into the floor it stood on). */
export function turnFeet(from: GravityFrame, to: GravityFrame, feet: { x: number; y: number; h: number }, height: number): { x: number; y: number; h: number } {
  const p = [feet.x, feet.y, feet.h];
  // the middle of the body
  const c = [...p];
  c[AXES[from.axis]] = p[AXES[from.axis]]! + from.up[AXES[from.axis]]! * (height / 2);
  // the new feet are half a body from the middle, on the side gravity pulls toward
  const out = [...c];
  out[AXES[to.axis]] = c[AXES[to.axis]]! + to.g[AXES[to.axis]]! * (height / 2);
  return { x: out[0]!, y: out[1]!, h: out[2]! };
}

/**
 * Screen-space intent (dx to the right, dy down; each -1 to 1) turned into a direction of length 1 in grid space, for a body
 * walking on the plane of this frame. On the floor and the ceiling the keys go the same on-screen ways (the picture's
 * diagonals); on a wall, up is up the wall and right runs along the wall toward the right of the picture.
 */
export function intentToDirection(frame: GravityFrame, dx: number, dy: number, view: 0 | 1 | 2 | 3 = 0): { x: number; y: number; z: number } {
  if (frame.axis === 'z') {
    const g = screenIntentToGrid(dx, dy, view);
    return { x: g.x, y: g.y, z: 0 };
  }
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  const right = dx / len;
  const up = -dy / len;
  // the y axis runs toward the lower left of the picture, the x axis toward the lower right
  return frame.axis === 'x' ? { x: 0, y: -right, z: up } : { x: right, y: 0, z: up };
}

/** The velocity component along gravity (positive = falling). */
export function fallSpeed(frame: GravityFrame, v: { x: number; y: number; z: number }): number {
  return v.x * frame.g[0] + v.y * frame.g[1] + v.z * frame.g[2];
}

/**
 * The box a thing drawn `w` wide (x), `d` deep (y) and `height` tall occupies when it stands with its feet at `feet` on the face
 * gravity pulls it to: its height runs along "up", its width and depth lie on the other two axes.
 */
export function spriteBox(frame: GravityFrame, feet: { x: number; y: number; h: number }, w: number, d: number, height: number): Aabb {
  const ext: [number, number, number] = frame.axis === 'z' ? [w, d, height] : frame.axis === 'x' ? [height, d, w] : [w, height, d];
  const p = [feet.x, feet.y, feet.h];
  const lo = [0, 0, 0];
  const hi = [0, 0, 0];
  const a = AXES[frame.axis];
  for (let i = 0; i < 3; i++) {
    if (i === a) {
      lo[i] = frame.sign === -1 ? p[i]! : p[i]! - ext[i]!;
      hi[i] = frame.sign === -1 ? p[i]! + ext[i]! : p[i]!;
    } else {
      lo[i] = p[i]! - ext[i]! / 2;
      hi[i] = p[i]! + ext[i]! / 2;
    }
  }
  return { x0: lo[0]!, x1: hi[0]!, y0: lo[1]!, y1: hi[1]!, z0: lo[2]!, z1: hi[2]! };
}
