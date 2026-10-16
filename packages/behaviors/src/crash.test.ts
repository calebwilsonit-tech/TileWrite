import { describe, expect, it } from 'vitest';
import { SystemError, crashReport, formatCrashReport } from '@tilewright/runtime';
import { flatScene, player, rig, thing } from './testing';

describe('crash reports', () => {
  function boomRig() {
    const { scene } = flatScene();
    scene.variables.push({ name: 'gold', value: 7 });
    scene.entities.push(player('p', 2.5, 3.5), thing('door', 'Old door', 8.5, 6.5, {}));
    const r = rig(scene);
    r.run(5);
    return r;
  }

  it('names the object that failed, where it was, and what the game looked like', () => {
    const r = boomRig();
    const door = r.get('door');
    const err = new SystemError('behaviours:actuator', new TypeError('x is not a function'), door.id, 'The Gate behaviour on "Old door" failed: x is not a function');
    const rep = crashReport(r.sim, err);
    expect(rep.headline).toBe('The game stopped because "Old door" went wrong: x is not a function');
    expect(rep.entity).toMatchObject({ name: 'Old door', sceneId: 'door', x: 8.5, y: 6.5 });
    expect(rep.system).toBe('behaviours:actuator');
    expect(rep.snapshot).toMatchObject({ tick: 5, objects: 2, variables: { gold: 7 }, player: { x: 2.5, y: 3.5 } });
    const text = formatCrashReport(rep);
    expect(text).toContain('Object: "Old door" (door) at (8.5, 6.5)');
    expect(text).toContain('Variables: {"gold":7}');
    expect(text).toContain('Technical details:');
  });

  it('copes with a system error with no object, a plain error, and something that is not an error at all', () => {
    const r = boomRig();
    expect(crashReport(r.sim, new SystemError('physics', new Error('bad terrain'))).headline).toBe('The game stopped in its "physics" step: bad terrain');
    expect(crashReport(r.sim, new Error('plain')).headline).toBe('The game stopped because something went wrong: plain');
    const odd = crashReport(r.sim, 'just a string');
    expect(odd.message).toBe('just a string');
    expect(odd.stack).toBe('just a string');
    expect(odd.entity).toBeUndefined();
  });

  it('a real failing system produces a report from the thrown error', () => {
    const r = boomRig();
    r.sim.addSystem('my-script', () => {
      throw new RangeError('too far');
    });
    let caught: unknown;
    try {
      r.run(1);
    } catch (e) {
      caught = e;
    }
    const rep = crashReport(r.sim, caught);
    expect(rep.headline).toBe('The game stopped in its "my-script" step: too far');
    expect(rep.stack).toContain('caused by');
  });
});
