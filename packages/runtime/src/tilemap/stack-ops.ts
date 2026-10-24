import { EMPTY_TILE, copyBlock, type BlockFace, type BlockRun, type CellStack, type StackBlock } from './tilemap';

/**
 * Pure operations on a cell's stack of blocks, so the map, the editor's undo steps and the structure tools all do exactly the
 * same thing. Nothing here changes its input: each returns a new stack.
 */

export const cloneStack = (s: CellStack): CellStack => ({ floor: s.floor, blocks: s.blocks.map(copyBlock) });

/** The stack that is the same as a plain column of `height` levels in `tile`. */
export function columnToStack(tile: number, height: number): CellStack {
  const blocks: StackBlock[] = [];
  for (let z = 0; z < height; z++) blocks.push({ z, tile });
  return { floor: height === 0 ? tile : 0, blocks };
}

/**
 * The stack that is the same as a cell: its column, a stair or ramp on top of it as a shaped block, and a deck as the one block
 * it is. Nothing about how the cell looks or plays changes; it can now be edited block by block.
 */
export function cellToStack(c: { tile: number; height: number; slope: number; deck: number; deckTile: number }): CellStack {
  const blocks: StackBlock[] = [];
  for (let z = 0; z < c.height; z++) blocks.push({ z, tile: c.tile });
  const dir = c.slope & 7;
  if (dir !== 0 && c.tile !== EMPTY_TILE) blocks.push({ z: c.height, tile: c.tile, shape: c.slope & 8 ? 'stairs' : 'ramp', rot: (dir - 1) as 0 | 1 | 2 | 3 });
  if (c.deck > 0) {
    const tile = c.deckTile || c.tile;
    const at = blocks.findIndex((b) => b.z === c.deck - 1);
    if (at >= 0) blocks[at] = { z: c.deck - 1, tile };
    else blocks.push({ z: c.deck - 1, tile });
    blocks.sort((a, b) => a.z - b.z);
  }
  return { floor: c.height === 0 && dir === 0 ? c.tile : 0, blocks };
}

/** Solid runs of blocks, bottom to top. */
export function stackRuns(stack: CellStack): BlockRun[] {
  const out: BlockRun[] = [];
  for (const b of [...stack.blocks].sort((a, c) => a.z - c.z)) {
    const last = out[out.length - 1];
    if (last && last.top === b.z) {
      last.top = b.z + 1;
      last.tile = b.tile;
    } else out.push({ bottom: b.z, top: b.z + 1, tile: b.tile });
  }
  return out;
}

/** What a cell's column fields say about its stack: the run that starts at level 0, or else the floor. */
export function stackColumn(stack: CellStack): { tile: number; height: number } {
  const run = stackRuns(stack)[0];
  return run && run.bottom === 0 ? { tile: run.tile, height: Math.min(255, run.top) } : { tile: stack.floor, height: 0 };
}

export function stackSetBlock(stack: CellStack, z: number, tile: number, faces?: StackBlock['faces'], extra?: Pick<StackBlock, 'shape' | 'rot' | 'solid'>): CellStack {
  const next = cloneStack(stack);
  if (tile === EMPTY_TILE || z < 0 || z > 254) return next;
  const block: StackBlock = copyBlock({ z, tile, ...(faces ? { faces } : {}), ...(extra ?? {}) });
  const at = next.blocks.findIndex((b) => b.z === z);
  if (at >= 0) next.blocks[at] = block;
  else {
    next.blocks.push(block);
    next.blocks.sort((a, b) => a.z - b.z);
  }
  return next;
}

/** Without the block at a level. `groundTile` is what the floor becomes when the lowest block of a cell is taken away. */
export function stackRemoveBlock(stack: CellStack, z: number, groundTile: number): CellStack {
  const next = cloneStack(stack);
  next.blocks = next.blocks.filter((b) => b.z !== z);
  if (next.floor === 0 && !next.blocks.some((b) => b.z === 0)) next.floor = groundTile;
  return next;
}

export function stackSetFace(stack: CellStack, z: number, face: BlockFace, tile: number): CellStack {
  const next = cloneStack(stack);
  const b = next.blocks.find((v) => v.z === z);
  if (!b) return next;
  const faces = { ...(b.faces ?? {}) };
  if (tile === 0 || tile === b.tile) delete faces[face];
  else faces[face] = tile;
  if (Object.keys(faces).length > 0) b.faces = faces;
  else delete b.faces;
  return next;
}

/** The levels a body can stand at: the floor (if no block stands on it) and the top of every run. */
export function stackSurfaces(stack: CellStack): number[] {
  const runs = stackRuns(stack);
  const out: number[] = [];
  if (stack.floor !== 0 && !(runs[0] && runs[0].bottom === 0)) out.push(0);
  for (const r of runs) out.push(r.top);
  return out;
}
