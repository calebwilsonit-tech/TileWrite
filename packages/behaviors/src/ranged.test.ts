import { describe, expect, it } from 'vitest';
import { C, FLAG, tileMapToRows, type EntityData, type PrefabData, type TransformIso } from '@tilewright/runtime';
import { flatScene, player, rig, thing, type Rig } from './testing';
import { attachBehavior, healthOf, output, type VisionState } from './index';

const pos = (r: Rig, id: string): { x: number; y: number } => {
  const t = r.get(id).get<TransformIso>(C.Transform)!;
  return { x: t.x, y: t.y };
};

function hero(x: number, y: number, hp = 5): EntityData {
  const p = player('p', x, y);
  attachBehavior(p.components, 'health');
  Object.assign(p.components.health as object, { max: hp, onDeath: 'respawn', invulnerableSeconds: 0.3 });
  return p;
}

const BODY = { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 4, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null };

function archer(id: string, x: number, y: number, settings: object = {}, more: Record<string, object> = {}): EntityData {
  return thing(id, 'Archer ' + id, x, y, { health: { max: 2, onDeath: 'remove' }, rangedAttack: { windup: 0.2, cooldown: 1, speed: 10, range: 9, ...settings }, ...more }, { body: BODY });
}

const shots = (r: Rig) => r.sim.world.all().filter((e) => e.tags.has('projectile'));

describe('ranged attack', () => {
  it('aims, fires a ball at the target in range and the ball hurts the player once and vanishes', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(10.5, 5.5), archer('a', 4.5, 5.5));
    const r = rig(scene);
    r.run(5);
    expect(output(r.get('a'), 'aiming')).toBe(true); // taking aim
    r.run(15);
    expect(shots(r).length + (healthOf(r.get('p'))!.hp < 5 ? 1 : 0)).toBeGreaterThan(0);
    r.run(60);
    expect(healthOf(r.get('p'))!.hp).toBeLessThan(5);
    expect(shots(r).filter((s) => pos(r, 'p').x - (s.get<TransformIso>(C.Transform)?.x ?? 0) < 1).length).toBeLessThanOrEqual(1);
  });

  it('does not shoot a target out of range, too close, or behind a wall, and waits between volleys', () => {
    const far = flatScene();
    far.scene.entities.push(hero(20.5, 5.5), archer('a', 2.5, 5.5, { range: 6 }));
    const r1 = rig(far.scene);
    r1.run(90);
    expect(r1.sim.events.of('shot')).toHaveLength(0);
    expect(healthOf(r1.get('p'))!.hp).toBe(5);

    const close = flatScene();
    close.scene.entities.push(hero(4.5, 5.5), archer('a', 3.5, 5.5, { minRange: 3 }));
    const r2 = rig(close.scene);
    r2.run(60);
    expect(healthOf(r2.get('p'))!.hp).toBe(5);

    const wall = flatScene();
    wall.map.setFlag(7, 5, FLAG.BLOCK);
    wall.scene.map = tileMapToRows(wall.map);
    wall.scene.entities.push(hero(10.5, 5.5), archer('a', 4.5, 5.5));
    const r3 = rig(wall.scene);
    let count = 0;
    for (let i = 0; i < 120; i++) {
      r3.run(1);
      count += r3.sim.events.of('shot').length;
    }
    expect(count).toBe(0);
    const open = flatScene();
    open.scene.entities.push(hero(10.5, 5.5, 99), archer('a', 4.5, 5.5, { needSight: false, cooldown: 2 }));
    const r4 = rig(open.scene);
    let shotsFired = 0;
    for (let i = 0; i < 300; i++) {
      r4.run(1);
      shotsFired += r4.sim.events.of('shot').length;
    }
    expect(shotsFired).toBeGreaterThanOrEqual(2);
    expect(shotsFired).toBeLessThanOrEqual(3); // one about every 2.3 seconds
  });

  it('fires a volley of several shots a moment apart, stands still while aiming and keeps the shooter from being hit by its own shot', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(11.5, 5.5, 99), archer('a', 4.5, 5.5, { volley: 3, volleyGap: 0.2, cooldown: 10, windup: 0.1 }, { }));
    const r = rig(scene);
    let fired = 0;
    for (let i = 0; i < 100; i++) {
      r.run(1);
      fired += r.sim.events.of('shot').length;
    }
    expect(fired).toBe(3);
    expect(healthOf(r.get('a'))!.hp).toBe(2); // its own shots never hurt it
  });

  it('stops a walker while it takes aim', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(11.5, 5.5), archer('a', 4.5, 5.5, { windup: 1 }, { patrol: { points: '4.5,5.5; 4.5,9.5', speed: 2, waitSeconds: 0 } }));
    const r = rig(scene);
    r.run(30);
    const before = pos(r, 'a');
    r.run(20);
    const after = pos(r, 'a');
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.3);
  });

  it('shoots a prefab when one is named, aimed and sped up by the attack', () => {
    const bolt: PrefabData = {
      schemaVersion: 1,
      name: 'Bolt',
      root: {
        name: 'Bolt',
        tags: ['bolt'],
        components: {
          transform: { x: 0, y: 0, h: 0, facing: 0 },
          sprite: { shape: 'box', color: 0x00ffff, w: 0.2, d: 0.2, height: 0.2, sortOffset: 0, visible: true },
          projectile: { speed: 1, lifetime: 1, useFacing: true, dirX: 1, dirY: 0, damage: 2, hurts: 'player', knockback: 0 },
        },
        children: [],
      },
    };
    const { scene } = flatScene();
    scene.entities.push(hero(11.5, 5.5), archer('a', 4.5, 5.5, { prefab: 'Bolt', speed: 12, damage: 1 }));
    const r = rig(scene);
    r.sim.assets.prefabs.set('Bolt', bolt);
    r.run(30);
    const made = r.sim.world.all().find((e) => e.name === 'Bolt');
    expect(made).toBeDefined();
    const p = made!.get<{ speed: number; useFacing: boolean; dirX: number }>('projectile')!;
    expect(p.speed).toBe(12);
    expect(p.useFacing).toBe(false);
    expect(p.dirX).toBeGreaterThan(0.9);
    r.run(40);
    expect(healthOf(r.get('p'))!.hp).toBe(3); // the prefab's own damage of 2
  });

  it('says so when the prefab it shoots cannot be found', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(11.5, 5.5), archer('a', 4.5, 5.5, { prefab: 'Nothing' }));
    const r = rig(scene);
    const problems: string[] = [];
    r.sim.events.on('problem', (e) => void problems.push(String(e.text)));
    r.run(40);
    expect(problems.join(' ')).toMatch(/prefab "Nothing", which does not exist/);
  });

  it('is silent when dead or switched off', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(11.5, 5.5), archer('a', 4.5, 5.5));
    const r = rig(scene);
    r.get('a').set('aiFlags', { busy: false, disabled: true, speedScale: 1, damageScale: 1 });
    r.get('a').set('state:aiFlags', { busy: false, disabled: true, speedScale: 1, damageScale: 1 });
    r.run(90);
    expect(healthOf(r.get('p'))!.hp).toBe(5);
  });
});

describe('hearing through walls', () => {
  function hears(wallCells: number, muffle: number): boolean {
    const fs = flatScene();
    for (let i = 0; i < wallCells; i++) fs.map.setFlag(7 + i, 5, FLAG.BLOCK);
    fs.scene.map = tileMapToRows(fs.map);
    const g = thing('g', 'Guard', 5.5, 5.5, { vision: { range: 1, angle: 10, hearing: 6, muffle } }, { body: BODY });
    fs.scene.entities.push(player('p', 9.5 + Math.max(0, wallCells - 1), 5.5), g);
    const r = rig(fs.scene);
    r.run(2);
    r.run(3, { move_right: 1, move_up: 1 });
    return r.get('g').get<VisionState>('state:vision')!.heard;
  }

  it('footsteps carry in the open, are muffled by a wall and lost behind a thick one', () => {
    expect(hears(0, 3)).toBe(true); // 4 cells away in the open
    expect(hears(1, 3)).toBe(false); // the same distance behind a wall: 4 + 3 = 7 cells of hearing needed
    expect(hears(1, 0)).toBe(true); // walls ignored when the guard is set not to care
    expect(hears(1, 1)).toBe(true); // a thin muffle: 4 + 1 = 5 cells
  });
});

describe('guards keep out of each other\'s way', () => {
  it('two guards heading for the same spot do not end up on top of each other', () => {
    const fs = flatScene();
    const mk = (id: string, x: number, y: number): EntityData => thing(id, id, x, y, { chase: { speed: 3, stopDistance: 0.1 }, vision: { range: 12, angle: 360, hearing: 0 } }, { body: BODY });
    fs.scene.entities.push(player('p', 12.5, 5.5), mk('g1', 5.5, 5.4), mk('g2', 5.5, 5.6));
    const r = rig(fs.scene);
    r.run(25); // on their way: they start 0.2 apart and pull apart
    const a0 = pos(r, 'g1');
    const b0 = pos(r, 'g2');
    expect(Math.hypot(a0.x - b0.x, a0.y - b0.y)).toBeGreaterThan(0.35);
    r.run(200);
    const a = pos(r, 'g1');
    const b = pos(r, 'g2');
    expect(Math.hypot(a.x - 12.5, a.y - 5.5)).toBeLessThan(2.5); // and both still reached the player
    expect(Math.hypot(b.x - 12.5, b.y - 5.5)).toBeLessThan(2.5);
  });
});

describe('shooting across levels', () => {
  it('a shot from a high ledge sinks to meet a target on the floor below', () => {
    const { scene } = flatScene();
    const a = archer('a', 4.5, 5.5, { range: 12 });
    (a.components.transform as TransformIso).h = 2;
    scene.entities.push(hero(10.5, 5.5, 50), a);
    const r = rig(scene);
    let hit = false;
    for (let i = 0; i < 240 && !hit; i++) {
      r.run(1);
      hit = r.sim.events.of('projectile-hit').length > 0;
    }
    expect(hit).toBe(true);
    expect(healthOf(r.get('p'))!.hp).toBeLessThan(50);
  });
});
