import { describe, expect, it } from 'vitest';
import { World } from './world';
import { Simulation } from '../core/simulation';

describe('World', () => {
  it('spawns entities with names, tags and components', () => {
    const w = new World();
    const e = w.spawn({ name: 'crate', tags: ['pushable'], components: { hp: { v: 3 } } });
    expect(w.get(e.id)).toBe(e);
    expect(e.tags.has('pushable')).toBe(true);
    expect(e.require<{ v: number }>('hp').v).toBe(3);
    expect(w.findByName('crate')).toBe(e);
  });

  it('queries by components and tags', () => {
    const w = new World();
    const a = w.spawn({ tags: ['x'], components: { p: 1, q: 1 } });
    w.spawn({ components: { p: 1 } });
    expect(w.query('p')).toHaveLength(2);
    expect(w.query('p', 'q')).toEqual([a]);
    expect(w.withTag('x')).toEqual([a]);
  });

  it('never reuses ids', () => {
    const w = new World();
    const a = w.spawn();
    w.destroy(a);
    const b = w.spawn();
    expect(b.id).not.toBe(a.id);
    expect(w.get(a.id)).toBeUndefined();
  });

  it('gives a require() error that names the entity and component', () => {
    const w = new World();
    const e = w.spawn({ name: 'door' });
    expect(() => e.require('lock')).toThrow(/door.*lock/);
  });

  it('keeps refs safe after destroy', () => {
    const w = new World();
    const e = w.spawn();
    const ref = w.ref(e.id);
    expect(ref.alive).toBe(true);
    w.destroy(e);
    expect(ref.get()).toBeUndefined();
    expect(ref.alive).toBe(false);
    w.destroy(e); // second destroy is harmless
    w.destroy(99999); // so is a bogus id
  });

  it('defers spawn and destroy during a tick so loops never break', () => {
    const w = new World();
    const a = w.spawn({ components: { n: 1 } });
    const b = w.spawn({ components: { n: 1 } });
    w.beginTick();
    const seen: number[] = [];
    for (const e of w.query('n')) {
      seen.push(e.id);
      w.destroy(b); // destroy someone we haven't visited yet
      w.spawn({ components: { n: 1 } }); // spawn more while looping
    }
    // b was destroyed mid-loop but the snapshot still lists it; callers must check alive
    expect(seen).toEqual([a.id, b.id]);
    expect(w.get(b.id)).toBeUndefined();
    expect(w.query('n')).toHaveLength(1); // spawns are invisible until the tick ends
    w.endTick();
    expect(w.query('n')).toHaveLength(3); // a + two spawns made while looping
  });

  it('lets a system hold a stale entity without crashing', () => {
    const sim = new Simulation();
    const target = sim.world.spawn({ name: 'target', components: { hp: { v: 1 } } });
    const ref = sim.world.ref(target.id);
    sim.addSystem('kill', ({ world }) => world.destroy(target));
    sim.addSystem('shoot', () => {
      const t = ref.get();
      if (t) t.require<{ v: number }>('hp').v -= 1; // skipped once destroyed
    });
    expect(() => {
      sim.step();
      sim.step();
    }).not.toThrow();
    expect(sim.world.count).toBe(0);
  });
});
