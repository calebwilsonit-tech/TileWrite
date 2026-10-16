import { describe, expect, it } from 'vitest';
import { FLAG, SLOPE, TileMap, newScene } from '@tilewright/runtime';
import { readCell } from './cells';
import { EditorDoc, type DocEvent } from './doc';
import { History } from './history';
import {
  brushCells,
  capturePattern,
  collisionKind,
  floodFill,
  highSide,
  lineBetween,
  lowSide,
  planSlope,
  rectCells,
  scatter,
  smoothedHeights,
  stampCells,
} from '../tools/algorithms';

function doc(w = 8, h = 8): EditorDoc {
  return EditorDoc.fromScene(newScene('Test', w, h));
}

describe('History', () => {
  it('undoes and redoes in order and drops the redo branch on a new action', () => {
    const h = new History();
    let v = 0;
    const add = (n: number, label: string) => h.run({ label, redo: () => (v += n), undo: () => (v -= n) });
    add(1, 'a');
    add(10, 'b');
    expect(v).toBe(11);
    expect(h.undo()).toBe('b');
    expect(v).toBe(1);
    expect(h.redo()).toBe('b');
    expect(v).toBe(11);
    h.undo();
    add(100, 'c');
    expect(h.canRedo).toBe(false);
    expect(h.labels).toEqual(['c', 'a']);
  });

  it('groups a batch into one step', () => {
    const h = new History();
    let v = 0;
    h.batch('many', () => {
      for (let i = 0; i < 5; i++) h.run({ label: 'x', redo: () => v++, undo: () => v-- });
    });
    expect(v).toBe(5);
    expect(h.labels).toEqual(['many']);
    h.undo();
    expect(v).toBe(0);
    h.redo();
    expect(v).toBe(5);
  });

  it('caps its size', () => {
    const h = new History(3);
    for (let i = 0; i < 10; i++) h.run({ label: String(i), redo: () => {}, undo: () => {} });
    expect(h.labels).toEqual(['9', '8', '7']);
  });
});

describe('EditorDoc map edits', () => {
  it('paints a stroke immediately and undoes it as one step', () => {
    const d = doc();
    const s = d.beginStroke('Paint stone');
    s.apply(1, 1, { tile: 2 });
    s.apply(2, 1, { tile: 2 });
    s.apply(1, 1, { height: 3 }); // same cell twice in one stroke
    expect(d.map.getTile(1, 1)).toBe(2);
    expect(d.map.getHeight(1, 1)).toBe(3);
    s.commit();
    expect(d.history.labels).toEqual(['Paint stone']);
    d.undo();
    expect(readCell(d.map, 1, 1)).toEqual(readCell(d.map, 5, 5));
    expect(d.map.getTile(2, 1)).toBe(1);
    d.redo();
    expect(d.map.getTile(1, 1)).toBe(2);
    expect(d.map.getHeight(1, 1)).toBe(3);
  });

  it('adds nothing to the history when a stroke changes nothing', () => {
    const d = doc();
    const s = d.beginStroke('Nothing');
    s.apply(0, 0, { tile: 1 }); // already tile 1
    s.commit();
    expect(d.history.canUndo).toBe(false);
  });

  it('cancels a stroke back to the original cells', () => {
    const d = doc();
    const s = d.beginStroke('Oops');
    s.apply(3, 3, { tile: 4 });
    s.cancel();
    expect(d.map.getTile(3, 3)).toBe(1);
    expect(d.history.canUndo).toBe(false);
  });

  it('ignores out-of-bounds cells', () => {
    const d = doc();
    expect(d.beginStroke('x').apply(-1, 0, { tile: 2 })).toBe(false);
    expect(d.beginStroke('x').apply(99, 99, { tile: 2 })).toBe(false);
  });

  it('emits cell events so views can update only what changed', () => {
    const d = doc();
    const events: DocEvent[] = [];
    d.subscribe((e) => events.push(e));
    d.paint('p', [{ x: 2, y: 2, patch: { tile: 3 } }]);
    expect(events.some((e) => e.type === 'cells' && e.cells.some((c) => c.x === 2 && c.y === 2))).toBe(true);
    events.length = 0;
    d.undo();
    expect(events.some((e) => e.type === 'cells')).toBe(true);
  });

  it('tracks the dirty flag', () => {
    const d = doc();
    expect(d.dirty).toBe(false);
    d.paint('p', [{ x: 0, y: 0, patch: { tile: 2 } }]);
    expect(d.dirty).toBe(true);
    d.markSaved();
    expect(d.dirty).toBe(false);
    d.undo();
    expect(d.dirty).toBe(true);
  });

  it('resizes the map keeping existing cells, and undoes it', () => {
    const d = doc(4, 4);
    d.paint('p', [{ x: 3, y: 3, patch: { tile: 5, height: 2 } }]);
    d.resizeMap(6, 3);
    expect(d.map.width).toBe(6);
    expect(d.map.height).toBe(3);
    expect(d.map.getTile(3, 2)).toBe(1);
    d.undo();
    expect(d.map.width).toBe(4);
    expect(d.map.getTile(3, 3)).toBe(5);
    expect(d.map.getHeight(3, 3)).toBe(2);
  });
});

describe('EditorDoc entities and regions', () => {
  it('adds, updates and deletes entities with full undo', () => {
    const d = doc();
    const [a] = d.addEntities([{ name: 'Crate', tags: [], components: { transform: { x: 1, y: 1, h: 0, facing: 2 } } }]);
    expect(a!.id).toMatch(/^e\d+$/);
    d.updateEntities([a!.id], 'Move', (e) => {
      (e.components.transform as { x: number }).x = 4;
    });
    expect((d.getEntity(a!.id)!.components.transform as { x: number }).x).toBe(4);
    d.removeEntities([a!.id]);
    expect(d.entities).toHaveLength(0);
    d.undo();
    expect(d.entities).toHaveLength(1);
    d.undo();
    expect((d.getEntity(a!.id)!.components.transform as { x: number }).x).toBe(1);
    d.undo();
    expect(d.entities).toHaveLength(0);
    d.redo();
    d.redo();
    d.redo();
    expect(d.entities).toHaveLength(0);
  });

  it('gives each entity a unique id, even after deletes and loads', () => {
    const d = doc();
    const [a, b] = d.addEntities([
      { name: 'A', tags: [], components: {} },
      { name: 'B', tags: [], components: {} },
    ]);
    d.removeEntities([b!.id]);
    const [c] = d.addEntities([{ name: 'C', tags: [], components: {} }]);
    expect(new Set([a!.id, b!.id, c!.id]).size).toBe(3);
    const reloaded = EditorDoc.fromScene(d.toScene());
    const [e] = reloaded.addEntities([{ name: 'E', tags: [], components: {} }]);
    expect([a!.id, c!.id]).not.toContain(e!.id);
  });

  it('does not alias the data you pass in or read out', () => {
    const d = doc();
    const init = { name: 'X', tags: ['t'], components: { transform: { x: 0, y: 0, h: 0, facing: 0 } } };
    const [e] = d.addEntities([init]);
    init.tags.push('changed');
    expect(d.getEntity(e!.id)!.tags).toEqual(['t']);
    const scene = d.toScene();
    scene.entities[0]!.name = 'hacked';
    expect(d.getEntity(e!.id)!.name).toBe('X');
  });

  it('does nothing when an update changes nothing', () => {
    const d = doc();
    const [e] = d.addEntities([{ name: 'X', tags: [], components: {} }]);
    const before = d.history.labels.length;
    d.updateEntities([e!.id], 'noop', () => {});
    expect(d.history.labels.length).toBe(before);
  });

  it('manages regions with undo', () => {
    const d = doc();
    const r = d.addRegion({ name: 'Room', x: 0, y: 0, w: 4, h: 4, cameraBounds: true, music: '', darkness: 0, bossActive: false });
    d.updateRegion(r.id, 'Darken', (x) => (x.darkness = 0.5));
    expect(d.regions[0]!.darkness).toBe(0.5);
    d.removeRegion(r.id);
    expect(d.regions).toHaveLength(0);
    d.undo();
    expect(d.regions).toHaveLength(1);
    d.undo();
    expect(d.regions[0]!.darkness).toBe(0);
  });

  it('serialises back to a valid scene', () => {
    const d = doc(5, 4);
    d.paint('p', [{ x: 1, y: 1, patch: { tile: 2, height: 1 } }]);
    d.addEntities([{ name: 'A', tags: ['player'], components: {} }]);
    const s = d.toScene();
    expect(s.map.heights[1]![1]).toBe(1);
    expect(s.entities[0]!.tags).toEqual(['player']);
    const again = EditorDoc.fromScene(s);
    expect(again.map.getTile(1, 1)).toBe(2);
  });
});

describe('tool algorithms', () => {
  it('lists rectangle cells regardless of corner order', () => {
    expect(rectCells({ x: 3, y: 2 }, { x: 1, y: 1 })).toHaveLength(6);
    expect(rectCells({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
  });

  it('draws gap-free lines in every direction', () => {
    for (const [a, b] of [
      [{ x: 0, y: 0 }, { x: 7, y: 3 }],
      [{ x: 7, y: 3 }, { x: 0, y: 0 }],
      [{ x: 2, y: 5 }, { x: 2, y: 0 }],
      [{ x: 0, y: 0 }, { x: 5, y: 5 }],
    ] as const) {
      const cells = lineBetween(a, b);
      expect(cells[0]).toEqual(a);
      expect(cells.at(-1)).toEqual(b);
      for (let i = 1; i < cells.length; i++) {
        expect(Math.max(Math.abs(cells[i]!.x - cells[i - 1]!.x), Math.abs(cells[i]!.y - cells[i - 1]!.y))).toBe(1);
      }
    }
  });

  it('makes square brushes of any size', () => {
    expect(brushCells(5, 5, 1)).toEqual([{ x: 5, y: 5 }]);
    expect(brushCells(5, 5, 3)).toHaveLength(9);
    expect(brushCells(5, 5, 4)).toHaveLength(16);
  });

  it('flood fills a region and stops at borders', () => {
    const m = new TileMap(6, 6);
    m.fill(1);
    for (let y = 0; y < 6; y++) m.set(3, y, 2); // wall splitting the map
    const left = floodFill(m, { x: 0, y: 0 }, (c) => c.tile === 1);
    expect(left).toHaveLength(18);
    expect(left.every((c) => c.x < 3)).toBe(true);
    expect(floodFill(m, { x: 3, y: 0 }, (c) => c.tile === 1)).toEqual([]); // start doesn't match
    expect(floodFill(m, { x: 99, y: 0 }, () => true)).toEqual([]);
  });

  it('respects the flood fill limit', () => {
    const m = new TileMap(50, 50);
    m.fill(1);
    expect(floodFill(m, { x: 0, y: 0 }, () => true, 100).length).toBe(100);
  });

  it('scatters deterministically at roughly the requested density', () => {
    const cells = rectCells({ x: 0, y: 0 }, { x: 49, y: 49 });
    const a = scatter(cells, 0.3, 7);
    const b = scatter(cells, 0.3, 7);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(600);
    expect(a.length).toBeLessThan(900);
    expect(scatter(cells, 0, 1)).toEqual([]);
    expect(scatter(cells, 1, 1)).toHaveLength(2500);
  });

  it('smooths a spike toward its neighbours', () => {
    const m = new TileMap(5, 5);
    m.fill(1, 0);
    m.set(2, 2, 1, 9);
    const out = smoothedHeights(m, [{ x: 2, y: 2 }]);
    expect(out).toEqual([{ x: 2, y: 2, height: 1 }]);
  });

  it('knows which side stairs climb from and to', () => {
    expect(lowSide(5, 5, SLOPE.E)).toEqual({ x: 4, y: 5 });
    expect(highSide(5, 5, SLOPE.E)).toEqual({ x: 6, y: 5 });
    expect(lowSide(5, 5, SLOPE.N)).toEqual({ x: 5, y: 6 });
    expect(highSide(5, 5, SLOPE.N)).toEqual({ x: 5, y: 4 });
    expect(lowSide(5, 5, SLOPE.S)).toEqual({ x: 5, y: 4 });
    expect(lowSide(5, 5, SLOPE.W)).toEqual({ x: 6, y: 5 });
  });

  it('plans stairs that meet the floor, and warns when the top does not line up', () => {
    const m = new TileMap(8, 4);
    m.fill(1, 0);
    for (let y = 0; y < 4; y++) for (let x = 5; x < 8; x++) m.set(x, y, 2, 1);
    const ok = planSlope(m, 4, 1, SLOPE.E, 'stairs');
    expect(ok.warnings).toEqual([]);
    expect(ok.patch.height).toBe(0);
    expect(ok.patch.slope).toBe(SLOPE.E | 8);

    m.set(5, 1, 2, 3); // wrong height on top
    const bad = planSlope(m, 4, 1, SLOPE.E, 'ramp');
    expect(bad.warnings.join(' ')).toMatch(/level 1 but the next cell is at level 3/);
    expect(bad.patch.slope).toBe(SLOPE.E);
  });

  it('accepts a bridge deck as the top of a ramp', () => {
    const m = new TileMap(6, 3);
    m.fill(1, 0);
    m.setDeck(3, 1, 1, 6);
    const p = planSlope(m, 2, 1, SLOPE.E, 'ramp');
    expect(p.warnings).toEqual([]);
    m.setDeck(3, 1, 2, 6);
    expect(planSlope(m, 2, 1, SLOPE.E, 'ramp').warnings.join(' ')).toMatch(/level 1/);
  });

  it('chains stairs: a second flight starts from the top of the first', () => {
    const m = new TileMap(8, 3);
    m.fill(1, 0);
    for (let y = 0; y < 3; y++) for (let x = 5; x < 8; x++) m.set(x, y, 2, 2);
    m.set(3, 1, 2, 0);
    m.setSlope(3, 1, SLOPE.E, 'stairs');
    const p = planSlope(m, 4, 1, SLOPE.E, 'stairs');
    expect(p.patch.height).toBe(1); // starts where the first flight ends
    expect(p.warnings).toEqual([]);
  });

  it('classifies cells for the collision overlay', () => {
    const m = new TileMap(6, 1);
    m.fill(1);
    m.set(0, 0, 0);
    m.setFlag(1, 0, FLAG.BLOCK);
    m.setFlag(2, 0, FLAG.PIT);
    m.setFlag(3, 0, FLAG.WATER);
    m.setSlope(4, 0, SLOPE.E);
    expect(['void', 'blocked', 'pit', 'water', 'stair', 'walkable'].every((k, i) => collisionKind(m, i, 0) === k)).toBe(true);
    m.setDeck(2, 0, 1);
    expect(collisionKind(m, 2, 0)).toBe('deck');
    expect(collisionKind(m, -1, 0)).toBe('void');
  });

  it('captures and stamps patterns', () => {
    const m = new TileMap(6, 6);
    m.fill(1);
    m.set(1, 1, 2, 1);
    m.set(2, 1, 5, 2);
    const p = capturePattern(m, { x: 2, y: 2 }, { x: 1, y: 1 });
    expect(p.w).toBe(2);
    expect(p.h).toBe(2);
    const cells = stampCells(p, 4, 4);
    expect(cells).toHaveLength(4);
    expect(cells[0]).toMatchObject({ x: 4, y: 4, cell: { tile: 2, height: 1 } });
    expect(cells[1]).toMatchObject({ x: 5, y: 4, cell: { tile: 5, height: 2 } });
  });
});
