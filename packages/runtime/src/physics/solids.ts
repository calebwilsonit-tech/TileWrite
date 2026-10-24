import { EMPTY_TILE, FLAG, SLOPE, type StackBlock, type TileMap, type TileSet } from '../tilemap/tilemap';
import type { Aabb } from './gravity';

/**
 * What is solid in the world, block by block. A body's whole box is tested against the blocks it overlaps, in every direction
 * it moves, so a ceiling stops a jump, a wall stops a walk along it, and an overhang cannot be walked through. The map keeps
 * storing columns, slopes, decks and stacks of blocks (older projects load and look the same); this reads each of them as
 * the blocks they are.
 *
 * What is solid is decided by the block alone: a block is solid unless it says it is not (`solid: false` on the block, or on
 * its tile). Its tile's picture, its layer and whether the tile is marked a "wall" never matter.
 *
 * The rules, per cell and level:
 * - outside the map, and a cell with no tile and no blocks (the void), are solid at every level: the edge of the world is a wall;
 * - a blocker cell is solid at every level (or only between the levels it says);
 * - water is solid at every level for a body that cannot wade, and floor for one that can;
 * - a column is solid from far below up to its height; a pit has no floor at all;
 * - a stair or ramp on top of a column is a stair of four steps climbing one level;
 * - a deck is one solid level, with room under it;
 * - a cell of stacked blocks has the blocks it lists, each as the shape it says, and a floor under level 0 unless it is a hole.
 */

/** Never look further below the floor than this many levels (the cells down there are all alike). */
const DEEPEST = -8;
const EPS = 1e-6;
/** A stair or ramp is walked as this many thin steps, so a body climbs it smoothly (the picture of a stair is four steps; the legs are not fooled). */
const WALK_STEPS = 16;

export interface SolidWho {
  /** Can walk through water. */
  wade: boolean;
}

/** The solid pieces of a stair or ramp (rising toward north, east, south, west for rot 0..3), as boxes inside one cell. */
export function shapeBoxes(shape: StackBlock['shape'], rot: number | undefined): readonly (readonly [number, number, number, number, number, number])[] {
  if (shape !== 'stairs' && shape !== 'ramp') return CUBE;
  const dir = (rot ?? 0) & 3;
  const key = dir;
  const cached = STAIRS[key];
  if (cached) return cached;
  const out: [number, number, number, number, number, number][] = [];
  for (let k = 0; k < WALK_STEPS; k++) {
    const a0 = k / WALK_STEPS;
    const a1 = (k + 1) / WALK_STEPS;
    // the strip of the cell along the climb, from the low end to the high end
    if (dir === 1) out.push([a0, a1, 0, 1, 0, a1]); // east: rises toward +x
    else if (dir === 3) out.push([1 - a1, 1 - a0, 0, 1, 0, a1]); // west
    else if (dir === 2) out.push([0, 1, a0, a1, 0, a1]); // south: rises toward +y
    else out.push([0, 1, 1 - a1, 1 - a0, 0, a1]); // north
  }
  STAIRS[key] = out;
  return out;
}

const CUBE: readonly (readonly [number, number, number, number, number, number])[] = [[0, 1, 0, 1, 0, 1]];
const STAIRS: Record<number, readonly (readonly [number, number, number, number, number, number])[]> = {};

export class SolidField {
  /** `tiles` gives the tiles' own settings (a tile can say it is not solid); without it every tile is solid. */
  constructor(
    readonly map: TileMap,
    private readonly tiles?: TileSet,
  ) {}

  private tileSolid(tile: number): boolean {
    return this.tiles?.[tile]?.props?.solid !== false;
  }

  /** Push the solid pieces inside the cell (ix, iy, iz) as boxes in grid space. */
  private cell(ix: number, iy: number, iz: number, who: SolidWho, out: Aabb[]): void {
    const map = this.map;
    const full = (): void => {
      out.push({ x0: ix, x1: ix + 1, y0: iy, y1: iy + 1, z0: iz, z1: iz + 1 });
    };
    if (!map.inBounds(ix, iy)) return full();
    const i = iy * map.width + ix;
    const flags = map.flags[i]!;
    if (flags & FLAG.BLOCK) {
      const high = map.blockHigh[i]!;
      if (high === 0 || (iz >= map.blockLow[i]! && iz < high)) return full();
    }
    const stack = map.stacks.get(i);
    if (!stack && map.tiles[i] === EMPTY_TILE) return full();
    const deck = map.decks[i]!;
    // water stops a body that cannot wade, at every level (a bridge over it is the exception: above the bridge the way is clear)
    if (flags & FLAG.WATER && !who.wade && (deck === 0 || iz < deck - 1)) return full();
    if (stack) {
      const hasGround = stack.blocks.some((b) => b.z === 0);
      if (iz < 0) {
        if ((stack.floor !== 0 || hasGround) && !(flags & FLAG.PIT) && this.tileSolid(stack.floor || map.tiles[i]!)) full();
        return;
      }
      const b = stack.blocks.find((v) => v.z === iz);
      if (b && b.solid !== false && this.tileSolid(b.tile)) {
        for (const [x0, x1, y0, y1, z0, z1] of shapeBoxes(b.shape, b.rot)) out.push({ x0: ix + x0, x1: ix + x1, y0: iy + y0, y1: iy + y1, z0: iz + z0, z1: iz + z1 });
      }
      return;
    }
    const tile = map.tiles[i]!;
    if (!(flags & FLAG.PIT) && this.tileSolid(tile)) {
      const h = map.heights[i]!;
      if (iz < h) full();
      else if (iz === h) {
        const slope = map.slopes[i]! & 7;
        if (slope !== SLOPE.NONE) {
          for (const [x0, x1, y0, y1, z0, z1] of shapeBoxes('stairs', slope - 1)) out.push({ x0: ix + x0, x1: ix + x1, y0: iy + y0, y1: iy + y1, z0: iz + z0, z1: iz + z1 });
        }
      }
    }
    if (deck > 0 && iz === deck - 1) full();
  }

  /** Call `fn` with every solid piece that overlaps the box (touching does not count); stop early if `fn` returns true. */
  some(box: Aabb, who: SolidWho, fn: (piece: Aabb) => boolean | void): boolean {
    const ix0 = Math.floor(box.x0 + EPS);
    const ix1 = Math.ceil(box.x1 - EPS) - 1;
    const iy0 = Math.floor(box.y0 + EPS);
    const iy1 = Math.ceil(box.y1 - EPS) - 1;
    const iz0 = Math.max(DEEPEST, Math.floor(box.z0 + EPS));
    const iz1 = Math.ceil(box.z1 - EPS) - 1;
    const pieces: Aabb[] = [];
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          pieces.length = 0;
          this.cell(ix, iy, iz, who, pieces);
          for (const p of pieces) {
            if (p.x0 < box.x1 - EPS && p.x1 > box.x0 + EPS && p.y0 < box.y1 - EPS && p.y1 > box.y0 + EPS && p.z0 < box.z1 - EPS && p.z1 > box.z0 + EPS) {
              if (fn(p) === true) return true;
            }
          }
        }
      }
    }
    return false;
  }

  /** Is anything solid inside the box? */
  overlaps(box: Aabb, who: SolidWho): boolean {
    return this.some(box, who, () => true);
  }

  /** The pieces that fill the cell (for the debugger and the tests). */
  piecesIn(ix: number, iy: number, iz: number, who: SolidWho = { wade: false }): Aabb[] {
    const out: Aabb[] = [];
    this.cell(ix, iy, iz, who, out);
    return out;
  }
}
