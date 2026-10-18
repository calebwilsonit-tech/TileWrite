import { describe, expect, it } from 'vitest';
import { FLAG, SLOPE, newScene } from '@tilewright/runtime';
import { EditorDoc } from '../model/doc';
import type { ToolOptions } from '../app/store';
import { TOOLS, toolState, type Pointer, type Preview, type ToolEnv } from './tools';
import type { ToolId } from '../app/store';

const baseOpts: ToolOptions = {
  tile: 2,
  size: 1,
  height: 3,
  density: 0.5,
  slopeDir: SLOPE.E,
  bridgeLevel: 1,
  blockFrom: 0,
  blockTo: 0,
  prefab: 'crate',
  outline: false,
  edge: 1,
  blockMode: 'add', spacing: 1, avoidPaths: true, attachment: '', zFrom: 0, zTo: 3,
};

function setup(w = 12, h = 12, opts: Partial<ToolOptions> = {}) {
  const doc = EditorDoc.fromScene(newScene('T', w, h));
  const log: { kind: string; text: string }[] = [];
  const connected: [string, string][] = [];
  const state = { selection: [] as string[], region: null as string | null, preview: [] as Preview[], walk: null as Set<string> | null, picks: new Map<string, string>() };
  const env: ToolEnv = {
    doc,
    pickTile: (tile) => tile,
    tileset: () => ({}),
    blockBox: () => null,
    setBlockBox: () => undefined,
    placing: () => null,
    rotatePlacing: () => undefined,
    opts: { ...baseOpts, ...opts },
    get selection() {
      return state.selection;
    },
    setPreview: (p) => (state.preview = p),
    select: (ids, region = null) => {
      state.selection = ids;
      state.region = region;
    },
    notify: (kind, text) => log.push({ kind, text }),
    setWalk: (c) => (state.walk = c),
    pickBlock: () => null,
    setMarquee: () => {},
    pickEntity: (s) => state.picks.get(`${s.x},${s.y}`) ?? null,
    pickRegion: () => null,
    prefabs: new Map(),
    connect: (a, b) => connected.push([a, b]),
    entityAnchor: () => ({ x: 0, y: 0, h: 0 }),
    entitiesInRect: () => [],
    worldAt: (s) => ({ x: s.x / 10, y: s.y / 10 }),
  };
  const ptr = (x: number, y: number, extra: Partial<Pointer> = {}): Pointer => ({
    cell: { x, y },
    screen: { x: x * 10 + 5, y: y * 10 + 5 },
    shift: false,
    alt: false,
    ctrl: false,
    ...extra,
  });
  const drag = (tool: ToolId, from: [number, number], to: [number, number], extra: Partial<Pointer> = {}): void => {
    const t = TOOLS[tool];
    t.down(ptr(...from, extra), env);
    t.move(ptr(...to, extra), env);
    t.up(ptr(...to, extra), env);
  };
  const click = (tool: ToolId, at: [number, number], extra: Partial<Pointer> = {}): void => drag(tool, at, at, extra);
  return { doc, env, state, log, ptr, drag, click, connected };
}

describe('paint tools', () => {
  it('brush paints along a drag with no gaps, as one undo step', () => {
    const { doc, drag } = setup();
    drag('paint', [1, 1], [8, 4]);
    let painted = 0;
    doc.map.forEach((_x, _y, t) => t === 2 && painted++);
    expect(painted).toBeGreaterThanOrEqual(8);
    expect(doc.map.getTile(1, 1)).toBe(2);
    expect(doc.map.getTile(8, 4)).toBe(2);
    expect(doc.history.labels).toEqual(['Paint tiles']);
    doc.undo();
    painted = 0;
    doc.map.forEach((_x, _y, t) => t === 2 && painted++);
    expect(painted).toBe(0);
  });

  it('brush size paints a square', () => {
    const { doc, click } = setup(12, 12, { size: 3 });
    click('paint', [5, 5]);
    let n = 0;
    doc.map.forEach((_x, _y, t) => t === 2 && n++);
    expect(n).toBe(9);
  });

  it('rectangle fills or outlines', () => {
    const a = setup();
    a.drag('rect', [2, 2], [5, 4]);
    let n = 0;
    a.doc.map.forEach((_x, _y, t) => t === 2 && n++);
    expect(n).toBe(12);
    const b = setup(12, 12, { outline: true });
    b.drag('rect', [2, 2], [5, 4]);
    n = 0;
    b.doc.map.forEach((_x, _y, t) => t === 2 && n++);
    expect(n).toBe(10);
    expect(b.doc.map.getTile(3, 3)).toBe(1);
  });

  it('line paints a straight line', () => {
    const { doc, drag } = setup();
    drag('line', [0, 0], [6, 0]);
    for (let x = 0; x <= 6; x++) expect(doc.map.getTile(x, 0)).toBe(2);
    expect(doc.map.getTile(7, 0)).toBe(1);
  });

  it('fill replaces a connected area only', () => {
    const { doc, click, log } = setup();
    for (let y = 0; y < 12; y++) doc.map.set(6, y, 5, 0);
    click('fill', [1, 1]);
    expect(doc.map.getTile(0, 0)).toBe(2);
    expect(doc.map.getTile(5, 11)).toBe(2);
    expect(doc.map.getTile(6, 5)).toBe(5);
    expect(doc.map.getTile(7, 0)).toBe(1);
    expect(log.at(-1)!.text).toMatch(/Filled 72 cells/);
  });

  it('fill does nothing if the tile is already the chosen one', () => {
    const { doc, click } = setup(6, 6, { tile: 1 });
    click('fill', [1, 1]);
    expect(doc.history.canUndo).toBe(false);
  });

  it('eraser empties cells completely', () => {
    const { doc, click } = setup();
    doc.paint('x', [{ x: 3, y: 3, patch: { height: 4, flags: FLAG.PIT } }]);
    click('eraser', [3, 3]);
    expect(doc.map.getTile(3, 3)).toBe(0);
    expect(doc.map.getHeight(3, 3)).toBe(0);
    expect(doc.map.getFlags(3, 3)).toBe(0);
  });

  it('scatter is deterministic and respects density', () => {
    const run = () => {
      const s = setup(30, 30, { size: 30, density: 0.3, tile: 3 });
      s.click('scatter', [15, 15]);
      let n = 0;
      s.doc.map.forEach((_x, _y, t) => t === 3 && n++);
      return { n, tiles: s.doc.toScene().map.tiles };
    };
    const a = run();
    const b = run();
    expect(a.tiles).toEqual(b.tiles);
    expect(a.n).toBeGreaterThan(150);
    expect(a.n).toBeLessThan(400);
  });

  it('stamp copies a pattern and places it', () => {
    const { doc, drag, click, log } = setup();
    doc.paint('x', [
      { x: 1, y: 1, patch: { tile: 5, height: 2 } },
      { x: 2, y: 1, patch: { tile: 4 } },
    ]);
    drag('stamp', [1, 1], [2, 1]);
    expect(toolState.pattern).toMatchObject({ w: 2, h: 1 });
    expect(log.at(-1)!.text).toMatch(/Copied a 2 x 1 pattern/);
    click('stamp', [6, 6]);
    expect(doc.map.getTile(6, 6)).toBe(5);
    expect(doc.map.getHeight(6, 6)).toBe(2);
    expect(doc.map.getTile(7, 6)).toBe(4);
    toolState.pattern = null;
  });
});

describe('height tools', () => {
  it('raise adds one level per gesture per cell, shift lowers', () => {
    const { doc, drag, click } = setup();
    drag('raise', [2, 2], [5, 2]);
    expect(doc.map.getHeight(3, 2)).toBe(1);
    click('raise', [3, 2]);
    expect(doc.map.getHeight(3, 2)).toBe(2);
    click('raise', [3, 2], { shift: true });
    expect(doc.map.getHeight(3, 2)).toBe(1);
  });

  it('raise does not touch empty space or go above the maximum', () => {
    const { doc, click } = setup();
    doc.paint('x', [{ x: 0, y: 0, patch: { tile: 0 } }]);
    click('raise', [0, 0]);
    expect(doc.map.getHeight(0, 0)).toBe(0);
    for (let i = 0; i < 20; i++) click('raise', [4, 4]);
    expect(doc.map.getHeight(4, 4)).toBe(12);
  });

  it('lower never goes below zero', () => {
    const { doc, click } = setup();
    click('lower', [3, 3]);
    expect(doc.map.getHeight(3, 3)).toBe(0);
  });

  it('set height sets an exact level and clears slopes', () => {
    const { doc, click } = setup(12, 12, { height: 4 });
    doc.map.setSlope(3, 3, SLOPE.E);
    click('setheight', [3, 3]);
    expect(doc.map.getHeight(3, 3)).toBe(4);
    expect(doc.map.getSlope(3, 3)).toBeNull();
  });

  it('smooth evens out a spike', () => {
    const { doc, click } = setup();
    doc.paint('x', [{ x: 5, y: 5, patch: { height: 9 } }]);
    click('smooth', [5, 5]);
    expect(doc.map.getHeight(5, 5)).toBeLessThan(3);
  });
});

describe('terrain tools', () => {
  it('stairs copy the base height from the floor they climb from and warn about a bad top', () => {
    const { doc, click, log } = setup();
    for (let y = 0; y < 12; y++) for (let x = 6; x < 12; x++) doc.map.set(x, y, 2, 1);
    click('stairs', [5, 5]); // climbs east onto the raised floor
    expect(doc.map.getSlope(5, 5)).toEqual({ dir: SLOPE.E, style: 'stairs' });
    expect(doc.map.getHeight(5, 5)).toBe(0);
    expect(log.at(-1)!.kind).toBe('info');
    doc.map.set(8, 8, 2, 4);
    click('ramp', [7, 8]); // rises to a mismatched cell
    expect(log.at(-1)!.kind).toBe('warn');
    expect(log.at(-1)!.text).toMatch(/level/);
  });

  it('dragging stairs builds a chain whose direction follows the drag', () => {
    const { doc, drag } = setup();
    for (let y = 0; y < 12; y++) for (let x = 6; x < 12; x++) doc.map.set(x, y, 2, 2);
    drag('stairs', [4, 5], [5, 5]);
    expect(doc.map.getSlope(4, 5)?.dir).toBe(SLOPE.E);
    expect(doc.map.getSlope(5, 5)?.dir).toBe(SLOPE.E);
    expect(doc.map.getHeight(4, 5)).toBe(0);
    expect(doc.map.getHeight(5, 5)).toBe(1); // second flight starts where the first ends
    expect(doc.history.labels).toEqual(['Build stairs']);
  });

  it('cliff raises a rectangle and clears slopes and pits inside', () => {
    const { doc, drag } = setup();
    doc.map.setSlope(3, 3, SLOPE.N);
    doc.map.setFlag(4, 3, FLAG.PIT);
    drag('cliff', [2, 2], [5, 5]);
    expect(doc.map.getHeight(3, 3)).toBe(3);
    expect(doc.map.getSlope(3, 3)).toBeNull();
    expect(doc.map.getFlags(4, 3)).toBe(0);
    expect(doc.map.getHeight(6, 6)).toBe(0);
  });

  it('pit paints holes and shift fills them back in', () => {
    const { doc, click } = setup();
    click('pit', [3, 3]);
    expect(doc.map.hasFlag(3, 3, FLAG.PIT)).toBe(true);
    click('pit', [3, 3], { shift: true });
    expect(doc.map.hasFlag(3, 3, FLAG.PIT)).toBe(false);
  });

  it('a pit painted on empty space gets a tile so it is drawn', () => {
    const { doc, click } = setup();
    click('eraser', [3, 3]);
    click('pit', [3, 3]);
    expect(doc.map.getTile(3, 3)).toBe(1);
    expect(doc.map.hasFlag(3, 3, FLAG.PIT)).toBe(true);
  });

  it('water sets the tile and flag, shift restores the chosen tile', () => {
    const { doc, click } = setup(12, 12, { tile: 3 });
    click('water', [2, 2]);
    expect(doc.map.getTile(2, 2)).toBe(4);
    expect(doc.map.hasFlag(2, 2, FLAG.WATER)).toBe(true);
    click('water', [2, 2], { shift: true });
    expect(doc.map.hasFlag(2, 2, FLAG.WATER)).toBe(false);
    expect(doc.map.getTile(2, 2)).toBe(3);
  });

  it('bridge adds and removes a deck', () => {
    const { doc, click } = setup(12, 12, { bridgeLevel: 2 });
    click('bridge', [4, 4]);
    expect(doc.map.getDeck(4, 4)).toBe(2);
    click('bridge', [4, 4], { shift: true });
    expect(doc.map.getDeck(4, 4)).toBe(0);
  });

  it('blocker paints and clears invisible walls', () => {
    const { doc, click } = setup();
    click('block', [1, 1]);
    expect(doc.map.hasFlag(1, 1, FLAG.BLOCK)).toBe(true);
    click('block', [1, 1], { shift: true });
    expect(doc.map.hasFlag(1, 1, FLAG.BLOCK)).toBe(false);
  });

  it('one-way edge toggles on and off', () => {
    const { doc, click } = setup(12, 12, { edge: 4 });
    click('oneway', [2, 2]);
    expect(doc.map.getOneWay(2, 2)).toBe(4);
    click('oneway', [2, 2]);
    expect(doc.map.getOneWay(2, 2)).toBe(0);
  });

  it('walk test reports reachable cells and does not change the map', () => {
    const { doc, click, state, log } = setup(8, 5);
    for (let y = 0; y < 5; y++) doc.map.set(4, y, 5, 3);
    click('walktest', [1, 2]);
    expect(state.walk!.has('3,2')).toBe(true);
    expect(state.walk!.has('6,2')).toBe(false);
    expect(log.at(-1)!.text).toMatch(/can walk to \d+ cells/);
    expect(doc.history.canUndo).toBe(false);
  });
});

describe('object tools', () => {
  it('places entities at the cell centre, on the ground height, with unique names', () => {
    const { doc, click, state } = setup();
    doc.map.set(3, 3, 2, 2);
    click('place', [3, 3]);
    click('place', [4, 4]);
    expect(doc.entities).toHaveLength(2);
    const t = doc.entities[0]!.components.transform as { x: number; y: number; h: number };
    expect(t).toMatchObject({ x: 3.5, y: 3.5, h: 2 });
    expect(doc.entities.map((e) => e.name)).toEqual(['Crate', 'Crate 2']);
    expect(state.selection).toEqual([doc.entities[1]!.id]);
    expect(doc.history.labels).toEqual(['Place crate', 'Place crate']);
  });

  it('placing the player start again moves the existing one', () => {
    const { doc, click } = setup(12, 12, { prefab: 'player' });
    click('place', [2, 2]);
    click('place', [8, 8]);
    expect(doc.entities.filter((e) => e.tags.includes('player'))).toHaveLength(1);
    expect(doc.entities[0]!.components.transform).toMatchObject({ x: 8.5, y: 8.5 });
  });

  it('select drags an object as one undoable move, snapped to half cells', () => {
    const { doc, env, state, ptr } = setup();
    const [e] = doc.addEntities([{ name: 'Box', tags: [], components: { transform: { x: 3.5, y: 3.5, h: 0, facing: 2 } } }]);
    state.picks.set('35,35', e!.id);
    const t = TOOLS.select;
    t.down(ptr(3, 3, { screen: { x: 35, y: 35 } }), env);
    expect(state.selection).toEqual([e!.id]);
    t.move(ptr(6, 4, { screen: { x: 65, y: 45 } }), env);
    t.up(ptr(6, 4, { screen: { x: 65, y: 45 } }), env);
    const tr = doc.getEntity(e!.id)!.components.transform as { x: number; y: number };
    expect(tr).toMatchObject({ x: 6.5, y: 4.5 });
    expect(doc.history.labels[0]).toBe('Move object');
    doc.undo();
    expect(doc.getEntity(e!.id)!.components.transform).toMatchObject({ x: 3.5, y: 3.5 });
  });

  it('cancelling a drag puts the object back without touching history', () => {
    const { doc, env, state, ptr } = setup();
    const [e] = doc.addEntities([{ name: 'Box', tags: [], components: { transform: { x: 3.5, y: 3.5, h: 0, facing: 2 } } }]);
    state.picks.set('35,35', e!.id);
    const before = doc.history.labels.length;
    TOOLS.select.down(ptr(3, 3, { screen: { x: 35, y: 35 } }), env);
    TOOLS.select.move(ptr(9, 9, { screen: { x: 95, y: 95 } }), env);
    TOOLS.select.cancel(env);
    expect(doc.getEntity(e!.id)!.components.transform).toMatchObject({ x: 3.5, y: 3.5 });
    expect(doc.history.labels.length).toBe(before);
  });

  it('region tool creates a region from a drag', () => {
    const { doc, drag, state } = setup();
    drag('region', [6, 2], [3, 4]);
    expect(doc.regions).toHaveLength(1);
    expect(doc.regions[0]).toMatchObject({ x: 3, y: 2, w: 4, h: 3, name: 'Room 1' });
    expect(state.region).toBe(doc.regions[0]!.id);
  });
});

describe('procedural helpers', () => {
  it('room builds walls around a flat floor, and refuses a room that is too small', () => {
    const { doc, drag, log } = setup(16, 16, { tile: 3, height: 3 });
    doc.map.setSlope(5, 5, SLOPE.E);
    doc.map.setFlag(6, 6, FLAG.PIT);
    drag('room', [3, 3], [9, 8]);
    expect(doc.map.getTile(3, 3)).toBe(5);
    expect(doc.map.getHeight(3, 3)).toBe(3);
    expect(doc.map.getHeight(9, 8)).toBe(3);
    expect(doc.map.getTile(5, 5)).toBe(3);
    expect(doc.map.getSlope(5, 5)).toBeNull(); // cleaned inside
    expect(doc.map.getFlags(6, 6)).toBe(0);
    expect(doc.map.getHeight(6, 5)).toBe(0);
    expect(doc.history.labels).toEqual(['Build room']);
    drag('room', [12, 12], [13, 13]);
    expect(log.at(-1)!.kind).toBe('warn');
  });

  it('corridor joins two points with a connected two-wide path', () => {
    const { doc, drag } = setup(20, 20, { tile: 2 });
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) doc.map.set(x, y, 0, 0);
    drag('corridor', [2, 2], [12, 10]);
    expect(doc.map.getTile(2, 2)).toBe(2);
    expect(doc.map.getTile(12, 10)).toBe(2);
    expect(doc.map.getTile(7, 3)).toBe(2); // two wide along the first leg
    // every carved cell is connected: walk from start to end
    const seen = new Set(['2,2']);
    const q: [number, number][] = [[2, 2]];
    while (q.length) {
      const [x, y] = q.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const k = `${x + dx},${y + dy}`;
        if (!seen.has(k) && doc.map.getTile(x + dx, y + dy) === 2) {
          seen.add(k);
          q.push([x + dx, y + dy]);
        }
      }
    }
    expect(seen.has('12,10')).toBe(true);
  });

  it('props scatter objects deterministically, avoiding hazards and existing objects, as one undo step', () => {
    const run = () => {
      const s = setup(20, 20, { prefab: 'pillar', density: 0.8 });
      s.doc.map.setFlag(4, 4, FLAG.WATER);
      s.doc.map.setFlag(5, 4, FLAG.PIT);
      s.doc.map.setSlope(6, 4, SLOPE.E);
      s.drag('props', [2, 2], [12, 12]);
      return s;
    };
    const a = run();
    const b = run();
    expect(a.doc.entities.map((e) => e.components.transform)).toEqual(b.doc.entities.map((e) => e.components.transform));
    expect(a.doc.entities.length).toBeGreaterThan(20);
    const cells = a.doc.entities.map((e) => {
      const t = e.components.transform as { x: number; y: number };
      return `${Math.floor(t.x)},${Math.floor(t.y)}`;
    });
    expect(cells).not.toContain('4,4');
    expect(cells).not.toContain('5,4');
    expect(cells).not.toContain('6,4');
    expect(new Set(cells).size).toBe(cells.length);
    expect(a.doc.history.labels).toHaveLength(1);
    expect(a.doc.history.labels[0]).toMatch(/^Scatter props/);
    a.doc.undo();
    expect(a.doc.entities).toHaveLength(0);
  });

  it('props refuses the player start', () => {
    const { doc, drag, log } = setup(10, 10, { prefab: 'player' });
    drag('props', [1, 1], [5, 5]);
    expect(doc.entities).toHaveLength(0);
    expect(log.at(-1)!.kind).toBe('warn');
  });
});

describe('gestures', () => {
  it('cancel on a brush stroke leaves the map untouched', () => {
    const { doc, env, ptr } = setup();
    TOOLS.paint.down(ptr(2, 2), env);
    TOOLS.paint.move(ptr(5, 2), env);
    TOOLS.paint.cancel(env);
    expect(doc.map.getTile(3, 2)).toBe(1);
    expect(doc.history.canUndo).toBe(false);
  });

  it('ignores clicks outside the map', () => {
    const { doc, env } = setup();
    for (const id of Object.keys(TOOLS) as ToolId[]) {
      if (id === 'select' || id === 'stamp') continue;
      expect(() => {
        TOOLS[id].down({ cell: { x: -3, y: 99 }, screen: { x: 0, y: 0 }, shift: false, alt: false, ctrl: false }, env);
        TOOLS[id].up({ cell: { x: -3, y: 99 }, screen: { x: 0, y: 0 }, shift: false, alt: false, ctrl: false }, env);
      }, id).not.toThrow();
    }
    expect(doc.entities).toHaveLength(0);
  });
});

describe('patrol path tool', () => {
  function guardDoc() {
    const s = setup(16, 16);
    const [g] = s.doc.addEntities([{ name: 'Guard', tags: [], components: { transform: { x: 2.5, y: 2.5, h: 0, facing: 2 }, patrol: { points: '', mode: 'loop', speed: 1.8, waitSeconds: 0.8 } } }]);
    return { ...s, id: g!.id };
  }
  const points = (s: ReturnType<typeof guardDoc>): string => (s.doc.getEntity(s.id)!.components.patrol as { points: string }).points;

  it('adds waypoints at cell centres to the selected guard, and shift-click removes the last', () => {
    const s = guardDoc();
    s.state.selection = [s.id];
    s.click('patrol', [5, 5]);
    s.click('patrol', [9, 5]);
    s.click('patrol', [9, 9]);
    expect(points(s)).toBe('5.5,5.5; 9.5,5.5; 9.5,9.5');
    s.click('patrol', [9, 9], { shift: true });
    expect(points(s)).toBe('5.5,5.5; 9.5,5.5');
    s.doc.history.undo();
    expect(points(s)).toBe('5.5,5.5; 9.5,5.5; 9.5,9.5');
  });

  it('asks for a guard first when nothing suitable is selected', () => {
    const s = guardDoc();
    s.click('patrol', [5, 5]);
    expect(points(s)).toBe('');
    expect(s.log.some((l) => /Select a guard first/.test(l.text))).toBe(true);
  });

  it('clicking a guard selects it instead of adding a point', () => {
    const s = guardDoc();
    s.state.picks.set('55,55', s.id);
    s.click('patrol', [5, 5]);
    expect(s.state.selection).toEqual([s.id]);
    expect(points(s)).toBe('');
  });
});

describe('the blocker tool with levels', () => {
  it('paints a blocker for every height by default, and one limited to some levels when asked', () => {
    const a = setup();
    a.click('block', [2, 2]);
    expect(a.doc.map.getFlags(2, 2) & FLAG.BLOCK).toBe(FLAG.BLOCK);
    expect(a.doc.map.getBlockBand(2, 2)).toBeNull();

    const b = setup(12, 12, { blockFrom: 1, blockTo: 3 });
    b.click('block', [4, 4]);
    expect(b.doc.map.getBlockBand(4, 4)).toEqual({ low: 1, high: 3 });
    b.doc.undo();
    expect(b.doc.map.getFlags(4, 4)).toBe(0);
    expect(b.doc.map.getBlockBand(4, 4)).toBeNull();
    b.doc.redo();
    expect(b.doc.map.getBlockBand(4, 4)).toEqual({ low: 1, high: 3 });
  });

  it('Shift clears the blocker and its levels, and the eraser does too', () => {
    const { doc, click } = setup(12, 12, { blockFrom: 0, blockTo: 2 });
    click('block', [3, 3]);
    click('block', [3, 3], { shift: true });
    expect(doc.map.getFlags(3, 3) & FLAG.BLOCK).toBe(0);
    expect(doc.map.getBlockBand(3, 3)).toBeNull();
    click('block', [5, 5]);
    click('eraser', [5, 5]);
    expect(doc.map.getBlockBand(5, 5)).toBeNull();
    expect(doc.map.getFlags(5, 5)).toBe(0);
  });
});
