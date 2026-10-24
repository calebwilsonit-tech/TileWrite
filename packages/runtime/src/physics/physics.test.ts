import { beforeEach, describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { C, makeTransform, type TransformIso } from '../scene/components';
import { EDGE, FLAG, SLOPE, TileMap } from '../tilemap/tilemap';
import { LAYER, jumpBody, makeBody, makeCollider, physicsSystem, teleportBody, type Body } from './physics';
import { PIT_KILL_Z, groundHeightAt, reachableCells, surfaceAt } from './terrain';

const Q = { stepUp: 0.35, bodyHeight: 1 };

/** Every scenario here runs twice: with the older physics (the feet against a map of heights) and with block physics (the whole body against every block). Both must give the same answers. */
let BLOCK = false;

function flat(w = 12, h = 12, height = 0): TileMap {
  const m = new TileMap(w, h);
  m.fill(1, height);
  return m;
}

function world(map: TileMap, x: number, y: number, z = 0, bodyOpts: Partial<Body> = {}) {
  const sim = new Simulation(1);
  sim.map = map;
  sim.compat = { ...sim.compat, blockPhysics: BLOCK };
  sim.addSystem('physics', physicsSystem);
  const e = sim.world.spawn({
    name: 'hero',
    components: { [C.Transform]: makeTransform(x, y, z), [C.Body]: makeBody(bodyOpts) },
  });
  const t = e.require<TransformIso>(C.Transform);
  const b = e.require<Body>(C.Body);
  return { sim, e, t, b };
}

function run(sim: Simulation, ticks: number, each?: () => void): void {
  for (let i = 0; i < ticks; i++) {
    each?.();
    sim.step();
  }
}

describe.each([false, true])('physics, block physics: %s', (block) => {
  beforeEach(() => {
    BLOCK = block;
  });

  describe('terrain queries', () => {
    it('reads slope height continuously for each direction', () => {
      const m = flat(4, 4);
      m.setSlope(1, 1, SLOPE.E);
      expect(groundHeightAt(m, 1.0, 1.5)).toBeCloseTo(0);
      expect(groundHeightAt(m, 1.5, 1.5)).toBeCloseTo(0.5);
      expect(groundHeightAt(m, 1.999, 1.5)).toBeCloseTo(1, 2);
      m.setSlope(2, 2, SLOPE.N);
      expect(groundHeightAt(m, 2.5, 2.9)).toBeCloseTo(0.1);
      expect(groundHeightAt(m, 2.5, 2.1)).toBeCloseTo(0.9);
      m.setSlope(0, 0, SLOPE.W);
      expect(groundHeightAt(m, 0.25, 0.5)).toBeCloseTo(0.75);
      m.setSlope(3, 3, SLOPE.S);
      expect(groundHeightAt(m, 3.5, 3.25)).toBeCloseTo(0.25);
    });

    it('adds the slope to the base height', () => {
      const m = flat(3, 3, 2);
      m.setSlope(1, 1, SLOPE.S);
      expect(groundHeightAt(m, 1.5, 1.5)).toBeCloseTo(2.5);
    });

    it('reports void, solid, pit, water, ground and deck', () => {
      const m = flat(6, 6);
      m.set(1, 0, 0);
      m.setFlag(2, 0, FLAG.BLOCK);
      m.setFlag(3, 0, FLAG.PIT);
      m.setFlag(4, 0, FLAG.WATER);
      m.setDeck(5, 0, 2);
      expect(surfaceAt(m, -1, 0, 0, Q).kind).toBe('void');
      expect(surfaceAt(m, 1.5, 0.5, 0, Q).kind).toBe('void');
      expect(surfaceAt(m, 2.5, 0.5, 0, Q).kind).toBe('solid');
      expect(surfaceAt(m, 3.5, 0.5, 0, Q)).toEqual({ kind: 'pit', z: -Infinity });
      expect(surfaceAt(m, 4.5, 0.5, 0, Q).kind).toBe('water');
      expect(surfaceAt(m, 0.5, 0.5, 0, Q)).toEqual({ kind: 'ground', z: 0 });
    });

    it('picks deck or ground by the height of the feet', () => {
      const m = flat(3, 3);
      m.setDeck(1, 1, 2);
      expect(surfaceAt(m, 1.5, 1.5, 2, Q)).toEqual({ kind: 'deck', z: 2 });
      expect(surfaceAt(m, 1.5, 1.5, 0, Q)).toEqual({ kind: 'ground', z: 0 }); // 0 + 1 <= 2 - 1: fits under
      expect(surfaceAt(m, 1.5, 1.5, 0, { stepUp: 0.35, bodyHeight: 1.5 }).kind).toBe('solid'); // too tall to pass under
    });

    it('keeps tall-column sides from reading as walkable', () => {
      const m = flat(4, 4);
      m.set(2, 1, 5, 3);
      expect(surfaceAt(m, 2.5, 1.5, 0, Q).z).toBe(3);
    });
  });

  describe('walking, stairs and cliffs', () => {
    it('walks freely on flat ground', () => {
      const { sim, t, b } = world(flat(), 2.5, 2.5);
      b.vx = 3;
      run(sim, 60);
      expect(t.x).toBeCloseTo(5.5, 1);
      expect(t.h).toBe(0);
      expect(b.state).toBe('ground');
    });

    it('is stopped by the map edge', () => {
      const { sim, t, b } = world(flat(6, 6), 4.5, 3.5);
      b.vx = 5;
      run(sim, 120);
      expect(t.x).toBeLessThanOrEqual(6 - b.radius + 1e-6);
      expect(b.blockedTerrain).toBe(true);
    });

    it('climbs stairs smoothly from level 0 to level 1', () => {
      const m = flat(10, 6);
      for (let x = 5; x < 10; x++) for (let y = 0; y < 6; y++) m.set(x, y, 2, 1);
      m.set(4, 2, 2, 0);
      m.setSlope(4, 2, SLOPE.E);
      const { sim, t, b } = world(m, 2.5, 2.5);
      b.vx = 2.5;
      let maxJump = 0;
      let last = t.h;
      run(sim, 120, () => {
        maxJump = Math.max(maxJump, Math.abs(t.h - last));
        last = t.h;
      });
      expect(t.x).toBeGreaterThan(6);
      expect(t.h).toBeCloseTo(1, 5);
      expect(b.state).toBe('ground');
      expect(maxJump).toBeLessThan(0.1); // no pops
    });

    it('climbs a ramp at any walking or running speed (regression: lagging feet height blocked fast bodies)', () => {
      for (const speed of [1, 2.5, 4, 6.4, 9]) {
        const m = flat(12, 5);
        for (let x = 6; x < 12; x++) for (let y = 0; y < 5; y++) m.set(x, y, 2, 1);
        m.set(5, 2, 2, 0);
        m.setSlope(5, 2, SLOPE.E, 'ramp');
        const { sim, t, b } = world(m, 2.5, 2.5);
        b.vx = speed;
        run(sim, 500);
        expect(t.x, `speed ${speed}`).toBeGreaterThan(7);
        expect(t.h, `speed ${speed}`).toBeCloseTo(1, 5);
      }
    });

    it('walks back down the stairs without falling', () => {
      const m = flat(10, 6);
      for (let x = 5; x < 10; x++) for (let y = 0; y < 6; y++) m.set(x, y, 2, 1);
      m.set(4, 2, 2, 0);
      m.setSlope(4, 2, SLOPE.E);
      const { sim, t, b } = world(m, 7.5, 2.5, 1);
      b.vx = -2.5;
      let fell = false;
      sim.events.on('landed', () => (fell = true));
      run(sim, 120);
      expect(t.x).toBeLessThan(4);
      expect(t.h).toBeCloseTo(0, 5);
      expect(fell).toBe(false);
    });

    it('cannot climb a cliff face', () => {
      const m = flat(10, 6);
      for (let x = 5; x < 10; x++) for (let y = 0; y < 6; y++) m.set(x, y, 2, 1);
      const { sim, t, b } = world(m, 2.5, 2.5);
      b.vx = 3;
      run(sim, 120);
      expect(t.x).toBeLessThan(5);
      expect(t.h).toBe(0);
      expect(b.blockedTerrain).toBe(true);
    });

    it('cannot enter stairs from the side or from the high end wall', () => {
      const m = flat(8, 5);
      m.setSlope(3, 2, SLOPE.E);
      for (let y = 0; y < 5; y++) for (let x = 4; x < 8; x++) m.set(x, y, 2, 1);
      // approach from the north side of the stair cell
      const { sim, t, b } = world(m, 3.5, 0.5);
      b.vy = 3;
      run(sim, 90);
      expect(t.y).toBeLessThan(3); // reaches y~2 only if it could slide into the slope; it must stop at the side
      expect(t.h).toBeLessThan(0.2);
    });

    it('ignores walls lower than its own height', () => {
      const m = flat(10, 4);
      for (let y = 0; y < 4; y++) m.set(5, y, 5, 0); // wall column of height 0 (floor)
      // High body at z = 2 walks over a floor tile at height 0 and falls, never blocked
      const { sim, t, b } = world(m, 2.5, 1.5, 2);
      b.state = 'air';
      b.vx = 2;
      run(sim, 90);
      expect(t.x).toBeGreaterThan(5);
    });

    it('is blocked by a wall taller than the step', () => {
      const m = flat(10, 4);
      for (let y = 0; y < 4; y++) m.set(5, y, 5, 3);
      const { sim, t, b } = world(m, 2.5, 1.5);
      b.vx = 3;
      run(sim, 90);
      expect(t.x).toBeLessThan(5);
    });

    it('a body on top of a wall walks along it, and falls off its edge', () => {
      const m = flat(10, 4);
      for (let x = 3; x < 6; x++) m.set(x, 1, 5, 3);
      const { sim, t, b } = world(m, 3.5, 1.5, 3);
      b.vx = 2;
      const fall: number[] = [];
      sim.events.on('landed', (e) => fall.push(e.distance as number));
      run(sim, 150);
      expect(t.x).toBeGreaterThan(6);
      expect(t.h).toBe(0);
      expect(fall).toHaveLength(1);
      expect(fall[0]).toBeCloseTo(3, 1);
    });

    it('slides along a wall instead of sticking', () => {
      const m = flat(10, 10);
      for (let y = 0; y < 10; y++) m.set(6, y, 5, 3);
      const { sim, t, b } = world(m, 4.5, 4.5);
      b.vx = 3;
      b.vy = 3;
      run(sim, 60);
      expect(t.x).toBeLessThan(6);
      expect(t.y).toBeGreaterThan(7); // kept sliding along the wall
    });

    it('does not tunnel through a wall at high speed', () => {
      const m = flat(30, 4);
      for (let y = 0; y < 4; y++) m.set(10, y, 5, 3);
      const { sim, t, b } = world(m, 2.5, 1.5);
      b.vx = 400;
      run(sim, 10);
      expect(t.x).toBeLessThan(10);
    });
  });

  describe('ledges', () => {
    function platform(): TileMap {
      const m = flat(10, 4);
      for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) m.set(x, y, 2, 2);
      return m;
    }

    it('walking off a ledge drops you and reports the fall distance', () => {
      const { sim, t, b } = world(platform(), 2.5, 1.5, 2);
      b.vx = 2;
      const landed: { distance: number }[] = [];
      sim.events.on('landed', (e) => landed.push({ distance: e.distance as number }));
      run(sim, 120);
      expect(t.h).toBe(0);
      expect(landed).toHaveLength(1);
      expect(landed[0]!.distance).toBeCloseTo(2, 1);
    });

    it("'block' mode treats a big drop as a wall", () => {
      const { sim, t, b } = world(platform(), 2.5, 1.5, 2, { ledge: 'block' });
      b.vx = 2;
      run(sim, 120);
      expect(t.x).toBeLessThan(4);
      expect(t.h).toBe(2);
    });

    it('one-way edges can be left but not entered', () => {
      const m = flat(8, 3);
      m.setOneWay(4, 1, EDGE.W); // cannot enter cell 4 from the west
      const east = world(m, 2.5, 1.5);
      east.b.vx = 3;
      run(east.sim, 90);
      expect(east.t.x).toBeLessThan(4);

      const back = world(m, 4.5, 1.5);
      back.b.vx = -3;
      run(back.sim, 90);
      expect(back.t.x).toBeLessThan(3.5); // left through the blocked side freely
    });
  });

  describe('pits, falling and respawn', () => {
    it('falls into a pit, emits fell once, then freezes', () => {
      const m = flat(10, 4);
      m.setFlag(5, 1, FLAG.PIT);
      const { sim, t, b } = world(m, 3.5, 1.5);
      b.vx = 2;
      const fell: unknown[] = [];
      sim.events.on('fell', (e) => fell.push(e));
      run(sim, 180);
      expect(fell).toHaveLength(1);
      expect(b.state).toBe('pit');
      expect(t.h).toBe(PIT_KILL_Z);
      const x = t.x;
      run(sim, 30);
      expect(t.x).toBe(x); // frozen
    });

    it('can be respawned with teleportBody', () => {
      const m = flat(10, 4);
      m.setFlag(5, 1, FLAG.PIT);
      const { sim, e, t, b } = world(m, 3.5, 1.5);
      b.vx = 2;
      sim.addSystem('respawn', (ctx) => {
        for (const ev of ctx.events.of('fell')) {
          const who = ctx.world.get(ev.entity as number);
          if (who) teleportBody(ctx, who, 2.5, 1.5);
        }
      });
      run(sim, 200);
      // teleportBody zeroes velocity, so after the fall it stands where it respawned
      expect(e.alive).toBe(true);
      expect(sim.events.of('fell')).toHaveLength(0); // log only holds the latest tick
      expect(t.x).toBeCloseTo(2.5, 5);
      expect(t.y).toBeCloseTo(1.5, 5);
      expect(t.h).toBe(0);
      expect(b.state).toBe('ground');
    });

    it("'block' pits are walls for AI that avoids them", () => {
      const m = flat(10, 4);
      m.setFlag(5, 1, FLAG.PIT);
      const { sim, t, b } = world(m, 3.5, 1.5, 0, { pits: 'block' });
      b.vx = 2;
      run(sim, 120);
      expect(t.x).toBeLessThan(5);
      expect(b.state).toBe('ground');
    });

    it('jumping lifts the body and lands it again', () => {
      const { sim, t, b } = world(flat(), 3.5, 3.5);
      jumpBody(b, 8);
      let apex = 0;
      run(sim, 40, () => (apex = Math.max(apex, t.h)));
      expect(apex).toBeGreaterThan(0.5);
      expect(b.state).toBe('ground');
      expect(t.h).toBe(0);
    });

    it('a jump can land on a ledge one level up', () => {
      const m = flat(10, 4);
      for (let x = 5; x < 10; x++) for (let y = 0; y < 4; y++) m.set(x, y, 2, 1);
      const { sim, t, b } = world(m, 4.0, 1.5);
      b.vx = 3;
      jumpBody(b, 11);
      run(sim, 60);
      expect(t.x).toBeGreaterThan(5);
      expect(t.h).toBe(1);
    });

    it('never leaves a landed body stuck inside a wall', () => {
      // spawned straddling a tall wall's edge: part of the footprint is inside the wall
      const m = flat(10, 4);
      for (let y = 0; y < 4; y++) m.set(5, y, 5, 3);
      const { sim, t, b } = world(m, 6.0, 1.5, 0.0);
      b.vx = 1; // away from the wall: allowed
      run(sim, 60);
      expect(t.x).toBeGreaterThan(6.4);
      // and it still cannot be pushed INTO the wall afterwards
      b.vx = -3;
      run(sim, 60);
      expect(t.x).toBeGreaterThanOrEqual(6 - 1e-6 + 0.3 - 1e-6);
    });
  });

  describe('bridges (decks)', () => {
    function bridgeMap(): TileMap {
      const m = flat(12, 5);
      for (let x = 4; x <= 7; x++) for (let y = 0; y < 5; y++) m.setFlag(x, y, FLAG.WATER);
      for (let x = 4; x <= 7; x++) m.setDeck(x, 2, 0 + 1, 6);
      return m;
    }

    it('water blocks walking', () => {
      const { sim, t, b } = world(bridgeMap(), 2.5, 0.5);
      b.vx = 3;
      run(sim, 120);
      expect(t.x).toBeLessThan(4);
    });

    it('walks across a bridge over the water at deck height', () => {
      const m = bridgeMap();
      // deck level 1, approach from ground level 0 is a 1-level step: add ramps at both ends
      m.setDeck(4, 2, 0 + 1, 6);
      m.setSlope(3, 2, SLOPE.E);
      for (let x = 8; x < 12; x++) for (let y = 0; y < 5; y++) m.set(x, y, 1, 1);
      m.set(8, 2, 1, 1);
      m.setSlope(3, 2, SLOPE.E);
      const { sim, t, b } = world(m, 1.5, 2.5);
      b.vx = 2.5;
      run(sim, 240);
      expect(t.x).toBeGreaterThan(8);
      expect(t.h).toBeCloseTo(1, 5);
    });

    it('lets a body pass under the bridge but not bump into it', () => {
      const m = flat(6, 3);
      m.setDeck(3, 1, 3, 6);
      const under = world(m, 1.5, 1.5, 0, { height: 1 });
      under.b.vx = 3;
      run(under.sim, 90);
      expect(under.t.x).toBeGreaterThan(4);
      expect(under.t.h).toBe(0);
      const tall = world(m, 1.5, 1.5, 0, { height: 2.5 });
      tall.b.vx = 3;
      run(tall.sim, 90);
      expect(tall.t.x).toBeLessThan(3);
    });

    it('drops onto the deck when falling from above, and off its edge back to the floor', () => {
      const m = flat(7, 3);
      m.setDeck(3, 1, 2, 6);
      const { sim, t, b } = world(m, 3.5, 1.5, 4);
      b.state = 'air';
      run(sim, 60);
      expect(t.h).toBe(2);
      b.vx = 2;
      run(sim, 90);
      expect(t.x).toBeGreaterThan(4);
      expect(t.h).toBe(0);
    });
  });

  describe('solid colliders and layers', () => {
    function withCrate(layerMask = 0xffff) {
      const w = world(flat(), 2.5, 5.5);
      const crate = w.sim.world.spawn({
        name: 'crate',
        components: {
          [C.Transform]: makeTransform(5.5, 5.5, 0),
          [C.Collider]: makeCollider({ w: 1, d: 1, height: 1, layer: LAYER.PROP, mask: layerMask }),
        },
      });
      return { ...w, crate };
    }

    it('blocks a body and reports who blocked it', () => {
      const { sim, t, b, crate } = withCrate();
      b.vx = 3;
      run(sim, 90);
      expect(t.x).toBeLessThan(5.5 - 0.5 - 0.3 + 1e-6);
      expect(b.blockedBy).toEqual([crate.id]);
    });

    it('respects layer masks (ghosts walk through)', () => {
      const { sim, t, b } = withCrate();
      b.layer = LAYER.GHOST;
      // crate only collides with the default and player layers
      sim.world.findByName('crate')!.require<ReturnType<typeof makeCollider>>(C.Collider).mask = LAYER.DEFAULT | LAYER.PLAYER;
      b.vx = 3;
      run(sim, 90);
      expect(t.x).toBeGreaterThan(6);
    });

    it('is ignored by a body that is above it', () => {
      const w = world(flat(), 2.5, 5.5, 3);
      w.b.state = 'air';
      w.b.gravity = 0;
      w.sim.world.spawn({
        components: { [C.Transform]: makeTransform(5.5, 5.5, 0), [C.Collider]: makeCollider({ height: 1 }) },
      });
      w.b.vx = 3;
      run(w.sim, 90);
      expect(w.t.x).toBeGreaterThan(6);
    });
  });

  describe('solid objects as platforms', () => {
    function crateWorld(height = 1) {
      const w = world(flat(), 2.5, 5.5);
      const crate = w.sim.world.spawn({
        name: 'crate',
        components: { [C.Transform]: makeTransform(5.5, 5.5, 0), [C.Collider]: makeCollider({ w: 1, d: 1, height, layer: LAYER.PROP }) },
      });
      return { ...w, crate };
    }

    it('lets a body jump onto a crate and stand on it', () => {
      const { sim, t, b, crate } = crateWorld(1);
      b.vx = 3;
      run(sim, 40); // walk up to it, blocked by the side
      expect(t.x).toBeLessThan(5);
      jumpBody(b, 11);
      run(sim, 20); // drift forward in the air...
      b.vx = 0; // ...then stop and drop onto the top
      run(sim, 40);
      expect(t.h).toBeCloseTo(1, 5);
      expect(b.standingOn).toBe(crate.id);
      expect(b.state).toBe('ground');
      expect(t.x).toBeGreaterThan(5); // it made it onto the top
    });

    it('keeps a body standing on the crate when it stops, and drops it when it walks off', () => {
      const { sim, t, b, crate } = crateWorld(1);
      teleportBody({ map: sim.map } as never, sim.world.findByName('hero')!, 5.5, 5.5, 1);
      b.state = 'air';
      run(sim, 30);
      expect(t.h).toBeCloseTo(1, 5);
      expect(b.standingOn).toBe(crate.id);
      b.vx = 2;
      run(sim, 90);
      expect(t.x).toBeGreaterThan(6.2);
      expect(t.h).toBe(0);
      expect(b.standingOn).toBeNull();
    });

    it('cannot step onto a crate that is taller than the step, but can onto a low one', () => {
      const tall = crateWorld(1);
      tall.b.vx = 3;
      run(tall.sim, 90);
      expect(tall.t.x).toBeLessThan(5);
      const low = crateWorld(0.3);
      low.b.vx = 3;
      run(low.sim, 90);
      expect(low.t.x).toBeGreaterThan(6);
    });

    it('a platform that is switched off or removed is not stood on any more', () => {
      const { sim, t, b, crate } = crateWorld(1);
      teleportBody({ map: sim.map } as never, sim.world.findByName('hero')!, 5.5, 5.5, 1);
      b.state = 'air';
      run(sim, 20);
      expect(b.standingOn).toBe(crate.id);
      crate.require<ReturnType<typeof makeCollider>>(C.Collider).enabled = false;
      run(sim, 30);
      expect(t.h).toBe(0);
      expect(b.standingOn).toBeNull();
    });

    it('respects collider.platform = false', () => {
      const { sim, t, b, crate } = crateWorld(1);
      crate.require<ReturnType<typeof makeCollider>>(C.Collider).platform = false;
      teleportBody({ map: sim.map } as never, sim.world.findByName('hero')!, 5.5, 5.5, 1);
      b.state = 'air';
      run(sim, 30);
      expect(t.h).toBeLessThan(1); // fell through it
    });
  });

  describe('triggers', () => {
    function plateWorld() {
      const w = world(flat(), 2.5, 5.5);
      const plate = w.sim.world.spawn({
        name: 'plate',
        components: {
          [C.Transform]: makeTransform(5.5, 5.5, 0),
          [C.Collider]: makeCollider({ w: 1, d: 1, height: 0.5, solid: false, trigger: true }),
        },
      });
      const log: string[] = [];
      for (const type of ['trigger-enter', 'trigger-stay', 'trigger-exit']) {
        w.sim.events.on(type, (e) => log.push(`${type}:${e.trigger}:${e.other}`));
      }
      return { ...w, plate, log };
    }

    it('fires enter, stay and exit as a body walks across', () => {
      const { sim, b, log, plate, e } = plateWorld();
      b.vx = 2;
      run(sim, 180);
      expect(log[0]).toBe(`trigger-enter:${plate.id}:${e.id}`);
      expect(log.filter((l) => l.startsWith('trigger-stay')).length).toBeGreaterThan(5);
      expect(log.at(-1)).toBe(`trigger-exit:${plate.id}:${e.id}`);
      expect(log.filter((l) => l.startsWith('trigger-enter'))).toHaveLength(1);
      expect(log.filter((l) => l.startsWith('trigger-exit'))).toHaveLength(1);
    });

    it('does not fire for a body at a different height', () => {
      const { sim, b, log } = plateWorld();
      b.state = 'air';
      b.gravity = 0;
      sim.world.findByName('hero')!.require<TransformIso>(C.Transform).h = 3;
      b.vx = 2;
      run(sim, 120);
      expect(log).toEqual([]);
    });

    it('exits cleanly when the occupant is destroyed', () => {
      const { sim, e, log } = plateWorld();
      teleportBody({ map: sim.map } as never, e, 5.5, 5.5);
      run(sim, 3);
      expect(log.some((l) => l.startsWith('trigger-enter'))).toBe(true);
      sim.world.destroy(e);
      run(sim, 2);
      expect(log.at(-1)?.startsWith('trigger-exit')).toBe(true);
    });

    it('is triggered by a solid crate (so crates can hold plates down)', () => {
      const { sim, log } = plateWorld();
      sim.world.spawn({
        name: 'crate',
        components: { [C.Transform]: makeTransform(5.5, 5.5, 0), [C.Collider]: makeCollider({ height: 1 }) },
      });
      run(sim, 3);
      expect(log.some((l) => l.startsWith('trigger-enter'))).toBe(true);
    });
  });

  describe('determinism and walk test', () => {
    it('replays physics exactly', () => {
      const build = () => {
        const m = flat(12, 12);
        for (let x = 6; x < 10; x++) for (let y = 3; y < 9; y++) m.set(x, y, 2, 2);
        m.setFlag(3, 3, FLAG.PIT);
        const w = world(m, 2.5, 4.5);
        return w;
      };
      const a = build();
      const b2 = build();
      for (let i = 0; i < 400; i++) {
        const vx = Math.sin(i / 20) * 4;
        const vy = Math.cos(i / 17) * 4;
        a.b.vx = vx;
        a.b.vy = vy;
        b2.b.vx = vx;
        b2.b.vy = vy;
        a.sim.step();
        b2.sim.step();
      }
      expect(a.sim.stateHash()).toBe(b2.sim.stateHash());
    });

    it('computes reachable cells for the walk test', () => {
      const m = flat(8, 5);
      for (let y = 0; y < 5; y++) m.set(4, y, 5, 3); // wall splits the room
      const left = reachableCells(m, { x: 1, y: 2 });
      expect(left.has('3,2')).toBe(true);
      expect(left.has('5,2')).toBe(false);
      // add stairs onto the wall top: still unreachable beyond a 3-high wall
      m.set(4, 2, 2, 0);
      m.setSlope(4, 2, SLOPE.E);
      for (let y = 0; y < 5; y++) m.set(5, y, 2, 1);
      const withStairs = reachableCells(m, { x: 1, y: 2 });
      expect(withStairs.has('5,2')).toBe(true);
      expect(withStairs.has('5,0')).toBe(true); // up on the raised floor, free to roam
    });

    it('treats pits and water as unreachable, bridges as reachable', () => {
      const m = flat(9, 3);
      for (let y = 0; y < 3; y++) m.setFlag(4, y, FLAG.WATER);
      expect(reachableCells(m, { x: 1, y: 1 }).has('6,1')).toBe(false);

      m.setDeck(4, 1, 1, 6);
      // a 1-level deck is a step too high from flat ground
      expect(reachableCells(m, { x: 1, y: 1 }).has('4,1')).toBe(false);

      // ramps up onto the bridge and down off it make it a path
      m.setSlope(3, 1, SLOPE.E);
      m.setSlope(5, 1, SLOPE.W);
      const r = reachableCells(m, { x: 1, y: 1 });
      expect(r.has('4,1')).toBe(true);
      expect(r.has('6,1')).toBe(true);
      expect(r.has('4,0')).toBe(false); // water beside the bridge stays unreachable
    });
  });

  describe('blockers that only cover some levels', () => {
    const walkRight = (sim: Simulation, b: Body, ticks: number): void =>
      run(sim, ticks, () => {
        b.vx = 3;
      });

    it('a blocker with no levels stops everything, one with levels only stops what overlaps them', () => {
      const m = flat(12, 3);
      m.setFlag(5, 1, FLAG.BLOCK);
      expect(m.blockedAt(5, 1, 0, 1)).toBe(true);
      expect(m.blockedAt(5, 1, 40, 1)).toBe(true);
      m.setBlockBand(5, 1, 0, 2); // levels 0 and 1
      expect(m.getBlockBand(5, 1)).toEqual({ low: 0, high: 2 });
      expect(m.blockedAt(5, 1, 0, 1)).toBe(true);
      expect(m.blockedAt(5, 1, 1.5, 1)).toBe(true);
      expect(m.blockedAt(5, 1, 2, 1)).toBe(false);
      expect(m.blockedAt(5, 1, 3, 1)).toBe(false);
      m.setBlockBand(5, 1, 3, 5); // an overhead wall: a walker on the floor is under it
      expect(m.blockedAt(5, 1, 0, 1)).toBe(false);
      expect(m.blockedAt(5, 1, 2.5, 1)).toBe(true); // a tall body reaching up into it
      expect(m.blockedAt(5, 1, 3, 1)).toBe(true);
      m.setBlockBand(5, 1, 0, 0);
      expect(m.getBlockBand(5, 1)).toBeNull();
    });

    it('a walker on the floor is stopped by a low blocker; the same blocker does not stop a walker on a deck above it', () => {
      const m = flat(12, 3);
      m.setFlag(5, 1, FLAG.BLOCK);
      m.setBlockBand(5, 1, 0, 2);
      const low = world(m, 3.5, 1.5, 0);
      walkRight(low.sim, low.b, 90);
      expect(low.t.x).toBeLessThan(5.01);
      // a bridge at level 3 over the blocker
      const m2 = flat(12, 3);
      m2.setFlag(5, 1, FLAG.BLOCK);
      m2.setBlockBand(5, 1, 0, 2);
      for (const x of [3, 4, 5, 6, 7]) m2.setDeck(x, 1, 3, 6);
      const high = world(m2, 3.5, 1.5, 3);
      walkRight(high.sim, high.b, 90);
      expect(high.t.x).toBeGreaterThan(6);
    });

    it('an overhead blocker does not stop a walker on the floor beneath it (a low ceiling for tall things only)', () => {
      const m = flat(12, 3);
      m.setFlag(5, 1, FLAG.BLOCK);
      m.setBlockBand(5, 1, 3, 5);
      const w = world(m, 3.5, 1.5, 0);
      walkRight(w.sim, w.b, 90);
      expect(w.t.x).toBeGreaterThan(6);
    });

    it('the walk test and cell checks use the level a walker stands at', () => {
      const m = flat(8, 1);
      m.setFlag(3, 0, FLAG.BLOCK);
      m.setBlockBand(3, 0, 3, 5);
      expect(m.cellBlocked(3, 0)).toBe(false);
      expect(reachableCells(m, { x: 0, y: 0 }).has('6,0')).toBe(true);
      m.setBlockBand(3, 0, 0, 1);
      expect(m.cellBlocked(3, 0)).toBe(true);
      expect(reachableCells(m, { x: 0, y: 0 }).has('6,0')).toBe(false);
    });
  });
});
