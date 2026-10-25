import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { currentFlags, type CompatFlags } from '../project/compat';
import { C, makeTransform, type TransformIso } from '../scene/components';
import { FLAG, SLOPE, TileMap } from '../tilemap/tilemap';
import { bodyBox, gravityFrame, type GravityDir } from './gravity';
import { jumpBody, makeBody, makeCollider, physicsSystem, type Body } from './physics';
import { SolidField } from './solids';

/**
 * Block physics (phase 3, step 4.3): a body is a box; it is stopped by every solid block it moves into, in every direction,
 * under any of the six gravities. These are the cases the older feet-only physics could not do.
 */

function flat(w = 12, h = 12): TileMap {
  const m = new TileMap(w, h);
  m.fill(1, 0);
  return m;
}

function rig(map: TileMap, x: number, y: number, z: number, gravity: GravityDir = '-z', opts: Partial<Body> = {}, flags: Partial<CompatFlags> = {}) {
  const sim = new Simulation(1);
  sim.map = map;
  // (gravity turns at once unless a test asks for the timed turn)
  sim.compat = { ...currentFlags(), timedGravity: false, ...flags };
  sim.runtime.gravity = gravity;
  sim.addSystem('physics', physicsSystem);
  const e = sim.world.spawn({ name: 'hero', components: { [C.Transform]: makeTransform(x, y, z), [C.Body]: makeBody({ height: 1.2, ...opts }) } });
  return { sim, e, t: e.require<TransformIso>(C.Transform), b: e.require<Body>(C.Body) };
}

const run = (sim: Simulation, ticks: number, each?: () => void): void => {
  for (let i = 0; i < ticks; i++) {
    each?.();
    sim.step();
  }
};

const solidsAt = (sim: Simulation, b: Body, t: TransformIso): boolean => {
  const frame = gravityFrame(b.g);
  return new SolidField(sim.map!).overlaps(bodyBox(frame, { x: t.x, y: t.y, h: t.h }, b.radius, b.height), { wade: b.wade });
};

describe('blocks as the world: what is solid', () => {
  it('reads columns, stairs, decks, blockers and stacks as the blocks they are', () => {
    const m = flat(6, 6);
    m.set(1, 1, 1, 3); // a column three levels tall
    m.setSlope(2, 1, SLOPE.E, 'stairs');
    m.setDeck(3, 1, 2, 6); // a bridge: one solid level with room under it
    m.setFlag(4, 1, FLAG.BLOCK);
    m.setBlock(5, 1, 2, 1); // a lone block two levels up
    const f = new SolidField(m);
    expect(f.piecesIn(1, 1, 2)).toHaveLength(1);
    expect(f.piecesIn(1, 1, 3)).toHaveLength(0);
    expect(f.piecesIn(1, 1, -1)).toHaveLength(1); // the ground goes on below
    expect(f.piecesIn(2, 1, 0).length).toBeGreaterThan(1); // a stair is steps, not a cube
    expect(f.piecesIn(3, 1, 1)).toHaveLength(1); // the deck is the level under its walkable top
    expect(f.piecesIn(3, 1, 0)).toHaveLength(0); // room beneath
    expect(f.piecesIn(4, 1, 9)).toHaveLength(1); // a blocker is solid at every level
    expect(f.piecesIn(5, 1, 2)).toHaveLength(1);
    expect(f.piecesIn(5, 1, 1)).toHaveLength(0); // a gap under it (an arch)
    expect(f.piecesIn(-1, 3, 0)).toHaveLength(1); // the edge of the world is a wall
  });

  it('only "solid" decides: a block can say it is not solid, and a wall tile is no more solid than any other', () => {
    const m = flat(4, 4);
    m.setBlock(1, 1, 0, 1, undefined, { solid: false });
    m.setBlock(2, 1, 0, 5); // brick (a "wall" tile in the default set)
    const f = new SolidField(m, { 1: { name: 'grass', top: 0, left: 0, right: 0 }, 5: { name: 'brick', top: 0, left: 0, right: 0, wall: true } });
    expect(f.piecesIn(1, 1, 0)).toHaveLength(0);
    expect(f.piecesIn(2, 1, 0)).toHaveLength(1);
    const soft = new SolidField(m, { 1: { name: 'vine', top: 0, left: 0, right: 0, props: { solid: false } }, 5: { name: 'brick', top: 0, left: 0, right: 0, wall: true } });
    expect(soft.piecesIn(2, 1, 0)).toHaveLength(1);
    expect(soft.piecesIn(0, 0, -1)).toHaveLength(0); // the ground itself is a non-solid tile here
  });
});

describe('every direction of movement', () => {
  it('a ceiling stops a jump (the older physics let it through)', () => {
    const m = flat(8, 8);
    for (let x = 2; x < 6; x++) for (let y = 2; y < 6; y++) m.setBlock(x, y, 2, 2); // a ceiling two levels up
    const { sim, t, b } = rig(m, 3.5, 3.5, 0);
    run(sim, 3);
    jumpBody(b, 11);
    let top = 0;
    run(sim, 40, () => (top = Math.max(top, t.h + b.height)));
    expect(top).toBeLessThanOrEqual(2 + 1e-4); // the head never goes into the ceiling
    expect(t.h).toBeCloseTo(0, 5); // and it comes back down
    expect(b.state).toBe('ground');
  });

  it('walking under an arch, and not under an overhang that is too low', () => {
    const m = flat(10, 6);
    m.setBlock(4, 2, 2, 2); // two levels up: room for a body 1.2 tall
    m.setBlock(6, 2, 1, 2); // one level up: no room
    const arch = rig(m, 2.5, 2.5, 0);
    arch.b.vx = 3;
    run(arch.sim, 90);
    expect(arch.t.x).toBeGreaterThan(5.5); // walked right under the arch and out
    const low = rig(m, 5.2, 2.5, 0);
    low.b.vx = 3;
    run(low.sim, 60);
    expect(low.t.x).toBeLessThan(6 - 0.3 + 1e-3); // stopped by the overhang
  });

  it('the body stands where it lands, on a floating block, and walks off its edge', () => {
    const m = flat(8, 8);
    m.setBlock(3, 3, 3, 2);
    const { sim, t, b } = rig(m, 3.5, 3.5, 6);
    run(sim, 90);
    expect(b.state).toBe('ground');
    expect(t.h).toBeCloseTo(4, 5);
  });

  it('climbs stairs and ramps smoothly and does not climb a block taller than its step', () => {
    const m = flat(10, 4);
    m.setSlope(3, 1, SLOPE.E, 'ramp');
    m.set(4, 1, 1, 1);
    const up = rig(m, 1.5, 1.5, 0);
    up.b.vx = 2;
    let worst = 0;
    let last = up.t.h;
    run(up.sim, 85, () => {
      worst = Math.max(worst, Math.abs(up.t.h - last));
      last = up.t.h;
    });
    expect(up.t.x).toBeGreaterThan(4.3);
    expect(worst).toBeLessThan(0.1);
    expect(up.t.h).toBeCloseTo(1, 4); // on top of the column at the top of the ramp
    const wall = rig(flatWithBlock(), 1.5, 1.5, 0);
    wall.b.vx = 2;
    run(wall.sim, 90);
    expect(wall.t.x).toBeLessThan(4 - 0.3 + 1e-3);
  });

  it('is stopped by an object (a crate), and stands on top of it when it lands there', () => {
    const m = flat(10, 4);
    const { sim, t, b } = rig(m, 1.5, 1.5, 0);
    sim.world.spawn({ name: 'crate', components: { [C.Transform]: makeTransform(5.5, 1.5, 0), [C.Collider]: makeCollider({ w: 1, d: 1, height: 1.5 }) } });
    b.vx = 3;
    run(sim, 90);
    expect(t.x).toBeLessThan(5 - 0.3 + 1e-3);
    const above = rig(m, 5.5, 1.5, 4);
    above.sim.world.spawn({ name: 'crate', components: { [C.Transform]: makeTransform(5.5, 1.5, 0), [C.Collider]: makeCollider({ w: 1, d: 1, height: 1.5 }) } });
    run(above.sim, 60);
    expect(above.t.h).toBeCloseTo(1.5, 5);
    expect(above.b.state).toBe('ground');
  });

  it('never tunnels, however fast it goes', () => {
    const m = flat(14, 4);
    m.setBlock(6, 1, 0, 2); // a single block in the way
    m.setBlock(6, 1, 1, 2);
    for (const speed of [4, 20, 60, 200]) {
      const { sim, t, b } = rig(m, 1.5, 1.5, 0);
      b.vx = speed;
      run(sim, 30);
      expect(t.x, `at ${speed} cells a second`).toBeLessThanOrEqual(6 - 0.3 + 1e-3);
    }
  });
});

describe('gravity in every direction', () => {
  it('lands on the ceiling when gravity points up, with its head toward the floor', () => {
    const m = flat(8, 8);
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) m.setBlock(x, y, 5, 2); // a ceiling at level 5 (its underside at z = 5)
    const { sim, t, b, e } = rig(m, 3.5, 3.5, 2.5, '+z');
    const landed: number[] = [];
    sim.events.on('landed', () => landed.push(1));
    run(sim, 90);
    expect(b.state).toBe('ground');
    expect(t.h).toBeCloseTo(5, 4); // the feet are on the underside
    expect(solidsAt(sim, b, t)).toBe(false);
    expect(landed.length).toBe(1);
    void e;
  });

  for (const dir of ['-x', '+x', '-y', '+y'] as GravityDir[]) {
    it(`lands on the wall that gravity ${dir} points at, and never goes into any block of it`, () => {
      const m = flat(10, 10);
      const { sim, t, b } = rig(m, 5.5, 5.5, 3, dir);
      run(sim, 120);
      expect(b.state, dir).toBe('ground');
      const f = gravityFrame(dir);
      const wall = dir[0] === '-' ? 0 : 10; // the edge of the map is the wall
      const coord = f.axis === 'x' ? t.x : t.y;
      expect(coord).toBeCloseTo(wall, 4);
      expect(solidsAt(sim, b, t)).toBe(false);
    });
  }

  it('walks up a wall (the other two axes) and is stopped by the floor and by blocks on it', () => {
    const m = flat(10, 10);
    m.setBlock(0, 5, 0, 2); // not in the way of the edge: the map edge itself is the wall at x = 0
    for (let z = 0; z < 5; z++) m.setBlock(1, 4, z, 2); // a block sticking out of the wall at y = 4
    const { sim, t, b } = rig(m, 5.5, 8.5, 3, '-x');
    run(sim, 90);
    expect(b.state).toBe('ground');
    expect(t.x).toBeCloseTo(0, 4);
    // walk along the wall in y toward the block that sticks out, at z = 3
    b.vy = -2.5;
    let worstOverlap = false;
    run(sim, 150, () => {
      worstOverlap = worstOverlap || solidsAt(sim, b, t);
    });
    expect(worstOverlap).toBe(false);
    expect(t.y).toBeGreaterThan(4 + 1 + b.radius - 1e-3); // stopped at the block's side (it fills y 4..5)
    // climb the wall (z) up: nothing above, so it can go as high as it likes; down: the floor stops it at its own width
    b.vy = 0;
    b.vz = -3;
    run(sim, 120);
    expect(t.h).toBeGreaterThanOrEqual(b.radius - 1e-3);
    expect(solidsAt(sim, b, t)).toBe(false);
  });

  it('jumps away from the surface it stands on (out from a wall, down from a ceiling)', () => {
    const wall = rig(flat(10, 10), 5.5, 5.5, 3, '-x');
    run(wall.sim, 90);
    jumpBody(wall.b, 8);
    run(wall.sim, 6);
    expect(wall.t.x).toBeGreaterThan(0.2);
    run(wall.sim, 90);
    expect(wall.t.x).toBeCloseTo(0, 4); // and back
  });

  it('turns gravity under a running game: the body keeps its middle, falls to the new surface, is never inside anything, and says so', () => {
    const m = flat(10, 10);
    for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) m.setBlock(x, y, 8, 2); // a ceiling for later
    const { sim, t, b, e } = rig(m, 5.5, 5.5, 0);
    run(sim, 20);
    expect(b.state).toBe('ground');
    const changes: { from: string; to: string; entity: number }[] = [];
    sim.events.on('gravity-changed', (d) => changes.push(d as never));
    const landings: number[] = [];
    sim.events.on('landed', () => landings.push(sim.tick));
    sim.runtime.gravity = '-x';
    let inside = false;
    run(sim, 150, () => {
      inside = inside || solidsAt(sim, b, t);
    });
    expect(changes).toMatchObject([{ from: '-z', to: '-x', entity: e.id }]);
    expect(inside).toBe(false);
    expect(b.state).toBe('ground');
    expect(t.x).toBeCloseTo(0, 4);
    expect(landings.length).toBe(1);
    // and to the ceiling and back to the floor
    for (const next of ['+z', '-z'] as GravityDir[]) {
      sim.runtime.gravity = next;
      run(sim, 150, () => {
        inside = inside || solidsAt(sim, b, t);
      });
      expect(b.state, next).toBe('ground');
    }
    expect(inside).toBe(false);
    expect(t.h).toBeCloseTo(0, 4);
  });

  describe('a turn of gravity that takes time (the timedGravity flag)', () => {
    /** The box the body fills now: while it turns, its pose is between the two, so this reads what the physics itself kept clear. */
    const timed = (m: TileMap, x = 5.5, y = 5.5, z = 0, opts: Partial<Body> = {}) => rig(m, x, y, z, '-z', opts, { timedGravity: true });

    it('moves the body over the time given, in steps, and ends standing on the new surface', () => {
      const { sim, t, b } = timed(flat(10, 10));
      run(sim, 20);
      const rest = { x: t.x, y: t.y, h: t.h };
      sim.runtime.gravity = '-x';
      sim.step();
      expect(b.turn).toBeDefined();
      const seen: number[] = [];
      run(sim, 40, () => seen.push(t.x));
      expect(b.turn).toBeUndefined();
      expect(b.g).toBe('-x');
      // it did not jump: x went down by small steps across the quarter second (15 ticks) and then on to the wall
      const early = seen.slice(0, 14);
      for (let i = 1; i < early.length; i++) expect(Math.abs(early[i]! - early[i - 1]!)).toBeLessThan(1.2);
      expect(Math.abs(seen[0]! - rest.x)).toBeLessThan(1.2);
      run(sim, 120);
      expect(b.state).toBe('ground');
      expect(t.x).toBeCloseTo(0, 4);
    });

    it('takes the time the scene says, the body says, or nothing at all when it says 0', () => {
      const ticksToTurn = (set: (sim: Simulation, b: Body) => void): number => {
        const { sim, b } = timed(flat(10, 10));
        run(sim, 20);
        set(sim, b);
        sim.runtime.gravity = '-x';
        let n = 0;
        sim.step();
        while (b.turn && n < 400) {
          sim.step();
          n++;
        }
        return n;
      };
      expect(ticksToTurn(() => undefined)).toBeGreaterThan(10); // a quarter of a second, by default
      expect(ticksToTurn(() => undefined)).toBeLessThan(20);
      const slow = ticksToTurn((sim) => (sim.runtime.gravityTurn = 1));
      expect(slow).toBeGreaterThan(55);
      expect(ticksToTurn((_s, b) => (b.turnSeconds = 0))).toBe(0);
      expect(ticksToTurn((sim, b) => { sim.runtime.gravityTurn = 1; b.turnSeconds = 0.5; })).toBeLessThan(slow);
    });

    it('is checked against the blocks every tick: never inside one, and it waits for room beside a pillar', () => {
      const m = flat(12, 12);
      // a pillar right where the body will swing out to: it stands one cell from the wall side
      for (let z = 0; z < 4; z++) m.setBlock(4, 5, z, 2);
      const { sim, t, b } = timed(m, 5.5, 5.5, 0);
      run(sim, 20);
      sim.runtime.gravity = '-x';
      let inside = false;
      const field = new SolidField(m);
      run(sim, 200, () => {
        const frame = gravityFrame(b.turn ? b.turn.to : b.g);
        // the box the body occupies this tick (the physics keeps it free of solids at the end of every tick)
        inside = inside || (b.turn === undefined ? field.overlaps(bodyBox(frame, { x: t.x, y: t.y, h: t.h }, b.radius, b.height), { wade: b.wade }) : b.turn.box !== undefined && field.overlaps(b.turn.box, { wade: b.wade }));
      });
      expect(inside).toBe(false);
      expect(b.turn).toBeUndefined();
      expect(b.state).toBe('ground');
    });

    it('waits for room in a corridor too narrow to turn in, and does not go into the walls while it waits', () => {
      const m = flat(12, 12);
      for (let y = 0; y < 12; y++) for (let z = 0; z < 4; z++) {
        m.setBlock(4, y, z, 2);
        m.setBlock(6, y, z, 2);
      }
      const { sim, b } = timed(m, 5.5, 5.5, 0);
      run(sim, 20);
      sim.runtime.gravity = '-x'; // lying toward a wall needs more than the one cell of width there is
      let waited = 0;
      let inside = false;
      const field = new SolidField(m);
      run(sim, 30, () => {
        if (b.turn && b.turn.held > 0) waited = b.turn.held;
        // while it waits its pose is the last free one: the box it fills is not inside a block
        if (b.turn?.box) inside = inside || field.overlaps(b.turn.box, { wade: b.wade });
      });
      expect(waited).toBeGreaterThan(0);
      expect(inside).toBe(false);
      run(sim, 200); // after the wait it goes on as well as it can, and the game does not hang
      expect(b.turn).toBeUndefined();
    });

    it('with the flag off, turns at once as it always did', () => {
      const { sim, b } = rig(flat(10, 10), 5.5, 5.5, 0, '-z', {}, { timedGravity: false });
      run(sim, 20);
      sim.runtime.gravity = '-x';
      sim.step();
      expect(b.turn).toBeUndefined();
      expect(b.g).toBe('-x');
    });

    it('is finished where it is when gravity turns again, and the new turn starts from there', () => {
      const { sim, b, t } = timed(flat(10, 10));
      run(sim, 20);
      sim.runtime.gravity = '-x';
      run(sim, 5);
      expect(b.turn?.to).toBe('-x');
      sim.runtime.gravity = '+y';
      run(sim, 5);
      expect(b.turn?.to).toBe('+y');
      run(sim, 200);
      expect(b.turn).toBeUndefined();
      expect(b.state).toBe('ground');
      expect(t.y).toBeCloseTo(10, 3);
    });
  });

  it('an object can have its own gravity, whatever the scene says', () => {
    const m = flat(10, 10);
    const a = rig(m, 5.5, 5.5, 0, '-z', { gdir: '-x' });
    run(a.sim, 150);
    expect(a.t.x).toBeCloseTo(0, 4);
  });

  it('pushes a body out when a block is put on it, rather than leaving it inside', () => {
    const m = flat(8, 8);
    const { sim, t, b } = rig(m, 3.5, 3.5, 0);
    run(sim, 10);
    m.setBlock(3, 3, 0, 2);
    m.setBlock(3, 3, 1, 2);
    run(sim, 10);
    expect(solidsAt(sim, b, t)).toBe(false);
  });

  it('a blocker is solid at every height, on the floor and on a wall', () => {
    const m = flat(10, 10);
    m.setFlag(0, 5, FLAG.BLOCK);
    const wall = rig(m, 5.5, 2.5, 4, '-x');
    run(wall.sim, 60);
    wall.b.vy = 3;
    run(wall.sim, 120);
    expect(wall.t.y).toBeLessThanOrEqual(5 - wall.b.radius + 1e-3);
  });

  it('water stops a body that cannot wade, and a body that can wade walks on it', () => {
    const m = flat(10, 4);
    for (let x = 4; x < 6; x++) for (let y = 0; y < 4; y++) m.setFlag(x, y, FLAG.WATER);
    const dry = rig(m, 1.5, 1.5, 0);
    dry.b.vx = 3;
    run(dry.sim, 90);
    expect(dry.t.x).toBeLessThan(4 - 0.3 + 1e-3);
    const wet = rig(m, 1.5, 1.5, 0, '-z', { wade: true });
    wet.b.vx = 3;
    run(wet.sim, 120);
    expect(wet.t.x).toBeGreaterThan(6);
  });
});

function flatWithBlock(): TileMap {
  const m = flat(10, 4);
  m.set(4, 1, 1, 2); // two levels tall: more than a body steps up
  return m;
}
