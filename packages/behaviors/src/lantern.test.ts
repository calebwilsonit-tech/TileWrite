import { describe, expect, it } from 'vitest';
import { C, type EntityData, type RegionData, type TransformIso } from '@tilewright/runtime';
import { attachBehavior, healthOf, newAction, newCondition, newRow, output } from './index';
import { flatScene, player, rig, thing, type Rig } from './testing';

const dark: RegionData = { id: 'r', name: 'Dark', x: 0, y: 0, w: 24, h: 24, cameraBounds: false, music: '', darkness: 0.95, bossActive: false };

function lanternHero(settings: object = {}, hp = 10): EntityData {
  const p = player('p', 5.5, 5.5);
  attachBehavior(p.components, 'health');
  Object.assign(p.components.health as object, { max: hp, onDeath: 'respawn', invulnerableSeconds: 0.2 });
  attachBehavior(p.components, 'lightResource');
  Object.assign(p.components.lightResource as object, settings);
  Object.assign(p.components.light as object, { radius: 6, flicker: 0 });
  return p;
}

const light = (r: Rig): number => r.sim.runtime.vars.light as number;
const radius = (r: Rig): number => r.get('p').get<{ radius: number }>('light')!.radius;

describe('light resource (lantern fuel)', () => {
  it('starts full, burns down, and the glow shrinks with it', () => {
    const { scene } = flatScene();
    scene.entities.push(lanternHero({ max: 100, burn: 10, refillNearLight: 0 }));
    const r = rig(scene);
    r.run(2);
    expect(light(r)).toBeCloseTo(100, 0);
    expect(r.sim.runtime.vars.lightMax).toBe(100);
    expect(radius(r)).toBeGreaterThan(5.5);
    r.run(300); // 5 seconds: 50 used
    expect(light(r)).toBeCloseTo(50, 0);
    expect(radius(r)).toBeLessThan(5);
    expect(radius(r)).toBeGreaterThan(2);
    r.run(900);
    expect(light(r)).toBe(0);
    expect(radius(r)).toBeCloseTo(1.5, 1); // the empty glow
    expect(output(r.get('p'), 'empty')).toBe(true);
    expect(output(r.get('p'), 'low')).toBe(true);
  });

  it('refills near another light, and not while standing in the dark', () => {
    const near = flatScene();
    near.scene.regions.push(dark);
    near.scene.entities.push(lanternHero({ burn: 0, refillNearLight: 20 }), thing('post', 'Post', 6.5, 5.5, { light: { radius: 4, flicker: 0 } }));
    const r = rig(near.scene);
    r.sim.runtime.vars.light = 10;
    r.run(180);
    expect(light(r)).toBeGreaterThan(40);
    const far = flatScene();
    far.scene.regions.push(dark);
    far.scene.entities.push(lanternHero({ burn: 0, refillNearLight: 20 }), thing('post', 'Post', 16.5, 5.5, { light: { radius: 4, flicker: 0 } }));
    const r2 = rig(far.scene);
    r2.sim.runtime.vars.light = 10;
    r2.run(180);
    expect(light(r2)).toBeCloseTo(10, 0);
  });

  it('its own glow does not refill it', () => {
    const { scene } = flatScene();
    scene.regions.push(dark);
    scene.entities.push(lanternHero({ burn: 0, refillNearLight: 50 }));
    const r = rig(scene);
    r.sim.runtime.vars.light = 20;
    r.run(120);
    expect(light(r)).toBeCloseTo(20, 0);
  });

  it('resting at a lantern post or being defeated fills it up, unless switched off', () => {
    const mk = (refillOnRest: boolean): Rig => {
      const { scene } = flatScene();
      scene.entities.push(lanternHero({ burn: 0, refillOnRest }), thing('post', 'Post', 6.2, 5.5, { checkpoint: { name: 'Post', reach: 2 } }));
      const r = rig(scene);
      r.sim.runtime.vars.light = 5;
      r.run(3);
      r.run(1, { interact: 1 });
      r.run(3);
      return r;
    };
    expect(light(mk(true))).toBe(100);
    expect(light(mk(false))).toBeCloseTo(5, 0);
    const { scene } = flatScene();
    scene.entities.push(lanternHero({ burn: 0 }, 2));
    const r = rig(scene);
    r.sim.runtime.vars.light = 5;
    r.run(2);
    r.get('p').get<{ hp: number }>('state:health')!.hp = 0;
    r.run(5);
    expect(light(r)).toBe(100);
  });

  it('hurts in the dark when empty, and only then', () => {
    const mk = (hurt: number, region: boolean): Rig => {
      const { scene } = flatScene();
      if (region) scene.regions.push(dark);
      scene.entities.push(lanternHero({ burn: 0, refillNearLight: 0, hurtWhenEmpty: hurt }, 10));
      const r = rig(scene);
      r.sim.runtime.vars.light = 0;
      r.run(260);
      return r;
    };
    expect(healthOf(mk(2, true).get('p'))!.hp).toBeLessThan(10);
    expect(healthOf(mk(0, true).get('p'))!.hp).toBe(10);
    expect(healthOf(mk(2, false).get('p'))!.hp).toBe(10); // empty, but not in the dark
  });

  it('is an ordinary variable: event rows can add to it, take from it and fill it', () => {
    const { scene } = flatScene();
    const act = (type: string, params: Record<string, unknown>) => ({ ...newAction(type), params: { ...newAction(type).params, ...params } });
    scene.events = [
      { ...newRow('add'), once: true, conditions: [{ ...newCondition('start') }], actions: [act('addLight', { amount: -60 })] },
      { ...newRow('fill'), conditions: [{ ...newCondition('variable'), params: { name: 'refill', op: '>=', value: '1' } }], actions: [act('addLight', { amount: 0 })] },
    ];
    scene.variables.push({ name: 'refill', value: 0 });
    scene.entities.push(lanternHero({ burn: 0, refillNearLight: 0 }));
    const r = rig(scene);
    r.run(4);
    expect(light(r)).toBe(40);
    r.sim.runtime.vars.refill = 1;
    r.run(3);
    expect(light(r)).toBe(100);
    expect(r.get('p').get<TransformIso>(C.Transform)).toBeDefined();
  });
});
