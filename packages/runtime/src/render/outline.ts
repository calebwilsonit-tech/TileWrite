import { unrotateVec, type ViewRotation } from '../iso/math';
import type { TileDef, TileMap } from '../tilemap/tilemap';

/** A point on a cube, in the cell's own units: fx and fy across the cell (0..1), h up from the cube's top (0) to its bottom (-1). */
export type CubePoint = [fx: number, fy: number, h: number];

/**
 * The edges to outline on one cube (the block at level z of cell x, y) for a tile with `outline`: every edge of a face the camera
 * sees, unless that face carries on flat into the next block of the same tile (or of a tile in the same `outline.group`). So a shape
 * built from many blocks is outlined once, round its corners and where it meets air or another tile, and never block by block.
 */
export function outlineEdges(map: TileMap, tileset: Readonly<Record<number, TileDef | undefined>>, x: number, y: number, z: number, tile: number, view: ViewRotation): [CubePoint, CubePoint][] {
  const group = tileset[tile]?.outline?.group;
  const cube = (bx: number, by: number, bz: number) => {
    const b = map.blockAt(bx, by, bz);
    return b && (b.shape ?? 'cube') === 'cube' ? b : undefined;
  };
  const filled = (bx: number, by: number, bz: number): boolean => cube(bx, by, bz) !== undefined;
  const same = (bx: number, by: number, bz: number): boolean => {
    const b = cube(bx, by, bz);
    if (!b) return false;
    if (b.tile === tile) return true;
    return group !== undefined && tileset[b.tile]?.outline?.group === group;
  };
  const out: [CubePoint, CubePoint][] = [];
  // the edge between a face (outward normal n) and the next cell along d, unless the face carries on there
  const edge = (d: [number, number, number], n: [number, number, number], a: CubePoint, b: CubePoint): void => {
    const [nx, ny, nz] = [x + d[0], y + d[1], z + d[2]];
    if (same(nx, ny, nz) && !filled(nx + n[0], ny + n[1], nz + n[2])) return;
    out.push([a, b]);
  };
  if (!filled(x, y, z + 1)) {
    const up: [number, number, number] = [0, 0, 1];
    edge([0, -1, 0], up, [0, 0, 0], [1, 0, 0]);
    edge([1, 0, 0], up, [1, 0, 0], [1, 1, 0]);
    edge([0, 1, 0], up, [1, 1, 0], [0, 1, 0]);
    edge([-1, 0, 0], up, [0, 1, 0], [0, 0, 0]);
  }
  for (const v of [unrotateVec(0, 1, view), unrotateVec(1, 0, view)]) {
    if (filled(x + v.x, y + v.y, z)) continue; // the side is hidden behind the next block
    const n: [number, number, number] = [v.x, v.y, 0];
    const at = (t: number, h: number): CubePoint => (v.x !== 0 ? [v.x === 1 ? 1 : 0, t, h] : [t, v.y === 1 ? 1 : 0, h]);
    const t: [number, number] = v.x !== 0 ? [0, 1] : [1, 0];
    edge([0, 0, 1], n, at(0, 0), at(1, 0));
    edge([0, 0, -1], n, at(0, -1), at(1, -1));
    edge([-t[0], -t[1], 0], n, at(0, 0), at(0, -1));
    edge([t[0], t[1], 0], n, at(1, 0), at(1, -1));
  }
  return out;
}
