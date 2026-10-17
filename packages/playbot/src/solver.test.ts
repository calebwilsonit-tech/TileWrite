import { describe, expect, it } from 'vitest';
import { FLAG, tileMapToRows, type SceneData } from '@tilewright/runtime';
import { attachBehavior } from '@tilewright/behaviors';
import { flatScene, player, thing } from '@tilewright/behaviors/src/testing';
import { Game } from './game';
import { Bot } from './bot';
import { PlaythroughSchema, newPlaythrough, replayPlaythrough } from './playthrough';
import { candidateMacros, solvePuzzles } from './solver';

type FS = ReturnType<typeof flatScene>;
function sceneOf(fs: FS, ...entities: SceneData['entities']): SceneData {
  fs.scene.map = tileMapToRows(fs.map);
  fs.scene.entities.push(...entities);
  return fs.scene;
}
const goalAt = (x: number, y: number) => ({ ...thing('goal', 'Exit', x, y, {}), tags: ['goal'] });
const gateSolid = { w: 1, d: 1, height: 1.6, solid: true, trigger: false, layer: 1, mask: 65535, enabled: true, inside: [] };

/** A room split by a wall with a one-cell doorway; a gate stands in the doorway. */
function walled(): FS {
  const fs = flatScene(24, 11);
  for (let y = 0; y < 11; y++) fs.map.setFlag(12, y, FLAG.BLOCK);
  fs.map.setFlag(12, 5, FLAG.BLOCK, false);
  return fs;
}

function echoHero(capacity: number) {
  const hero = player('p', 2.5, 5.5);
  attachBehavior(hero.components, 'echoRecorder');
  Object.assign(hero.components.echoRecorder as object, { capacity });
  return hero;
}

function andRoom(capacity: number): SceneData {
  const scene = sceneOf(
    walled(),
    echoHero(capacity),
    thing('p1', 'Plate A', 5.5, 2.5, { pressurePlate: { activatedBy: 'anyone' } }),
    thing('p2', 'Plate B', 5.5, 8.5, { pressurePlate: { activatedBy: 'anyone' } }),
    thing('and', 'AND', 9.5, 5.5, { logic: { kind: 'and' } }),
    thing('gate', 'Gate', 12.5, 5.5, { gate: {} }, { collider: gateSolid }),
    goalAt(20.5, 5.5),
  );
  scene.wires.push(
    { id: 'w1', from: { entity: 'p1', output: 'active' }, to: { entity: 'and', input: 'a' } },
    { id: 'w2', from: { entity: 'p2', output: 'active' }, to: { entity: 'and', input: 'b' } },
    { id: 'w3', from: { entity: 'and', output: 'out' }, to: { entity: 'gate', input: 'open' } },
  );
  return scene;
}

describe('the puzzle solver', () => {
  it('says when the goal can just be walked to', () => {
    const scene = sceneOf(flatScene(20, 10), player('p', 2.5, 5.5), goalAt(15.5, 5.5));
    const r = solvePuzzles({ scene });
    expect(r.found).toBe(true);
    expect(r.steps).toEqual([]);
    expect(r.plans).toBe(1);
    expect(r.message).toMatch(/can be reached by walking/);
  });

  it('flips the lever that opens the way', () => {
    const scene = sceneOf(walled(), player('p', 2.5, 5.5), thing('lever', 'Lever', 4.5, 2.5, { lever: {} }), thing('gate', 'Gate', 12.5, 5.5, { gate: {} }, { collider: gateSolid }), goalAt(20.5, 5.5));
    scene.wires.push({ id: 'w', from: { entity: 'lever', output: 'on' }, to: { entity: 'gate', input: 'open' } });
    const r = solvePuzzles({ scene });
    expect(r.found).toBe(true);
    expect(r.steps).toEqual(['flip "Lever"']);
    expect(r.message).toMatch(/^Solved in 1 step: flip "Lever"; then walk to the goal/);
  });

  it('works out that a plate must be held by an echo, since the player cannot stand on it and walk away', () => {
    const make = (hero: SceneData['entities'][number]): SceneData => {
      const scene = sceneOf(walled(), hero, thing('plate', 'Plate', 5.5, 2.5, { pressurePlate: { activatedBy: 'anyone' } }), thing('gate', 'Gate', 12.5, 5.5, { gate: {} }, { collider: gateSolid }), goalAt(20.5, 5.5));
      scene.wires.push({ id: 'w', from: { entity: 'plate', output: 'active' }, to: { entity: 'gate', input: 'open' } });
      return scene;
    };
    const r = solvePuzzles({ scene: make(echoHero(1)) });
    expect(r.found).toBe(true);
    expect(r.steps).toEqual(['record an echo onto "Plate"']);
    // and without a recorder it reports honestly that there is no way
    const none = solvePuzzles({ scene: make(player('p', 2.5, 5.5)) });
    expect(none.found).toBe(false);
    expect(none.gaveUp).toBe(false);
    expect(none.message).toMatch(/No way to reach the goal was found/);
  });

  it('finds a plan with two echoes when two plates must be held at once (AND)', () => {
    const scene = andRoom(2);
    const r = solvePuzzles({ scene });
    expect(r.found).toBe(true);
    expect(r.steps).toHaveLength(2);
    expect(r.steps.every((s) => s.startsWith('record an echo onto'))).toBe(true);
    expect(r.plans).toBeGreaterThan(1);
    // the winning run is a recording of buttons that replays to the goal
    const pt = newPlaythrough('Two echoes', '', r.recording!, 1, { near: 'tag:goal', within: 1 });
    expect(PlaythroughSchema.safeParse(JSON.parse(JSON.stringify(pt))).success).toBe(true);
    expect(replayPlaythrough(new Game({ scene }), pt).ok).toBe(true);
  });

  it('with one echo for two plates the puzzle cannot be solved, and the solver says so', () => {
    const r = solvePuzzles({ scene: andRoom(1) });
    expect(r.found).toBe(false);
    expect(r.message).toMatch(/No way to reach the goal was found/);
  });

  it('pushes the crate onto its plate and then walks through', () => {
    const crate = thing('c', 'Crate', 6.5, 5.5, { pushable: {} }, { collider: { ...gateSolid, height: 1 } });
    const scene = sceneOf(walled(), player('p', 4.5, 5.5), crate, thing('plate', 'Plate', 9.5, 5.5, { pressurePlate: { activatedBy: 'crates' } }), thing('gate', 'Gate', 12.5, 5.5, { gate: {} }, { collider: gateSolid }), goalAt(20.5, 5.5));
    scene.wires.push({ id: 'w', from: { entity: 'plate', output: 'active' }, to: { entity: 'gate', input: 'open' } });
    const r = solvePuzzles({ scene });
    expect(r.found).toBe(true);
    expect(r.steps).toEqual(['push the crates onto their plates']);
  });

  it('gives up honestly when the search limit is reached, and says what is missing when there is no goal', () => {
    const scene = sceneOf(walled(), echoHero(2), thing('p1', 'A', 5.5, 2.5, { pressurePlate: {} }), thing('p2', 'B', 5.5, 8.5, { pressurePlate: {} }), thing('gate', 'Gate', 12.5, 5.5, { gate: {} }, { collider: gateSolid }), goalAt(20.5, 5.5));
    const r = solvePuzzles({ scene }, { maxPlans: 3 });
    expect(r.found).toBe(false);
    expect(r.gaveUp).toBe(true);
    expect(r.message).toMatch(/stopped at its limit/);
    const bare = solvePuzzles({ scene: sceneOf(flatScene(10, 10), player('p', 2.5, 2.5)) });
    expect(bare.found).toBe(false);
    expect(bare.message).toMatch(/nothing tagged goal, exit or reward/);
    expect(solvePuzzles({ scene: sceneOf(flatScene(10, 10), player('p', 2.5, 2.5), goalAt(5.5, 5.5)) }, { goal: 'name:Nowhere' }).message).toMatch(/nothing matching "name:Nowhere"/);
  });

  it('lists what the player could do in a room, nearest first', () => {
    const scene = sceneOf(flatScene(20, 10), echoHero(1), thing('far', 'Far', 15.5, 5.5, { pressurePlate: {} }), thing('near', 'Near', 4.5, 5.5, { pressurePlate: {} }), thing('lv', 'Lever', 9.5, 5.5, { lever: {} }));
    const labels = candidateMacros({ scene }).map((m) => m.label);
    expect(labels[0]).toBe('record an echo onto "Near"');
    expect(labels).toContain('flip "Lever"');
    expect(labels).toContain('stand on "Far"');
    expect(new Bot(new Game({ scene })).recording().length).toBe(0);
  });
});
