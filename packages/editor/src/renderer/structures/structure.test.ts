import { describe, expect, it } from 'vitest';
import { newScene } from '@tilewright/runtime';
import { EditorDoc } from '../model/doc';
import { readCell } from '../model/cells';
import { captureBlocks, clearEdits, fillEdits, hollowEdits, makeStructure, normalise, pasteEdits, placedEntities, replaceEdits, rotatePoint, rotateStructure, structureNameProblem, StructureSchema, type Region } from './structure';

const doc = (): EditorDoc => EditorDoc.fromScene(newScene('T', 20, 20, 1));
const cellAt = (d: EditorDoc) => (x: number, y: number) => (d.map.inBounds(x, y) ? readCell(d.map, x, y) : null);
const blocksOf = (d: EditorDoc, x: number, y: number): number[] => (readCell(d.map, x, y).stack?.blocks.map((b) => b.z) ?? []);
const tileAt = (d: EditorDoc, x: number, y: number, z: number): number | undefined => readCell(d.map, x, y).stack?.blocks.find((b) => b.z === z)?.tile;

describe('regions', () => {
  it('fill makes a solid cube, hollow leaves a shell, replace swaps tiles, clear takes them out', () => {
    const d = doc();
    const region: Region = { x0: 3, y0: 3, x1: 7, y1: 6, z0: 0, z1: 3 };
    d.paint('fill', fillEdits(region, 5));
    expect(blocksOf(d, 4, 4)).toEqual([0, 1, 2, 3]);
    expect(tileAt(d, 4, 4, 2)).toBe(5);
    d.paint('hollow', hollowEdits(region, 1));
    // the inside is open at the middle levels, the walls and the roof and floor stay
    expect(blocksOf(d, 5, 4)).toEqual([0, 3]);
    expect(blocksOf(d, 3, 4)).toEqual([0, 1, 2, 3]); // a wall column
    expect(blocksOf(d, 5, 3)).toEqual([0, 1, 2, 3]);
    d.paint('replace', replaceEdits(region, 5, 6));
    expect(tileAt(d, 3, 3, 1)).toBe(6);
    d.paint('clear', clearEdits({ x0: 3, y0: 3, x1: 3, y1: 3, z0: 1, z1: 2 }, 1));
    expect(blocksOf(d, 3, 3)).toEqual([0, 3]);
    d.undo();
    expect(blocksOf(d, 3, 3)).toEqual([0, 1, 2, 3]);
  });

  it('copy and paste move blocks, faces and gaps (an arch) to another place', () => {
    const d = doc();
    d.paint('wall', fillEdits({ x0: 2, y0: 2, x1: 4, y1: 2, z0: 0, z1: 2 }, 5));
    d.paint('arch', clearEdits({ x0: 3, y0: 2, x1: 3, y1: 2, z0: 0, z1: 1 }, 1));
    const s = makeStructure('Arch', { x0: 2, y0: 2, x1: 4, y1: 2, z0: 0, z1: 2 }, d, cellAt(d));
    expect(StructureSchema.parse(s)).toMatchObject({ w: 3, d: 1, h: 3 });
    expect(s.blocks).toHaveLength(3 + 1 + 3 - 0); // 3 columns of 3, minus the 2 under the arch
    d.paint('paste', pasteEdits(s, { x: 10, y: 10, z: 0 }, (x, y) => d.map.inBounds(x, y)));
    expect(blocksOf(d, 10, 10)).toEqual([0, 1, 2]);
    expect(blocksOf(d, 11, 10)).toEqual([2]); // the gap came along: it is an arch, not a wall
    expect(blocksOf(d, 12, 10)).toEqual([0, 1, 2]);
  });

  it('refuses nothing quietly: stairs cannot be split into blocks and are left alone', () => {
    const d = doc();
    d.paint('stairs', [{ x: 5, y: 5, patch: { slope: 1, height: 1 } }]);
    expect(captureBlocks({ x0: 5, y0: 5, x1: 5, y1: 5, z0: 0, z1: 3 }, cellAt(d))).toEqual([]);
    const edits = fillEdits({ x0: 5, y0: 5, x1: 5, y1: 5, z0: 0, z1: 1 }, 5);
    expect(edits[0]!.patch(readCell(d.map, 5, 5))).toEqual({});
  });
});

describe('turning a structure', () => {
  it('four quarter turns come back to the start, and a 3 x 1 wall becomes 1 x 3', () => {
    expect(rotatePoint(2, 0, 3, 1, 1)).toEqual({ x: 0, y: 2, w: 1, d: 3 });
    expect(rotatePoint(2, 0, 3, 1, 4)).toEqual({ x: 2, y: 0, w: 3, d: 1 });
    const d = doc();
    d.paint('wall', fillEdits({ x0: 2, y0: 2, x1: 4, y1: 2, z0: 0, z1: 0 }, 5));
    const s = makeStructure('Wall', { x0: 2, y0: 2, x1: 4, y1: 2, z0: 0, z1: 0 }, d, cellAt(d));
    const turned = rotateStructure(s, 1);
    expect([turned.w, turned.d]).toEqual([1, 3]);
    expect(turned.blocks.map((b) => `${b.x},${b.y}`).sort()).toEqual(['0,0', '0,1', '0,2']);
    const back = rotateStructure(rotateStructure(rotateStructure(turned, 1), 1), 1);
    expect(back.blocks.map((b) => `${b.x},${b.y}`).sort()).toEqual(s.blocks.map((b) => `${b.x},${b.y}`).sort());
  });

  it('the pictures on a face follow the face round: an east window ends up on the south', () => {
    const d = doc();
    d.paint('wall', fillEdits({ x0: 2, y0: 2, x1: 2, y1: 2, z0: 0, z1: 1 }, 5));
    d.addEntities([{ name: 'Window', tags: ['attachment'], components: { transform: { x: 2.97, y: 2.25, h: 1.5, facing: 2 }, attach: { face: '+x', left: 'w', right: '', cell: { x: 2, y: 2 }, z: 1, along: 0.25 } } }]);
    const s = makeStructure('Tower', { x0: 2, y0: 2, x1: 2, y1: 2, z0: 0, z1: 1 }, d, cellAt(d));
    expect(s.entities).toHaveLength(1);
    expect(s.entities[0]!.components.attach).toMatchObject({ face: '+x', cell: { x: 0, y: 0 }, z: 1 });
    const turned = rotateStructure(s, 1);
    expect(turned.entities[0]!.components.attach).toMatchObject({ face: '+y', cell: { x: 0, y: 0 }, along: 0.75 });
    const placed = placedEntities(turned, { x: 10, y: 5, z: 2 });
    expect(placed[0]!.components.attach).toMatchObject({ cell: { x: 10, y: 5 }, z: 3 });
    expect((placed[0]!.components.transform as { h: number }).h).toBeCloseTo(3.5);
  });
});

describe('names and sizes', () => {
  it('normalises regions and checks structure names', () => {
    expect(normalise({ x0: 5, y0: 5, x1: 2, y1: 1, z0: 3, z1: 0 })).toEqual({ x0: 2, y0: 1, x1: 5, y1: 5, z0: 0, z1: 3 });
    expect(structureNameProblem('', [])).toContain('name');
    expect(structureNameProblem('House', ['house'])).toContain('already');
    expect(structureNameProblem('a/b', [])).toContain('letters');
    expect(structureNameProblem('Ruin 2', ['House'])).toBeNull();
  });
});
