import { describe, expect, it } from 'vitest';
import { Rng } from './rng';
import { FixedTimestep } from './timestep';
import { Simulation } from './simulation';
import { InputPlayback, InputRecorder, type ActionSnapshot } from '../input/input';
import { C, makeTransform, type TransformIso } from '../scene/components';
import { screenIntentToGrid } from '../iso/math';

describe('Rng', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(sa);
  });

  it('stays in range', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = r.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('can save and restore state', () => {
    const r = new Rng(9);
    r.next();
    const s = r.state;
    const x = r.next();
    r.state = s;
    expect(r.next()).toBe(x);
  });

  it('refuses to pick from nothing', () => {
    expect(() => new Rng().pick([])).toThrow();
  });
});

describe('FixedTimestep', () => {
  it('runs one step per 1/60 s', () => {
    const t = new FixedTimestep();
    expect(t.advance(16.7)).toBe(1);
    expect(t.advance(5)).toBe(0);
    expect(t.advance(12)).toBe(1); // 0.03 + 5 + 12 crosses the next boundary
  });

  it('accumulates fractional time without drift', () => {
    const t = new FixedTimestep();
    let steps = 0;
    for (let i = 0; i < 600; i++) steps += t.advance(1000 / 144); // 144 Hz monitor for ~4.17 s
    expect(steps).toBe(250);
  });

  it('caps catch-up after a long stall', () => {
    const t = new FixedTimestep();
    expect(t.advance(10_000)).toBe(5);
    expect(t.advance(0)).toBe(0);
  });

  it('ignores negative time', () => {
    expect(new FixedTimestep().advance(-50)).toBe(0);
  });
});

function makeWalkerSim(seed = 1): Simulation {
  const sim = new Simulation(seed);
  sim.world.spawn({ name: 'player', components: { [C.Transform]: makeTransform(5, 5) } });
  sim.addSystem('walk', ({ world, input, dt }) => {
    for (const e of world.query(C.Transform)) {
      const t = e.require<TransformIso>(C.Transform);
      const v = input.vector('left', 'right', 'up', 'down');
      const g = screenIntentToGrid(v.x, v.y);
      t.x += g.x * 4 * dt;
      t.y += g.y * 4 * dt;
    }
  });
  sim.addSystem('wobble', ({ world, rng }) => {
    // consumes randomness so the rng state is part of the hash
    world.query(C.Transform)[0]!.require<TransformIso>(C.Transform).h = rng.int(0, 3);
  });
  return sim;
}

function script(): ActionSnapshot[] {
  const out: ActionSnapshot[] = [];
  for (let i = 0; i < 300; i++) {
    if (i < 100) out.push({ right: 1 });
    else if (i < 160) out.push({ down: 1, right: 1 });
    else if (i < 200) out.push({});
    else out.push({ left: 1, up: 1 });
  }
  return out;
}

describe('Simulation determinism', () => {
  it('produces identical state from identical seed and inputs', () => {
    const a = makeWalkerSim(5);
    const b = makeWalkerSim(5);
    for (const s of script()) {
      a.step(s);
      b.step(s);
    }
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.tick).toBe(300);
  });

  it('produces different state for different inputs', () => {
    const a = makeWalkerSim(5);
    const b = makeWalkerSim(5);
    for (const s of script()) a.step(s);
    for (const s of script()) b.step({ ...s, right: 0 });
    expect(a.stateHash()).not.toBe(b.stateHash());
  });

  it('replays a recording exactly', () => {
    const live = makeWalkerSim(11);
    const rec = new InputRecorder();
    for (const s of script()) {
      rec.record(s);
      live.step(s);
    }
    const recording = rec.finish();
    expect(recording.events.length).toBeLessThan(10); // only changes are stored

    const replay = makeWalkerSim(11);
    const pb = new InputPlayback(JSON.parse(JSON.stringify(recording)));
    while (!pb.done) replay.step(pb.next());
    expect(replay.stateHash()).toBe(live.stateHash());
  });

  it('moves the walker the expected distance', () => {
    const sim = makeWalkerSim();
    for (let i = 0; i < 60; i++) sim.step({ down: 1 });
    const t = sim.world.findByName('player')!.require<TransformIso>(C.Transform);
    // screen-down = grid (+1,+1) normalised; 4 cells/s for 1 s
    expect(t.x).toBeCloseTo(5 + 4 * Math.SQRT1_2, 5);
    expect(t.y).toBeCloseTo(5 + 4 * Math.SQRT1_2, 5);
  });
});

describe('a button the interface takes (claimInput)', () => {
  /** A simulation with a system that counts how many times the world saw "interact" pressed. */
  function rig(): { sim: Simulation; seen: () => number } {
    const sim = new Simulation(1);
    let n = 0;
    sim.addSystem('count', (ctx) => void (ctx.input.pressed('interact') && n++));
    return { sim, seen: () => n };
  }

  it('is not seen by the world: a screen that takes the press does not also make the game talk to whoever is near', () => {
    const { sim, seen } = rig();
    sim.claimInput = (snapshot) => ((snapshot.interact ?? 0) > 0 ? ['interact'] : []);
    for (let i = 0; i < 10; i++) sim.step({ interact: 1 }); // held for ten ticks
    expect(seen()).toBe(0);
    sim.step({});
    sim.claimInput = null;
    sim.step({ interact: 1 });
    expect(seen()).toBe(1); // when nothing claims it, the world sees the press as before
  });

  it('keeps ignoring a button that was taken until it is let go, so it cannot fire when the screen closes', () => {
    const { sim, seen } = rig();
    sim.claimInput = (snapshot) => ((snapshot.interact ?? 0) > 0 ? ['interact'] : []);
    sim.step({ interact: 1 });
    sim.claimInput = null; // the screen is gone, the button is still down
    for (let i = 0; i < 5; i++) sim.step({ interact: 1 });
    expect(seen()).toBe(0);
    sim.step({});
    sim.step({ interact: 1 });
    expect(seen()).toBe(1);
  });

  it('is still seen by the interface itself (uiInput), which is how it finds the press to act on', () => {
    const sim = new Simulation(1);
    sim.claimInput = () => ['interact'];
    let ui = false;
    sim.addSystem('ui', (ctx) => void (ui ||= ctx.uiInput.pressed('interact')));
    sim.step({ interact: 1 });
    expect(ui).toBe(true);
  });
});
