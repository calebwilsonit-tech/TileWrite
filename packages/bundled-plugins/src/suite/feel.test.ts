import { describe, expect, it } from 'vitest';
import { addImpact, emitFx, requestHitStop } from '@tilewright/runtime';
import { ctxOf, flatScene, player, rig, thing } from '@tilewright/plugin-sdk/testing';
import { attachBehavior } from '@tilewright/behaviors';
import { damage } from '@tilewright/plugin-combat';
import '@tilewright/bundled-plugins';

function arena() {
  const { scene } = flatScene();
  const p = player('p', 5.5, 5.5);
  attachBehavior(p.components, 'health');
  Object.assign(p.components.health as object, { max: 5, invulnerableSeconds: 0.1 });
  const foe = thing('foe', 'Foe', 7.5, 5.5, {});
  attachBehavior(foe.components, 'health');
  Object.assign(foe.components.health as object, { max: 5, onDeath: 'stay', invulnerableSeconds: 0 });
  scene.entities.push(p, foe);
  return rig(scene);
}

describe('hit feel', () => {
  it('hurting the player asks for a short freeze, a knock of the screen, sparks and a "hurt" sound', () => {
    const r = arena();
    damage(ctxOf(r), r.get('p'), 1, {});
    const rt = r.sim.runtime;
    expect(rt.hitStop).toBeGreaterThan(0);
    expect(rt.view.impact).toBeGreaterThan(0);
    expect(rt.fx.some((f) => f.kind === 'burst')).toBe(true);
    expect(rt.fx).toContainEqual({ kind: 'sound', name: 'hurt' });
  });

  it('hurting an enemy is quiet unless the weapon asks for more, and says "hit"', () => {
    const r = arena();
    damage(ctxOf(r), r.get('foe'), 1, {});
    expect(r.sim.runtime.hitStop).toBe(0);
    expect(r.sim.runtime.view.impact).toBe(0);
    expect(r.sim.runtime.fx).toContainEqual({ kind: 'sound', name: 'hit' });
    damage(ctxOf(r), r.get('foe'), 1, { hitStop: 0.05, shake: 3 });
    expect(r.sim.runtime.hitStop).toBe(3);
    expect(r.sim.runtime.view.impact).toBe(3);
  });

  it('a defeat puffs smoke and sounds "defeat"', () => {
    const r = arena();
    damage(ctxOf(r), r.get('foe'), 99, {});
    r.run(2);
    expect(r.sim.runtime.fx).toContainEqual({ kind: 'sound', name: 'defeat' });
    expect(r.sim.runtime.fx.some((f) => f.kind === 'burst' && f.preset === 'puff')).toBe(true);
  });

  it('the screen knock fades away by itself and the game logic is not changed by holding hit-stop requests', () => {
    const r = arena();
    addImpact(r.sim.runtime, 6);
    r.run(60);
    expect(r.sim.runtime.view.impact).toBe(0);
    // the simulation ignores hit-stop: the same ticks give the same state with or without a request
    const a = arena();
    const b = arena();
    requestHitStop(b.sim.runtime, 10);
    a.run(30);
    b.run(30);
    expect(b.sim.stateHash()).toBe(a.sim.stateHash());
  });

  it('the effect queue is capped so a headless run cannot grow it without end', () => {
    const r = arena();
    for (let i = 0; i < 1000; i++) emitFx(r.sim.runtime, { kind: 'sound', name: 'x' });
    expect(r.sim.runtime.fx.length).toBeLessThanOrEqual(128);
  });
});
