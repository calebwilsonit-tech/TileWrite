import { describe, expect, it } from 'vitest';
import { FLAG, tileMapToRows, type SceneData } from '@tilewright/runtime';
import { flatScene, player, thing } from '@tilewright/plugin-sdk/testing';
import { analyseLevel, cellKey, fixedCells, goalsOf, prepare, reachCells, walkerOf, solidCells } from '@tilewright/playbot';
import { analysePushPuzzles, extractPushPuzzle, solvePush } from '@tilewright/playbot';
import '@tilewright/bundled-plugins/tooling';

function room(w = 16, h = 10) {
  const fs = flatScene(w, h);
  return fs;
}

/** A wall down column x with a doorway at the given rows (the rest is blocked). */
function wallWithDoor(map: ReturnType<typeof flatScene>['map'], x: number, doorRows: number[]): void {
  for (let y = 0; y < map.height; y++) if (!doorRows.includes(y)) map.setFlag(x, y, FLAG.BLOCK);
}

const gateAt = (id: string, x: number, y: number) => thing(id, 'Gate ' + id, x, y, { gate: {} }, { collider: { w: 1, d: 1, height: 1.6, solid: true, trigger: false, layer: 1, mask: 65535, enabled: true, inside: [] } });
const goalAt = (x: number, y: number) => ({ ...thing('goal', 'Treasure', x, y, {}), tags: ['goal'] });

function sceneOf(fs: ReturnType<typeof flatScene>, ...entities: SceneData['entities']): SceneData {
  fs.scene.map = tileMapToRows(fs.map);
  fs.scene.entities.push(...entities);
  return fs.scene;
}

describe('reachability', () => {
  it('knows what the player can walk to, around walls, and what jumping adds', () => {
    const fs = room();
    wallWithDoor(fs.map, 8, [4]);
    const prep = prepare(sceneOf(fs, player('p', 2.5, 4.5)));
    const walker = walkerOf(prep.player, false);
    const all = reachCells(prep.map, { x: 2, y: 4 }, walker);
    expect(all.has(cellKey(12, 4))).toBe(true); // through the doorway
    expect(all.has(cellKey(8, 2))).toBe(false); // the wall
    const blocked = new Set([cellKey(8, 4)]);
    expect(reachCells(prep.map, { x: 2, y: 4 }, walker, blocked).has(cellKey(12, 4))).toBe(false); // doorway shut
  });

  it('a one-cell pit can be hopped, a wide one cannot', () => {
    const make = (width: number) => {
      const fs = room(20, 6);
      for (let y = 0; y < 6; y++) for (let x = 8; x < 8 + width; x++) fs.map.setFlag(x, y, FLAG.PIT);
      return prepare(sceneOf(fs, player('p', 2.5, 2.5)));
    };
    const one = make(1);
    expect(reachCells(one.map, { x: 2, y: 2 }, walkerOf(one.player, true)).has(cellKey(15, 2))).toBe(true);
    expect(reachCells(one.map, { x: 2, y: 2 }, walkerOf(one.player, false)).has(cellKey(15, 2))).toBe(false);
    const wide = make(3);
    expect(reachCells(wide.map, { x: 2, y: 2 }, walkerOf(wide.player, true)).has(cellKey(15, 2))).toBe(false);
  });

  it('reads fixed scenery and closed gates as blocked cells', () => {
    const fs = room();
    const pillar = thing('pil', 'Pillar', 5.5, 5.5, {}, { collider: { w: 0.9, d: 0.9, height: 2, solid: true, trigger: false, layer: 1, mask: 65535, enabled: true, inside: [] } });
    const prep = prepare(sceneOf(fs, player('p', 2.5, 2.5), pillar, gateAt('g', 7.5, 5.5)));
    expect(fixedCells(prep.entities).has(cellKey(5, 5))).toBe(true);
    expect(fixedCells(prep.entities).has(cellKey(7, 5))).toBe(false); // gates are not fixed
    expect(solidCells(prep.entities, (e) => e.id === 'g').has(cellKey(7, 5))).toBe(true);
    expect(goalsOf(prep.entities)).toEqual([]);
  });
});

describe('analyseLevel', () => {
  it('is quiet for a goal properly behind a gate', () => {
    const fs = room();
    wallWithDoor(fs.map, 8, [4]);
    const scene = sceneOf(fs, player('p', 2.5, 4.5), gateAt('g', 8.5, 4.5), goalAt(12.5, 4.5));
    expect(analyseLevel(scene)).toEqual([]);
  });

  it('finds a goal that can be reached without the gate (a wider doorway)', () => {
    const fs = room();
    wallWithDoor(fs.map, 8, [3, 4]);
    const issues = analyseLevel(sceneOf(fs, player('p', 2.5, 4.5), gateAt('g', 8.5, 4.5), goalAt(12.5, 4.5)));
    expect(issues.map((i) => i.id).sort()).toEqual(['gate-useless-g', 'goal-bypass-goal']);
    expect(issues.find((i) => i.id === 'goal-bypass-goal')!.message).toMatch(/bypassed/);
    expect(issues.find((i) => i.id === 'gate-useless-g')!.message).toMatch(/blocks nothing/);
  });

  it('finds a bypass by jumping over a pit next to a bridge gate, and not when the player cannot jump', () => {
    const build = (jumpSpeed: number) => {
      const fs = room(20, 8);
      for (let y = 0; y < 8; y++) fs.map.setFlag(9, y, FLAG.PIT);
      fs.map.setDeck(9, 4, 1);
      fs.map.setFlag(9, 4, FLAG.PIT);
      const p = player('p', 2.5, 4.5);
      (p.components.playerController as { jumpSpeed: number }).jumpSpeed = jumpSpeed;
      return sceneOf(fs, p, gateAt('g', 9.5, 4.5), goalAt(14.5, 2.5));
    };
    // (with a 1-level deck the walker would need a ramp; the pit hop is what matters here)
    const jumper = analyseLevel(build(11));
    expect(jumper.some((i) => i.id === 'goal-bypass-goal')).toBe(true);
    const walker = analyseLevel(build(0));
    expect(walker.some((i) => i.id === 'goal-bypass-goal')).toBe(false);
  });

  it('reports a goal that is walled off completely as an error', () => {
    const fs = room();
    for (let x = 11; x <= 13; x++) for (let y = 2; y <= 4; y++) if (x === 11 || x === 13 || y === 2 || y === 4) fs.map.setFlag(x, y, FLAG.BLOCK);
    const issues = analyseLevel(sceneOf(fs, player('p', 2.5, 4.5), goalAt(12.5, 3.5)));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id: 'goal-unreachable-goal', severity: 'error' });
    expect(issues[0]!.message).toMatch(/cannot be reached even with every gate open/);
  });

  it('ignores scenes without a player, and goals with no gates around', () => {
    expect(analyseLevel(sceneOf(room(), goalAt(5.5, 5.5)))).toEqual([]);
    expect(analyseLevel(sceneOf(room(), player('p', 2.5, 2.5), goalAt(5.5, 5.5)))).toEqual([]);
  });
});

describe('crate puzzles', () => {
  const plateAt = (x: number, y: number) => thing('plate', 'Plate', x, y, { pressurePlate: { activatedBy: 'crates' } });
  const crateAt = (id: string, x: number, y: number) => thing(id, 'Crate ' + id, x, y, { pushable: {} }, { collider: { w: 0.9, d: 0.9, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } });

  /** A dead-end corridor along row 5 with walls above and below. */
  function corridor() {
    const fs = room(14, 10);
    for (let x = 0; x < 14; x++) {
      fs.map.setFlag(x, 4, FLAG.BLOCK);
      fs.map.setFlag(x, 6, FLAG.BLOCK);
    }
    fs.map.setFlag(10, 5, FLAG.BLOCK);
    return fs;
  }

  it('finds the pushes that solve a corridor and no soft-locks in it', () => {
    const fs = corridor();
    const scene = sceneOf(fs, player('p', 3.5, 5.5), crateAt('c', 5.5, 5.5), plateAt(9.5, 5.5));
    const r = solvePush(extractPushPuzzle(scene)!);
    expect(r.solvable).toBe(true);
    expect(r.moves).toHaveLength(4);
    expect(r.moves.every((m) => m.dir[0] === 1 && m.dir[1] === 0)).toBe(true);
    expect(r.deadStates).toBe(0);
    expect(analysePushPuzzles(scene)).toEqual([]);
  });

  it('warns that an open room can be soft-locked and shows the push that does it', () => {
    const fs = room(12, 10);
    const scene = sceneOf(fs, player('p', 2.5, 5.5), crateAt('c', 5.5, 5.5), plateAt(8.5, 5.5));
    const r = solvePush(extractPushPuzzle(scene)!);
    expect(r.solvable).toBe(true);
    expect(r.deadStates).toBeGreaterThan(0);
    expect(r.trap).toBeDefined();
    const issues = analysePushPuzzles(scene);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id: 'push-softlock', severity: 'warning' });
    expect(issues[0]!.message).toMatch(/can be soft-locked/);
  });

  it('says a puzzle is impossible: crate stuck in a corner, or too few crates', () => {
    const fs = room(12, 10);
    const stuck = sceneOf(fs, player('p', 5.5, 5.5), crateAt('c', 0.5, 0.5), plateAt(8.5, 5.5));
    expect(analysePushPuzzles(stuck)[0]).toMatchObject({ id: 'push-unsolvable', severity: 'error' });
    const few = sceneOf(room(12, 10), player('p', 2.5, 5.5), crateAt('c', 5.5, 5.5), plateAt(8.5, 5.5), { ...plateAt(8.5, 7.5), id: 'plate2', name: 'Plate 2' });
    expect(analysePushPuzzles(few)[0]).toMatchObject({ id: 'push-unsolvable' });
  });

  it('is quiet when there are no crates or no plates that take crates, and gives up politely on huge searches', () => {
    expect(analysePushPuzzles(sceneOf(room(), player('p', 2.5, 5.5), plateAt(8.5, 5.5)))).toEqual([]);
    expect(analysePushPuzzles(sceneOf(room(), player('p', 2.5, 5.5), crateAt('c', 5.5, 5.5)))).toEqual([]);
    const scene = sceneOf(room(12, 10), player('p', 2.5, 5.5), crateAt('c', 5.5, 5.5), plateAt(8.5, 5.5));
    const r = solvePush(extractPushPuzzle(scene)!, { maxStates: 3 });
    expect(r.capped).toBe(true);
    expect(r.deadStates).toBe(0);
  });

  it('two crates can cover two plates, and a plate that only the player can press is not a target', () => {
    const fs = room(12, 10);
    const scene = sceneOf(fs, player('p', 2.5, 5.5), crateAt('a', 4.5, 4.5), crateAt('b', 4.5, 6.5), plateAt(7.5, 4.5), { ...plateAt(7.5, 6.5), id: 'plate2' }, { ...thing('only', 'Player plate', 9.5, 2.5, { pressurePlate: { activatedBy: 'player' } }) });
    const puzzle = extractPushPuzzle(scene)!;
    expect(puzzle.targets).toHaveLength(2);
    expect(solvePush(puzzle).solvable).toBe(true);
  });
});

describe('bridges made of text', () => {
  /** A pit band two cells wide across the whole room, with the goal behind it. */
  function pitBand(withBlock: boolean, format = 'plain', canFormat = true) {
    const fs = room(20, 10);
    for (let y = 0; y < 10; y++) for (const x of [9, 10]) fs.map.setFlag(x, y, FLAG.PIT);
    const block = thing('t', 'Bridge', 10, 4.5, { textBlock: { format, playerCanFormat: canFormat } });
    return sceneOf(fs, player('p', 2.5, 4.5), goalAt(16.5, 4.5), ...(withBlock ? [block] : []), gateAt('g', 14.5, 4.5));
  }

  it('a goal behind a wide pit is unreachable, unless a text block lies over the pit and could be formatted into a bridge', () => {
    expect(analyseLevel(pitBand(false)).some((i) => i.id === 'goal-unreachable-goal')).toBe(true);
    expect(analyseLevel(pitBand(true)).some((i) => i.id === 'goal-unreachable-goal')).toBe(false);
  });

  it('a block nobody can format, and that no wire underlines, is not a bridge', () => {
    expect(analyseLevel(pitBand(true, 'plain', false)).some((i) => i.id === 'goal-unreachable-goal')).toBe(true);
    expect(analyseLevel(pitBand(true, 'underline', false)).some((i) => i.id === 'goal-unreachable-goal')).toBe(false);
    const wired = pitBand(true, 'plain', false);
    wired.wires.push({ id: 'w', from: { entity: 's', output: 'word2' }, to: { entity: 't', input: 'underline' } });
    expect(analyseLevel(wired).some((i) => i.id === 'goal-unreachable-goal')).toBe(false);
  });
});

describe('gates in a row', () => {
  it('each gate of a sequence blocks something: none is called useless just because an earlier one is closed', () => {
    const fs = room(30, 10);
    wallWithDoor(fs.map, 10, [4]);
    wallWithDoor(fs.map, 20, [4]);
    const issues = analyseLevel(sceneOf(fs, player('p', 2.5, 4.5), gateAt('g1', 10.5, 4.5), gateAt('g2', 20.5, 4.5), goalAt(26.5, 4.5)));
    expect(issues.filter((i) => i.id.startsWith('gate-useless'))).toEqual([]);
    expect(issues.some((i) => i.id.startsWith('goal-'))).toBe(false);
  });

  it('still says so about a gate that can simply be walked around', () => {
    const fs = room(30, 10);
    wallWithDoor(fs.map, 10, [4, 5]); // the doorway is two cells wide, the gate fills one
    const issues = analyseLevel(sceneOf(fs, player('p', 2.5, 4.5), gateAt('g1', 10.5, 4.5), goalAt(20.5, 4.5)));
    expect(issues.some((i) => i.id === 'gate-useless-g1')).toBe(true);
  });
});

describe('a crate puzzle in a later room', () => {
  it('is checked as if the gates before it were open, not called unsolvable because the player starts behind a closed gate', () => {
    const fs = room(30, 10);
    wallWithDoor(fs.map, 8, [5]);
    for (let x = 12; x < 28; x++) {
      fs.map.setFlag(x, 4, FLAG.BLOCK);
      fs.map.setFlag(x, 6, FLAG.BLOCK);
    }
    fs.map.setFlag(26, 5, FLAG.BLOCK);
    const crate = thing('c', 'Crate', 15.5, 5.5, { pushable: {} }, { collider: { w: 0.9, d: 0.9, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } });
    const scene = sceneOf(fs, player('p', 2.5, 5.5), gateAt('door', 8.5, 5.5), crate, thing('plate', 'Plate', 25.5, 5.5, { pressurePlate: { activatedBy: 'crates' } }));
    expect(analysePushPuzzles(scene)).toEqual([]);
  });
});

describe('a doorway filled by two gates', () => {
  it('neither gate is called useless: opening one lets the player through', () => {
    const fs = room(20, 10);
    wallWithDoor(fs.map, 10, [4, 5]);
    const issues = analyseLevel(sceneOf(fs, player('p', 2.5, 4.5), gateAt('g1', 10.5, 4.5), gateAt('g2', 10.5, 5.5), goalAt(16.5, 4.5)));
    expect(issues.filter((i) => i.id.startsWith('gate-useless'))).toEqual([]);
  });
});
