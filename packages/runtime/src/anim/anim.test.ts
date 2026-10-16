import { describe, expect, it } from 'vitest';
import { EASING, Tweens, type EasingName } from './tween';
import { ANIMATOR, animationSystem, conditionHolds, locomotionController, makeAnimator, nextState } from './animator';
import { Simulation } from '../core/simulation';
import { C, makeSprite, makeTransform } from '../scene/components';
import { LAYER, makeBody, physicsSystem, type Body } from '../physics/physics';
import { TileMap } from '../tilemap/tilemap';
import { newSprite } from '../sprites/format';

describe('easing', () => {
  const names = Object.keys(EASING) as EasingName[];

  it('every curve starts at 0 and ends at 1', () => {
    for (const n of names) {
      expect(EASING[n](0), n).toBeCloseTo(0, 6);
      expect(EASING[n](1), n).toBeCloseTo(1, 6);
    }
  });

  it('in/out curves are monotonic', () => {
    for (const n of ['linear', 'quadIn', 'quadOut', 'quadInOut', 'cubicIn', 'cubicOut', 'cubicInOut', 'sineInOut'] as const) {
      let prev = -1;
      for (let i = 0; i <= 100; i++) {
        const v = EASING[n](i / 100);
        expect(v, n).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it('back and elastic overshoot, bounce stays in range', () => {
    expect(Math.max(...Array.from({ length: 101 }, (_, i) => EASING.backOut(i / 100)))).toBeGreaterThan(1);
    expect(Math.max(...Array.from({ length: 101 }, (_, i) => EASING.elasticOut(i / 100)))).toBeGreaterThan(1);
    for (let i = 0; i <= 100; i++) {
      const b = EASING.bounceOut(i / 100);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe('Tweens', () => {
  it('interpolates over time, then calls onDone once', () => {
    const t = new Tweens();
    const values: number[] = [];
    let done = 0;
    t.add({ from: 10, to: 20, duration: 1, apply: (v) => values.push(v), onDone: () => done++ });
    for (let i = 0; i < 60; i++) t.update(1 / 60);
    expect(values[29]).toBeCloseTo(15, 5);
    expect(values.at(-1)).toBeCloseTo(20, 9);
    expect(done).toBe(1);
    t.update(1);
    expect(done).toBe(1);
    expect(t.count).toBe(0);
  });

  it('honours delay, easing and cancel', () => {
    const t = new Tweens();
    let v = 0;
    t.add({ from: 0, to: 1, duration: 1, delay: 0.5, ease: 'quadIn', apply: (x) => (v = x) });
    t.update(0.4);
    expect(v).toBe(0);
    t.update(0.6); // 0.5 s into a 1 s tween: quadIn(0.5)
    expect(v).toBeCloseTo(0.25, 5);
    const id = t.add({ from: 0, to: 100, duration: 1, apply: () => (v = -1) });
    t.cancel(id);
    t.update(0.1);
    expect(v).not.toBe(-1);
  });

  it('handles zero-length tweens and tweens started inside a callback', () => {
    const t = new Tweens();
    const log: string[] = [];
    t.add({
      from: 0,
      to: 1,
      duration: 0,
      apply: () => log.push('a'),
      onDone: () => {
        log.push('done a');
        t.add({ from: 0, to: 1, duration: 0.1, apply: () => log.push('b') });
      },
    });
    t.update(1 / 60);
    t.update(1 / 60);
    expect(log.slice(0, 2)).toEqual(['a', 'done a']);
    expect(log).toContain('b');
  });

  it('runs identically inside the simulation each time', () => {
    const run = () => {
      const sim = new Simulation(1);
      const e = sim.world.spawn({ components: { [C.Transform]: makeTransform(0, 0, 0) } });
      sim.tweens.add({ from: 0, to: 10, duration: 0.5, ease: 'cubicOut', apply: (v) => ((e.components.get(C.Transform) as { x: number }).x = v) });
      for (let i = 0; i < 40; i++) sim.step();
      return sim.stateHash();
    };
    expect(run()).toBe(run());
  });
});

describe('animator state machine', () => {
  it('evaluates conditions', () => {
    expect(conditionHolds({ param: 'speed', op: '>', value: 0.2 }, { speed: 1 })).toBe(true);
    expect(conditionHolds({ param: 'speed', op: '>', value: 0.2 }, {})).toBe(false);
    expect(conditionHolds({ param: 'airborne', op: '==', value: true }, { airborne: true })).toBe(true);
    expect(conditionHolds({ param: 'airborne', op: '!=', value: true }, { airborne: false })).toBe(true);
    expect(conditionHolds({ param: 'x', op: '<=', value: 3 }, { x: 3 })).toBe(true);
    expect(conditionHolds({ param: 'x', op: '>=', value: 4 }, { x: 3 })).toBe(false);
  });

  it('moves between locomotion states and waits for clips to end when asked', () => {
    const c = locomotionController({ idle: 'idle', walk: 'walk', air: 'jump' });
    expect(nextState(c, 'idle', { speed: 0 }, false)).toBeUndefined();
    expect(nextState(c, 'idle', { speed: 3 }, false)).toBe('walk');
    expect(nextState(c, 'walk', { speed: 0 }, false)).toBe('idle');
    expect(nextState(c, 'walk', { speed: 3, airborne: true }, false)).toBe('air');
    expect(nextState(c, 'air', { airborne: false, speed: 0 }, false)).toBe('idle');
    const attack = { initial: 'idle', states: { idle: { clip: 'idle' }, hit: { clip: 'hit' } }, transitions: [{ from: 'idle', to: 'hit', when: [] }, { from: 'hit', to: 'idle', when: [], waitForEnd: true }] };
    expect(nextState(attack, 'hit', {}, false)).toBeUndefined();
    expect(nextState(attack, 'hit', {}, true)).toBe('idle');
  });
});

describe('animationSystem', () => {
  function world() {
    const sim = new Simulation(1);
    const sprite = newSprite('hero', 4, 4);
    sprite.frames = [100, 100, 100, 100].map((duration) => ({ duration, cels: {}, boxes: [] }));
    sprite.clips = [
      { name: 'idle', loop: true, mirror: false, all: [0], dirs: {}, events: [] },
      { name: 'walk', loop: true, mirror: true, all: [], dirs: { E: [1, 2], S: [3, 1] }, events: [{ at: 1, name: 'footstep' }] },
    ];
    sim.assets.sprites.set('hero', sprite);
    const map = new TileMap(10, 10);
    map.fill(1);
    sim.map = map;
    const e = sim.world.spawn({
      name: 'hero',
      components: {
        [C.Transform]: makeTransform(5, 5, 0, 0),
        [C.Sprite]: makeSprite({ asset: 'hero' }),
        [C.Body]: makeBody({ layer: LAYER.PLAYER }),
        [ANIMATOR]: makeAnimator({ asset: 'hero', controller: locomotionController({ idle: 'idle', walk: 'walk' }) }),
      },
    });
    sim.addSystem('physics', physicsSystem);
    sim.addSystem('anim', animationSystem);
    return { sim, e, body: e.require<Body>(C.Body), anim: e.require<ReturnType<typeof makeAnimator>>(ANIMATOR), t: e.require<{ facing: number }>(C.Transform) };
  }

  it('idles, then walks when the body moves, then idles again', () => {
    const { sim, body, anim } = world();
    sim.step();
    expect(anim.state).toBe('idle');
    expect(anim.frame).toBe(0);
    body.vx = 3;
    sim.step();
    sim.step();
    expect(anim.state).toBe('walk');
    expect(anim.clip).toBe('walk');
    body.vx = 0;
    sim.step();
    expect(anim.state).toBe('idle');
  });

  it('plays the frames for the facing, mirrored when needed', () => {
    const { sim, body, anim, t } = world();
    body.vx = 3;
    t.facing = 0; // E
    for (let i = 0; i < 3; i++) sim.step();
    expect([1, 2]).toContain(anim.frame);
    expect(anim.flip).toBe(false);
    t.facing = 4; // W reuses E, flipped
    sim.step();
    expect([1, 2]).toContain(anim.frame);
    expect(anim.flip).toBe(true);
    t.facing = 2; // S has its own frames
    sim.step();
    expect([3, 1]).toContain(anim.frame);
    expect(anim.flip).toBe(false);
  });

  it('steps through frames over time and fires clip events once per pass', () => {
    const { sim, body, anim } = world();
    body.vx = 3;
    const events: string[] = [];
    sim.events.on('anim-event', (e) => events.push(e.name as string));
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      sim.step();
      seen.add(anim.frame);
    }
    expect(seen.has(1) && seen.has(2)).toBe(true);
    // 1 s of walking = 5 passes of the 2-frame, 200 ms clip; footstep is on position 1 of each pass
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events.length).toBeLessThanOrEqual(6);
    expect(new Set(events)).toEqual(new Set(['footstep']));
  });

  it('is deterministic', () => {
    const run = () => {
      const w = world();
      w.body.vx = 2;
      for (let i = 0; i < 90; i++) w.sim.step();
      return w.sim.stateHash();
    };
    expect(run()).toBe(run());
  });

  it('ignores entities whose sprite asset is missing or whose clip does not exist', () => {
    const { sim, anim } = world();
    anim.asset = 'nope';
    expect(() => sim.step()).not.toThrow();
    anim.asset = 'hero';
    anim.controller = null;
    anim.clip = 'missing';
    expect(() => sim.step()).not.toThrow();
  });
});
