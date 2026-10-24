import { describe, expect, it } from 'vitest';
import { applySave, serializeGame } from '@tilewright/runtime';
import { flatScene, player, rig } from '@tilewright/plugin-sdk/testing';
import { attachBehavior } from '@tilewright/behaviors';
import { damage, healthOf } from '@tilewright/plugin-combat';
import { ctxOf } from '@tilewright/plugin-sdk/testing';
import '@tilewright/bundled-plugins';

/** Found by the compatibility corpus: a loaded game started at full health, because the health of the player is only created on the first tick. */
function game() {
  const { scene } = flatScene();
  const p = player('p', 5.5, 5.5);
  attachBehavior(p.components, 'health');
  Object.assign(p.components.health as object, { max: 10, onDeath: 'respawn', invulnerableSeconds: 0 });
  scene.entities.push(p);
  return rig(scene);
}

describe('loading a save', () => {
  it('brings the player back with the health they had', () => {
    const a = game();
    a.run(3);
    damage(ctxOf(a), a.get('p'), 6, { ignoreIframes: true });
    expect(healthOf(a.get('p'))?.hp).toBe(4);
    const save = serializeGame(a.sim, { stamp: 'now', label: 'test', playSeconds: 1 });
    expect(save.player?.hp).toBe(4);

    // a fresh game of the same scene (the way a load starts), then the save is applied
    const b = game();
    b.sim.compat.loadRestoresHealth = true;
    applySave(b.sim, save);
    b.run(3);
    expect(healthOf(b.get('p'))?.hp).toBe(4);
    b.run(30);
    expect(healthOf(b.get('p'))?.hp).toBe(4); // and it is not restored again
  });

  it('a project that has not turned the flag on keeps the older behaviour: a loaded game starts at full health', () => {
    const a = game();
    a.run(3);
    damage(ctxOf(a), a.get('p'), 6, { ignoreIframes: true });
    const save = serializeGame(a.sim, { stamp: 'now', label: 'test', playSeconds: 1 });
    const b = game();
    applySave(b.sim, save);
    b.run(3);
    expect(healthOf(b.get('p'))?.hp).toBe(10);
  });

  it('a save made before the first tick has no health to restore, and the player starts full', () => {
    const a = game();
    const save = serializeGame(a.sim, { stamp: 'now', label: 'test', playSeconds: 0 });
    const b = game();
    b.sim.compat.loadRestoresHealth = true;
    applySave(b.sim, save);
    b.run(3);
    expect(healthOf(b.get('p'))?.hp).toBe(10);
  });
});
