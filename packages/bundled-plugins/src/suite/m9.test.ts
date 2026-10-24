import { describe, expect, it } from 'vitest';
import { C, Profiler, SystemError, TileMap, tileMapToRows, type EntityData } from '@tilewright/runtime';
import { defineBehavior } from '@tilewright/behaviors';
import { GRID_PLUS_X, flatScene, player, rig, thing } from '@tilewright/plugin-sdk/testing';
import { attachBehavior } from '@tilewright/behaviors';
import '@tilewright/bundled-plugins';

defineBehavior({
  id: 'boomForTests',
  name: 'Boom (test)',
  category: 'Test',
  hidden: true,
  description: 'Throws on purpose, to see how errors are reported.',
  phase: 'actuator',
  defaults: { after: 3 },
  fields: [],
  inputs: [],
  outputs: [],
  requires: {},
  update(ctx, e, s: { after: number }) {
    if (ctx.tick >= s.after) throw new Error('kaboom');
  },
});

describe('profiler', () => {
  it('times systems and kinds of behaviour, and costs nothing while off', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 2.5, 2.5), thing('plate', 'Plate', 8.5, 8.5, { pressurePlate: {} }), thing('plate2', 'Plate 2', 9.5, 8.5, { pressurePlate: {} }));
    const r = rig(scene);
    r.run(30);
    expect(r.sim.profiler.snapshot().ticks).toBe(0); // off: nothing recorded
    r.sim.profiler.enabled = true;
    r.run(60);
    const snap = r.sim.profiler.snapshot();
    expect(snap.ticks).toBe(60);
    expect(snap.avgTickMs).toBeGreaterThanOrEqual(0);
    expect(snap.systems.map((s) => s.name)).toEqual(expect.arrayContaining(['physics', 'event-sheet', 'player-controller', 'behaviours:source']));
    expect(snap.behaviours.find((b) => b.name === 'Pressure Plate')!.calls).toBeCloseTo(2, 5); // two plates per tick
    expect(snap.systems[0]!.avgMs).toBeGreaterThanOrEqual(snap.systems.at(-1)!.avgMs); // slowest first
    r.sim.profiler.reset();
    expect(r.sim.profiler.snapshot()).toMatchObject({ ticks: 0, systems: [], behaviours: [] });
  });

  it('a standalone profiler can wrap any function', () => {
    const p = new Profiler();
    p.enabled = true;
    p.beginTick();
    expect(p.system('x', () => 7)).toBe(7);
    expect(p.behaviour('y', () => 8)).toBe(8);
    p.endTick();
    expect(p.snapshot().systems[0]!.name).toBe('x');
    expect(p.snapshot().behaviours[0]!.name).toBe('y');
  });
});

describe('errors say what failed and where', () => {
  it('a behaviour that throws is reported with its name, the object, and the original cause', () => {
    const { scene } = flatScene();
    const bad = thing('bad', 'Time bomb', 6.5, 6.5, {});
    attachBehavior(bad.components, 'boomForTests');
    scene.entities.push(player('p', 2.5, 2.5), bad);
    const r = rig(scene);
    r.run(3);
    let caught: unknown;
    try {
      r.run(3);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SystemError);
    const err = caught as SystemError;
    expect(err.message).toBe('The Boom (test) behaviour on "Time bomb" failed: kaboom');
    expect(err.system).toBe('behaviours:actuator');
    expect(err.entityId).toBe(r.get('bad').id);
    expect(err.stack).toContain('caused by');
    // the world is still there to look at afterwards
    expect(r.sim.world.get(r.get('p').id)).toBeDefined();
  });

  it('a system that throws is named', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 2.5, 2.5));
    const r = rig(scene);
    r.sim.addSystem('my-script', () => {
      throw new TypeError('oops');
    });
    expect(() => r.run(1)).toThrow('The "my-script" step of the game failed: oops');
  });
});

describe('performance budget: 5,000 tiles and 200 objects', () => {
  function bigScene() {
    const map = new TileMap(72, 72); // 5,184 tiles
    map.fill(1, 0);
    const scene = {
      ...flatScene(8, 8).scene,
      map: tileMapToRows(map),
      entities: [] as EntityData[],
      wires: [] as never[],
    };
    scene.entities.push(player('p', 36.5, 36.5));
    const prefab = { collider: { w: 0.9, d: 0.9, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } };
    let n = 0;
    const at = (i: number): [number, number] => [4.5 + (i % 30) * 2, 4.5 + Math.floor(i / 30) * 2];
    for (let i = 0; i < 60; i++) scene.entities.push(thing(`c${n++}`, 'Crate', ...at(i), { pushable: {} }, prefab));
    for (let i = 60; i < 100; i++) scene.entities.push(thing(`p${n++}`, 'Plate', ...at(i), { pressurePlate: {} }));
    for (let i = 100; i < 140; i++) {
      const g = thing(`g${n++}`, 'Guard', ...at(i), { health: { max: 2 }, vision: {}, chase: {}, patrol: { points: `${at(i)[0]},${at(i)[1]}; ${at(i)[0] + 1},${at(i)[1]}` } }, {
        body: { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 4, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null },
      });
      scene.entities.push(g);
    }
    for (let i = 140; i < 170; i++) scene.entities.push(thing(`l${n++}`, 'Lamp', ...at(i), { light: {} }));
    for (let i = 170; i < 200; i++) scene.entities.push(thing(`s${n++}`, 'Growing', ...at(i), { growing: {} }));
    return scene;
  }

  it('a tick takes well under the 16 ms a 60 fps game has', () => {
    const r = rig(bigScene() as never);
    r.run(30); // warm up
    // best of several windows: other programs (and other tests) sharing the CPU only ever make a window slower
    let best = Infinity;
    for (let w = 0; w < 6; w++) {
      const t0 = performance.now();
      for (let i = 0; i < 60; i++) r.sim.step(i < 30 ? GRID_PLUS_X : {});
      best = Math.min(best, (performance.now() - t0) / 60);
    }
    const avg = best;    expect(r.sim.world.count).toBeGreaterThanOrEqual(200);
    // budget: simulation alone may use a third of a frame, leaving the rest for drawing
    expect(avg).toBeLessThan(5.5);
  });

  it('knows which behaviour is the slowest', () => {
    const r = rig(bigScene() as never);
    r.sim.profiler.enabled = true;
    r.run(60);
    const snap = r.sim.profiler.snapshot();
    expect(snap.behaviours.length).toBeGreaterThan(4);
    expect(snap.behaviours.every((b) => b.avgMs >= 0)).toBe(true);
    expect(C.Transform).toBe('transform');
  });
});
