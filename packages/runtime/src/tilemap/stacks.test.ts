import { describe, expect, it } from 'vitest';
import { TileMap, SLOPE } from './tilemap';
import { tileMapFromRows, tileMapToRows } from '../project/scene';
import { TileMapRowsSchema } from '../project/schema';
import { cellWalkable, surfaceAt } from '../physics/terrain';
import { Simulation } from '../core/simulation';
import { loadScene } from '../project/scene';
import { physicsSystem } from '../physics/physics';
import { C, type TransformIso } from '../scene/components';
import { CURRENT_SCHEMA_VERSION } from '../project/schema';

const q = { stepUp: 0.35, bodyHeight: 1.2 };

/** A 6 x 3 map of grass with a house wall along y = 1 (3 levels of brick) and an arch in the middle. */
function house(): TileMap {
  const m = new TileMap(8, 4);
  m.fill(1, 0);
  for (let x = 1; x <= 6; x++) m.set(x, 1, 5, 3); // brick wall, three levels
  return m;
}

describe('blocks', () => {
  it('a column turns into one block per level the first time a single block is edited', () => {
    const m = house();
    expect(m.getStack(2, 1)).toBeUndefined();
    expect(m.blockAt(2, 1, 1)).toEqual({ z: 1, tile: 5 });
    expect(m.setBlock(2, 1, 1, 6)).toBe(true);
    const s = m.getStack(2, 1)!;
    expect(s.blocks.map((b) => `${b.z}:${b.tile}`)).toEqual(['0:5', '1:6', '2:5']);
    // the column fields still describe the ground-level run
    expect(m.getHeight(2, 1)).toBe(3);
    expect(m.getTile(2, 1)).toBe(5);
    expect(m.runs(2, 1)).toEqual([{ bottom: 0, top: 3, tile: 5 }]);
  });

  it('allow gaps: an arch, a tunnel, a balcony', () => {
    const m = house();
    // an arch: take out the two lowest blocks of one cell, the lintel stays
    m.removeBlock(3, 1, 0);
    m.removeBlock(3, 1, 1);
    expect(m.runs(3, 1)).toEqual([{ bottom: 2, top: 3, tile: 5 }]);
    expect(m.getHeight(3, 1)).toBe(0); // the ground level of the cell is the floor now
    expect(m.getTile(3, 1)).toBe(5); // (the floor takes the tile that was at the bottom)
    expect(m.surfaces(3, 1)).toEqual([0, 3]);
    expect(m.topHeight(3, 1)).toBe(3);
    // a balcony: a block floating at level 4 over grass
    expect(m.setBlock(5, 3, 4, 6)).toBe(true);
    expect(m.runs(5, 3)).toEqual([{ bottom: 4, top: 5, tile: 6 }]);
    expect(m.getHeight(5, 3)).toBe(0);
    expect(m.getTile(5, 3)).toBe(1);
    // a block between two others splits the run into two
    expect(m.setBlock(5, 3, 1, 6)).toBe(true);
    expect(m.runs(5, 3).map((r) => `${r.bottom}-${r.top}`)).toEqual(['1-2', '4-5']);
  });

  it('keep a different tile on single faces, and put the block\'s own tile back with tile 0', () => {
    const m = house();
    m.setBlock(2, 1, 1, 6);
    expect(m.setBlockFace(2, 1, 1, 's', 4)).toBe(true);
    expect(m.setBlockFace(2, 1, 1, 'top', 2)).toBe(true);
    expect(m.blockAt(2, 1, 1)!.faces).toEqual({ s: 4, top: 2 });
    m.setBlockFace(2, 1, 1, 's', 0);
    expect(m.blockAt(2, 1, 1)!.faces).toEqual({ top: 2 });
  });

  it('cannot be made in stairs or decks, and are cleared when the cell is painted again', () => {
    const m = new TileMap(4, 4);
    m.fill(1, 0);
    m.set(1, 1, 2, 0);
    m.setSlope(1, 1, SLOPE.N, 'stairs');
    expect(m.setBlock(1, 1, 3, 2)).toBe(false);
    m.setBlock(2, 2, 2, 2);
    expect(m.getStack(2, 2)).toBeDefined();
    m.set(2, 2, 1, 0);
    expect(m.getStack(2, 2)).toBeUndefined();
    expect(m.getHeight(2, 2)).toBe(0);
  });

  it('are saved in scene files and read back, and old files without them still load', () => {
    const m = house();
    m.setBlock(2, 1, 1, 6);
    m.setBlockFace(2, 1, 1, 'e', 4);
    m.removeBlock(3, 1, 0);
    m.removeBlock(3, 1, 1);
    const rows = tileMapToRows(m);
    expect(rows.stacks).toHaveLength(2);
    expect(TileMapRowsSchema.safeParse(JSON.parse(JSON.stringify(rows))).success).toBe(true);
    const back = tileMapFromRows(TileMapRowsSchema.parse(JSON.parse(JSON.stringify(rows))));
    expect(back.runs(3, 1)).toEqual(m.runs(3, 1));
    expect(back.blockAt(2, 1, 1)).toEqual({ z: 1, tile: 6, faces: { e: 4 } });
    expect(back.getHeight(3, 1)).toBe(0);
    // a plain map has no stacks key at all
    expect(tileMapToRows(house()).stacks).toBeUndefined();
    expect(TileMap.fromJSON(m.toJSON()).blockAt(2, 1, 1)).toEqual({ z: 1, tile: 6, faces: { e: 4 } });
  });
});

describe('walking in and around blocks', () => {
  it('finds the floor under an arch and the top of the lintel, and solid wall beside it', () => {
    const m = house();
    m.removeBlock(3, 1, 0);
    m.removeBlock(3, 1, 1);
    // under the arch at ground level: stand on the floor, head clear of the lintel at level 2
    expect(surfaceAt(m, 3.5, 1.5, 0, q)).toEqual({ kind: 'ground', z: 0 });
    expect(cellWalkable(m, 3, 1)).toBe(true);
    // the wall next to it is a column three levels high (too high to step onto from the ground)
    expect(surfaceAt(m, 2.5, 1.5, 0, q)).toEqual({ kind: 'ground', z: 3 });
    // ...and a window block set into a wall makes that cell block by block, where the wall body itself is solid
    m.setBlock(4, 1, 1, 6);
    expect(surfaceAt(m, 4.5, 1.5, 0, q).kind).toBe('solid');
    // standing on top of the lintel (feet at level 3): the top of the run
    expect(surfaceAt(m, 3.5, 1.5, 3, q)).toEqual({ kind: 'ground', z: 3 });
    // a very tall body does not fit under it (the lintel starts at level 2)
    expect(surfaceAt(m, 3.5, 1.5, 0, { stepUp: 0.35, bodyHeight: 1.9 }).kind).toBe('ground');
    expect(surfaceAt(m, 3.5, 1.5, 0, { stepUp: 0.35, bodyHeight: 2.4 }).kind).toBe('solid');
  });

  it('lets a body walk through an arch in a wall and stops it at the wall, a window block in the middle changes nothing for walkers', () => {
    const m = house();
    m.removeBlock(3, 1, 0);
    m.removeBlock(3, 1, 1);
    m.setBlock(5, 1, 1, 6); // a window block in the wall: still solid
    const sim = new Simulation(1);
    sim.map = m;
    sim.addSystem('physics', physicsSystem, 'gameplay');
    const body = { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1.2, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 2, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false };
    const scene = { schemaVersion: CURRENT_SCHEMA_VERSION, name: 'T', map: tileMapToRows(m), entities: [
      { id: 'a', name: 'Through', tags: [], components: { transform: { x: 3.5, y: 0.4, h: 0, facing: 2 }, body: { ...body } } },
      { id: 'b', name: 'Blocked', tags: [], components: { transform: { x: 5.5, y: 0.4, h: 0, facing: 2 }, body: { ...body } } },
    ], regions: [], wires: [], variables: [], events: [] };
    const ids = loadScene(sim, scene);
    const a = ids.get('a')!;
    const b = ids.get('b')!;
    a.require<{ vy: number }>(C.Body).vy = 3;
    b.require<{ vy: number }>(C.Body).vy = 3;
    for (let i = 0; i < 90; i++) {
      a.require<{ vy: number }>(C.Body).vy = 3;
      b.require<{ vy: number }>(C.Body).vy = 3;
      sim.step();
    }
    expect(a.require<TransformIso>(C.Transform).y).toBeGreaterThan(2.2); // through the arch and out the other side
    expect(a.require<TransformIso>(C.Transform).h).toBe(0);
    expect(b.require<TransformIso>(C.Transform).y).toBeLessThan(1); // stopped by the wall
  });
});
