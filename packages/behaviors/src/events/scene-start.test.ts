import { describe, expect, it } from 'vitest';
import { loadScene } from '@tilewright/runtime';
import { newAction, newCondition, newRow, setActivePacks } from '@tilewright/behaviors';
import { flatScene, rig } from '@tilewright/plugin-sdk/testing';

setActivePacks(undefined);

const counter = (condition: string) => {
  const { scene } = flatScene(6, 6);
  scene.events = [{ ...newRow('r1'), conditions: [newCondition(condition)], actions: [{ ...newAction('setVariable'), params: { name: 'n', op: 'add', value: '1' } }] }];
  return { scene, r: rig(scene) };
};

describe('"the scene starts"', () => {
  it('is true on the first step, and again on the first step after a scene is loaded again (a new run); "the game starts" is only the very first', () => {
    const a = counter('sceneStart');
    a.r.run(30);
    expect(a.r.sim.runtime.vars.n).toBe(1);
    loadScene(a.r.sim, a.scene, { travel: true });
    a.r.run(30);
    expect(a.r.sim.runtime.vars.n).toBe(2);
    const b = counter('start');
    b.r.run(30);
    loadScene(b.r.sim, b.scene, { travel: true });
    b.r.run(30);
    expect(b.r.sim.runtime.vars.n).toBe(1);
  });
});
