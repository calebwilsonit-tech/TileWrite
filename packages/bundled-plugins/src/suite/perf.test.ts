import { describe, expect, it } from 'vitest';
import { TableSchema } from '@tilewright/runtime';
import { rig, thing, flatScene } from '@tilewright/plugin-sdk/testing';
import { setActivePacks } from '@tilewright/behaviors';
import '@tilewright/bundled-plugins';

setActivePacks(undefined);

/**
 * The builder sample's budget: 60 frames a second leaves 16 ms for everything; the simulation may use at most half of it with 200
 * villagers walking to their work through a town of farms, markets and houses.
 */
describe('a town of two hundred walking villagers', () => {
  it('takes well under half of a 60 fps frame for the game logic', () => {
    const { scene } = flatScene(64, 64);
    scene.entities.push(thing('cam', 'Camera', 32.5, 32.5, { cameraRig: {}, builder: {}, calendar: { dayLength: 60 } }));
    const solid = { w: 1.8, d: 1.8, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] };
    for (let i = 0; i < 12; i++) scene.entities.push({ ...thing(`f${i}`, 'Farm', 10.5 + (i % 4) * 10, 10.5 + Math.floor(i / 4) * 18, { producer: { makes: 'food:3', seconds: 4 } }, { collider: solid }), tags: ['farm'] });
    for (let i = 0; i < 6; i++) scene.entities.push({ ...thing(`m${i}`, 'Market', 14.5 + i * 7, 50.5, { producer: { makes: 'gold:6', uses: 'food:1', seconds: 5 } }, { collider: solid }), tags: ['market'] });
    for (let i = 0; i < 200; i++) scene.entities.push(thing(`v${i}`, `Villager ${i}`, 2.5 + (i % 20) * 3, 2.5 + Math.floor(i / 20) * 1.2, { utilityAgent: { table: 'Activities', needs: 'hunger:0.1', speed: 3 } }));
    const r = rig(scene);
    r.sim.assets.tables.set(
      'Activities',
      TableSchema.parse({
        name: 'Activities',
        columns: [{ id: 'need', type: 'text' }, { id: 'gain', type: 'number' }, { id: 'target', type: 'text' }, { id: 'seconds', type: 'number' }, { id: 'weight', type: 'number' }, { id: 'when', type: 'text' }, { id: 'makes', type: 'text' }],
        rows: [
          { id: 'tend', need: '', gain: 0, target: 'farm', seconds: 3, weight: 30, when: 'any', makes: 'food:1' },
          { id: 'trade', need: '', gain: 0, target: 'market', seconds: 3, weight: 25, when: 'any', makes: 'gold:2' },
        ],
      }),
    );
    let done = 0;
    r.sim.events.on('activity-done', () => void done++);
    r.run(120); // let them all set off
    let peak = 0;
    let spent = 0;
    const chunks = 30;
    for (let k = 0; k < chunks; k++) {
      const t0 = performance.now();
      r.run(20);
      spent += performance.now() - t0;
      const walking = r.sim.world.all().filter((e) => e.name.startsWith('Villager') && Math.hypot(e.get<{ vx: number; vy: number }>('body')!.vx, e.get<{ vx: number; vy: number }>('body')!.vy) > 0.1).length;
      peak = Math.max(peak, walking);
    }
    const perStep = spent / (chunks * 20);
    expect(peak).toBeGreaterThan(60); // a crowd really is on the move
    expect(done).toBeGreaterThan(50); // and they get to work
    expect(perStep).toBeLessThan(8);
    process.stdout.write(`200 villagers: ${perStep.toFixed(2)} ms per step, ${peak} walking at once, ${done} jobs done\n`);
  });
});
