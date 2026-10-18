import { describe, expect, it } from 'vitest';
import { TableSchema } from '@tilewright/runtime';
import { healthOf, setActivePacks } from './index';
import { flatScene, rig, thing } from './testing';

setActivePacks(undefined);
const solid = { w: 0.7, d: 0.7, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] };

describe('a tower defence', () => {
  it('a tower shoots the enemies that walk the road, enemies that reach the end announce it, and waves come from a table', () => {
    const { scene } = flatScene(30, 12);
    for (let i = 1; i <= 3; i++) scene.entities.push({ ...thing(`w${i}`, `Waypoint ${i}`, 2.5 + (i - 1) * 10, 5.5, {}, {}), tags: ['route'] });
    scene.entities.push({ ...thing('t', 'Tower', 12.5, 8.5, { rangedAttack: { target: 'enemy', hurts: 'enemy', range: 7, cooldown: 0.5, windup: 0.1, damage: 2, needSight: false } }, { collider: solid }), tags: ['tower'] });
    scene.entities.push(thing('s', 'Spawn', 2.5, 5.5, { waveSpawner: { table: 'Waves', autoStart: false, rest: 2 } }));
    const r = rig(scene);
    r.sim.assets.tables.set('Waves', TableSchema.parse({ name: 'Waves', columns: [{ id: 'prefab', type: 'prefab' }, { id: 'count', type: 'number' }, { id: 'gap', type: 'number' }, { id: 'delay', type: 'number' }], rows: [{ id: 'w1', prefab: 'Runner', count: 3, gap: 1, delay: 0 }] }));
    r.sim.assets.prefabs.set('Runner', { schemaVersion: 1, name: 'Runner', root: { name: 'Runner', tags: ['enemy'], children: [], components: { transform: { x: 0, y: 0, h: 0, facing: 2 }, sprite: { shape: 'box', color: 0xaa3333, w: 0.6, d: 0.6, height: 1, sortOffset: 0, visible: true }, collider: solid, health: { max: 4, onDeath: 'remove', invulnerableSeconds: 0 }, pathFollower: { points: '', routeTag: 'route', speed: 2, removeAtEnd: true } } } } as never);
    // (the behaviours inside a prefab are plain components)
    r.sim.runtime.scratch.set('wave-next', true);
    const events: string[] = [];
    for (const n of ['path-end', 'died', 'wave-started', 'wave-cleared', 'waves-done']) r.sim.events.on(n, () => void events.push(n));
    r.run(60 * 40);
    expect(events).toContain('wave-started');
    const died = events.filter((e) => e === 'died').length;
    const ended = events.filter((e) => e === 'path-end').length;
    expect(died + ended).toBe(3);
    expect(died).toBeGreaterThan(0); // the tower hurt something
    expect(r.sim.world.withTag('enemy').length).toBe(0);
    expect(healthOf).toBeDefined();
  });
});
