import { describe, expect, it } from 'vitest';
import { newScene } from '@tilewright/runtime';
import { EditorDoc } from '../model/doc';
import { blockDragCells, cellBeside, faceNormal, planePoint, useInHotbar } from './block-edit';
import { TOOLS, type Pointer, type Preview, type ToolEnv } from './tools';
import type { ToolOptions } from '../app/store';

describe('the Blocks tool: where blocks go', () => {
  it('puts a new block beside the face you point at', () => {
    expect(cellBeside({ x: 3, y: 3, z: 2, face: 'top' })).toEqual({ x: 3, y: 3, z: 3 });
    expect(cellBeside({ x: 3, y: 3, z: 2, face: 'e' })).toEqual({ x: 4, y: 3, z: 2 });
    expect(cellBeside({ x: 3, y: 3, z: 2, face: 's' })).toEqual({ x: 3, y: 4, z: 2 });
    expect(cellBeside({ x: 3, y: 3, z: 2, face: 'w' })).toEqual({ x: 2, y: 3, z: 2 });
    expect(cellBeside({ x: 3, y: 3, z: 2, face: 'n' })).toEqual({ x: 3, y: 2, z: 2 });
    expect(faceNormal('top')).toEqual({ axis: 'z', sign: 1 });
  });

  it('finds where the line of sight crosses the plane of a face, however the view is turned', () => {
    // a line of sight that meets level 0 at (4, 6) and level 10 at (9, 11) rises 5 cells in x and y for 10 levels
    expect(planePoint({ x: 4, y: 6 }, { x: 9, y: 11 }, 'z', 2)).toEqual({ x: 5, y: 7, z: 2 });
    expect(planePoint({ x: 4, y: 6 }, { x: 9, y: 11 }, 'x', 6)).toEqual({ x: 6, y: 8, z: 4 });
    expect(planePoint({ x: 4, y: 6 }, { x: 4, y: 11 }, 'x', 6)).toBeNull(); // parallel to the plane
  });

  it('a drag fills a line, a wall or a floor along the face it began on', () => {
    const start = { x: 2, y: 2, z: 1 };
    // along the top of a block, straight: a line
    expect(blockDragCells(start, { x: 5, y: 2, z: 1 }, 'top', false, 1)).toHaveLength(4);
    // across it: a floor of 4 x 3
    expect(blockDragCells(start, { x: 5, y: 4, z: 1 }, 'top', false, 1)).toHaveLength(12);
    // up the east side of a block: a wall (the cells stay one thick in x)
    const wall = blockDragCells({ x: 6, y: 2, z: 0 }, { x: 6, y: 5, z: 3 }, 'e', false, 1);
    expect(wall).toHaveLength(16);
    expect(new Set(wall.map((c) => c.x))).toEqual(new Set([6]));
    // a drag that goes back over where it began is the same patch
    expect(blockDragCells({ x: 5, y: 4, z: 1 }, start, 'top', false, 1)).toHaveLength(12);
  });

  it('shift-drag builds a box: the patch, a number of layers deep away from the face', () => {
    const cells = blockDragCells({ x: 2, y: 2, z: 1 }, { x: 4, y: 3, z: 1 }, 'top', true, 3);
    expect(cells).toHaveLength(3 * 2 * 3);
    expect(Math.max(...cells.map((c) => c.z))).toBe(3);
    expect(Math.min(...cells.map((c) => c.z))).toBe(1);
    // against a west face the layers go west
    const west = blockDragCells({ x: 4, y: 2, z: 0 }, { x: 4, y: 2, z: 0 }, 'w', true, 2);
    expect(west.map((c) => c.x)).toEqual([4, 3]);
  });

  it('never fills more than a few thousand cells', () => {
    expect(blockDragCells({ x: 0, y: 0, z: 0 }, { x: 200, y: 200, z: 0 }, 'top', false, 1).length).toBeLessThanOrEqual(4096);
  });
});

describe('the hotbar', () => {
  it('keeps a tile where it is and gives a new one the place of the one added longest ago', () => {
    let state = { hotbar: [1, 2, 3], next: 0 };
    state = useInHotbar(state.hotbar, state.next, 2);
    expect(state.hotbar).toEqual([1, 2, 3]);
    for (const t of [4, 5, 6, 7, 8, 9]) state = useInHotbar(state.hotbar, state.next, t);
    expect(state.hotbar).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    state = useInHotbar(state.hotbar, state.next, 12);
    expect(state.hotbar[0]).toBe(12);
    state = useInHotbar(state.hotbar, state.next, 13);
    expect(state.hotbar.slice(0, 2)).toEqual([12, 13]);
  });
});

describe('the Blocks tool, used', () => {
  const opts: ToolOptions = {
    tile: 2, size: 1, height: 3, density: 0.5, slopeDir: 2, bridgeLevel: 1, blockFrom: 0, blockTo: 0, prefab: 'crate', outline: false, edge: 1, blockMode: 'add',
    spacing: 1, avoidPaths: true, attachment: '', zFrom: 0, zTo: 3, blockShape: 'cube', blockRot: 0, blockSolid: true, blockHeight: 2, hotbar: [1, 2, 3], hotbarNext: 0,
  };
  function rig(hit: { x: number; y: number; z: number; face: 'top' | 'n' | 'e' | 's' | 'w' } | null) {
    const doc = EditorDoc.fromScene(newScene('T', 12, 12));
    let preview: Preview[] = [];
    const env = {
      doc,
      opts: { ...opts },
      setOptions: (p: Partial<ToolOptions>) => Object.assign(env.opts, p),
      setPreview: (p: Preview[]) => (preview = p),
      pickBlock: () => hit,
      worldAt: (s: { x: number; y: number }, h: number) => ({ x: s.x + h * 0, y: s.y + h * 0 }),
      notify: () => undefined,
    } as unknown as ToolEnv;
    const at = (x: number, y: number, extra: Partial<Pointer> = {}): Pointer => ({ button: 0, cell: { x, y }, screen: { x, y }, shift: false, alt: false, ctrl: false, ...extra });
    return { doc, env, at, preview: () => preview };
  }

  it('lights the face you point at, with a ghost of the block that would go beside it', () => {
    const r = rig({ x: 4, y: 4, z: -1, face: 'top' });
    TOOLS.blocks.hover(r.at(4, 4), r.env);
    expect(r.preview().map((p) => p.kind)).toEqual(['face', 'solid']);
    // pointing with Ctrl held shows what would be taken away instead
    TOOLS.blocks.hover(r.at(4, 4, { ctrl: true }), r.env);
    expect(r.preview().map((p) => p.kind)).toEqual(['cube']);
  });

  it('a click puts a block on the face; right-click takes the block away; both are one undo step', () => {
    const r = rig({ x: 4, y: 4, z: -1, face: 'top' });
    TOOLS.blocks.down(r.at(4, 4), r.env);
    TOOLS.blocks.up(r.at(4, 4), r.env);
    expect(r.doc.map.blockAt(4, 4, 0)?.tile).toBe(2);
    expect(r.doc.map.getStack(4, 4)).toBeDefined();
    r.doc.undo();
    expect(r.doc.map.blockAt(4, 4, 0)).toBeUndefined();
    const rm = rig({ x: 6, y: 6, z: 0, face: 'top' });
    rm.doc.map.setBlock(6, 6, 0, 2);
    rm.doc.map.setBlock(6, 6, 1, 2);
    TOOLS.blocks.down(rm.at(6, 6, { button: 2 }), rm.env);
    TOOLS.blocks.up(rm.at(6, 6, { button: 2 }), rm.env);
    expect(rm.doc.map.blockAt(6, 6, 0)).toBeUndefined();
    expect(rm.doc.map.blockAt(6, 6, 1)).toBeDefined();
  });

  it('puts stairs of the chosen way round, and a block that is not solid', () => {
    const r = rig({ x: 4, y: 4, z: -1, face: 'top' });
    Object.assign(r.env.opts, { blockShape: 'stairs', blockRot: 3, blockSolid: false });
    TOOLS.blocks.down(r.at(4, 4), r.env);
    TOOLS.blocks.up(r.at(4, 4), r.env);
    const b = r.doc.map.blockAt(4, 4, 0)!;
    expect([b.shape, b.rot, b.solid]).toEqual(['stairs', 3, false]);
  });

  it('middle click copies the block: its tile, shape and way round; R turns; 1 to 9 pick from the hotbar', () => {
    const r = rig({ x: 5, y: 5, z: 0, face: 'top' });
    r.doc.map.setBlock(5, 5, 0, 4, undefined, { shape: 'ramp', rot: 2 });
    TOOLS.blocks.down(r.at(5, 5, { button: 1 }), r.env);
    expect([r.env.opts.tile, r.env.opts.blockShape, r.env.opts.blockRot]).toEqual([4, 'ramp', 2]);
    expect(TOOLS.blocks.key!('r', r.env)).toBe(true);
    expect(r.env.opts.blockRot).toBe(3);
    expect(TOOLS.blocks.key!('2', r.env)).toBe(true);
    expect(r.env.opts.tile).toBe(2);
  });

  it('a click uses a tile that is not on the hotbar, and it goes on the hotbar', () => {
    const r = rig({ x: 4, y: 4, z: -1, face: 'top' });
    r.env.opts.tile = 6;
    TOOLS.blocks.down(r.at(4, 4), r.env);
    TOOLS.blocks.up(r.at(4, 4), r.env);
    expect(r.env.opts.hotbar).toContain(6);
  });

  it('a drag along a face fills a line in one undo step, and a Shift-drag builds layers', () => {
    const r = rig({ x: 3, y: 4, z: -1, face: 'top' });
    // the pointer's line of sight on the plane of the face: worldAt returns the cell under it, so move to x = 7
    r.env.worldAt = (s) => ({ x: s.x, y: s.y });
    TOOLS.blocks.down(r.at(3, 4, { screen: { x: 3.5, y: 4.5 } }), r.env);
    TOOLS.blocks.move(r.at(7, 4, { screen: { x: 7.5, y: 4.5 } }), r.env);
    TOOLS.blocks.up(r.at(7, 4, { screen: { x: 7.5, y: 4.5 } }), r.env);
    const placed = [3, 4, 5, 6, 7].filter((x) => r.doc.map.blockAt(x, 4, 0)).length;
    expect(placed).toBeGreaterThanOrEqual(2); // a line began where the drag began
    const before = r.doc.map.stacks.size;
    r.doc.undo();
    expect(r.doc.map.stacks.size).toBeLessThan(before); // all of it in one step
  });
});
