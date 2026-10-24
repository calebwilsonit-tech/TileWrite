import { describe, expect, it } from 'vitest';
import { C, FLAG, facingOfGridDir, tileMapToRows, type Body, type EntityData, type PrefabData, type RegionData, type TransformIso } from '@tilewright/runtime';
import { GRID_MINUS_X, GRID_PLUS_X, flatScene, player, rig, thing, type Rig } from '@tilewright/plugin-sdk/testing';
import { attachBehavior, newAction, newCondition, newRow, output, setInput, parsePoints, formatPoints } from '@tilewright/behaviors';
import { damage, healthOf, swingHits, aiFlags } from '@tilewright/plugin-combat';
import type { VisionState } from '@tilewright/plugin-ai';
import '@tilewright/bundled-plugins';

const pos = (r: Rig, id: string): { x: number; y: number; h: number } => {
  const t = r.get(id).get<TransformIso>(C.Transform)!;
  return { x: t.x, y: t.y, h: t.h };
};

function hero(x = 5.5, y = 5.5, extras: Record<string, object> = {}): EntityData {
  const p = player('p', x, y);
  attachBehavior(p.components, 'health');
  Object.assign(p.components.health as object, { max: 3, onDeath: 'respawn', invulnerableSeconds: 0.7 });
  for (const [id, settings] of Object.entries(extras)) {
    attachBehavior(p.components, id);
    Object.assign(p.components[id] as object, settings);
  }
  return p;
}

function enemy(id: string, x: number, y: number, behaviours: Record<string, object> = {}, extra: Record<string, unknown> = {}): EntityData {
  const body = { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 4, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null };
  const e = thing(id, 'Enemy ' + id, x, y, { health: { max: 2, onDeath: 'remove' }, ...behaviours }, { body, ...extra });
  return e;
}

describe('health and damage', () => {
  it('damage on touch hurts the player once per invulnerable period and pushes them away', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(), thing('spike', 'Spike', 6.2, 5.5, { damageOnTouch: { amount: 1, hurts: 'player', knockback: 8 } }));
    const r = rig(scene);
    r.run(3);
    expect(healthOf(r.get('p'))!.hp).toBe(2);
    expect(pos(r, 'p').x).toBeLessThan(5.5); // knocked back, away from the spike
    r.run(20);
    expect(healthOf(r.get('p'))!.hp).toBe(2); // invulnerable for 0.7 s
  });

  it('takes damage again after the invulnerable moment passes', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(5.5, 5.5), thing('spike', 'Spike', 5.5, 5.5, { damageOnTouch: { amount: 1, knockback: 0 } }));
    const r = rig(scene);
    r.run(3);
    expect(healthOf(r.get('p'))!.hp).toBe(2);
    r.run(60);
    expect(healthOf(r.get('p'))!.hp).toBe(1);
  });

  it('only hurts the sides it is meant to', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(5.5, 5.5), enemy('g', 5.5, 5.5), thing('trap', 'Trap', 5.5, 5.5, { damageOnTouch: { hurts: 'enemies', knockback: 0 } }));
    const r = rig(scene);
    r.run(2);
    expect(healthOf(r.get('p'))!.hp).toBe(3);
    expect(healthOf(r.get('g'))!.hp).toBe(1);
  });

  it('respawns the player at the start with full health, or removes an enemy, or leaves it down', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(5.5, 5.5), enemy('gone', 12.5, 12.5), enemy('down', 14.5, 12.5, { health: { max: 1, onDeath: 'stay' } }));
    const r = rig(scene);
    r.run(2);
    // walk away, then take three hits
    r.run(30, GRID_PLUS_X);
    expect(pos(r, 'p').x).toBeGreaterThan(7);
    for (let i = 0; i < 3; i++) damage(ctxOf(r), r.get('p'), 1, { ignoreIframes: true });
    expect(healthOf(r.get('p'))!.hp).toBe(0);
    r.run(2);
    expect(healthOf(r.get('p'))!.hp).toBe(3);
    expect(pos(r, 'p').x).toBeCloseTo(5.5, 1);
    // enemy that removes itself
    damage(ctxOf(r), r.get('gone'), 5, {});
    r.run(2);
    expect(r.sim.world.get(r.get('gone').id)).toBeUndefined();
    // enemy that stays down
    damage(ctxOf(r), r.get('down'), 5, {});
    r.run(2);
    expect(r.sim.world.get(r.get('down').id)).toBeDefined();
    expect(healthOf(r.get('down'))!.dead).toBe(true);
    expect(output(r.get('down'), 'dead')).toBe(true);
  });

  it('losing health to a fall: damage, then back to solid ground', () => {
    const { map, scene } = flatScene();
    for (let x = 9; x < 15; x++) map.setFlag(x, 5, FLAG.PIT);
    scene.map = tileMapToRows(map);
    scene.entities.push(hero(5.5, 5.5));
    const r = rig(scene);
    r.run(100, GRID_PLUS_X); // walk into the pit once
    expect(healthOf(r.get('p'))!.hp).toBeLessThan(3);
    const p = pos(r, 'p');
    expect(p.x).toBeLessThan(9.2); // put back before the pit
    expect((r.get('p').get(C.Body) as Body).state).toBe('ground');
  });

  it('inputs heal and kill', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(5.5, 5.5, {}), thing('x', 'X', 14.5, 14.5, {}));
    const r = rig(scene);
    damage(ctxOf(r), r.get('p'), 2, { ignoreIframes: true });
    expect(healthOf(r.get('p'))!.hp).toBe(1);
    setInput(r.get('p'), 'heal', true);
    r.run(2);
    expect(healthOf(r.get('p'))!.hp).toBe(3);
  });
});

function ctxOf(r: Rig): Parameters<typeof damage>[0] {
  return { world: r.sim.world, events: r.sim.events, runtime: r.sim.runtime, input: r.sim.input, uiInput: r.sim.uiInput, modal: 'none' as const, rng: r.sim.rng, tweens: r.sim.tweens, assets: r.sim.assets, map: r.sim.map, dt: 1 / 60, tick: r.sim.tick, compat: r.sim.compat };
}

describe('melee attack and dodge', () => {
  const faceEast = (e: EntityData, tx: number, ty: number): void => {
    const t = e.components.transform as TransformIso;
    t.facing = facingOfGridDir(tx - t.x, ty - t.y);
  };

  it('a swing hurts what is in front, once, and not what is behind', () => {
    const { scene } = flatScene();
    const p = hero(5.5, 5.5, { meleeAttack: { damage: 1, range: 1.5, windup: 0.05, active: 0.2, cooldown: 0.2 } });
    faceEast(p, 7.5, 5.5);
    scene.entities.push(p, enemy('front', 6.6, 5.5, { health: { max: 3, onDeath: 'remove', invulnerableSeconds: 0 } }), enemy('behind', 4.2, 5.5, { health: { max: 3, onDeath: 'remove' } }));
    const r = rig(scene);
    r.run(2);
    r.run(1, { attack: 1 });
    r.run(1);
    r.run(30);
    expect(healthOf(r.get('front'))!.hp).toBe(2); // one hit per swing even though the swing lasts several ticks
    expect(healthOf(r.get('behind'))!.hp).toBe(3);
  });

  it('shows a swing and removes it again; recovery limits spamming', () => {
    const { scene } = flatScene();
    const p = hero(5.5, 5.5, { meleeAttack: { windup: 0, active: 0.1, cooldown: 0.5 } });
    scene.entities.push(p);
    const r = rig(scene);
    r.run(1, { attack: 1 });
    expect(r.sim.world.withTag('effect')).toHaveLength(1);
    r.run(20);
    expect(r.sim.world.withTag('effect')).toHaveLength(0);
    // pressing attack again during recovery does nothing; later it works
    r.run(1, { attack: 1 });
    r.run(1);
    expect(r.sim.world.withTag('effect')).toHaveLength(0);
    r.run(40);
    r.run(1, { attack: 1 });
    expect(r.sim.world.withTag('effect')).toHaveLength(1);
  });

  it('swingHits respects range and arc', () => {
    const me: TransformIso = { x: 5.5, y: 5.5, h: 0, facing: facingOfGridDir(1, 0) };
    expect(swingHits(me, 6.8, 5.5, 0.3, 1.4, 120)).toBe(true);
    expect(swingHits(me, 4.2, 5.5, 0.3, 1.4, 120)).toBe(false);
    expect(swingHits(me, 8.5, 5.5, 0.3, 1.4, 120)).toBe(false);
    expect(swingHits(me, 4.2, 5.5, 0.3, 1.4, 360)).toBe(true);
  });

  it('dodging moves quickly and cannot be hurt, then needs to cool down', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(5.5, 5.5, { dodge: { speed: 10, seconds: 0.2, cooldown: 0.5 } }), thing('spike', 'Spike', 5.5, 5.5, { damageOnTouch: { knockback: 0 } }));
    const r = rig(scene);
    r.run(1, { dodge: 1, ...GRID_PLUS_X });
    r.run(1);
    expect(healthOf(r.get('p'))!.hp).toBe(3); // untouchable while dodging, even on a spike
    r.run(8, GRID_PLUS_X);
    expect(pos(r, 'p').x).toBeGreaterThan(7); // it covered ground fast
    const after = pos(r, 'p').x;
    r.run(1, { dodge: 1, ...GRID_PLUS_X });
    r.run(3, GRID_PLUS_X);
    expect(pos(r, 'p').x - after).toBeLessThan(1); // still cooling down: only walking speed
  });
});

describe('patrol and navigation', () => {
  it('parses and formats routes', () => {
    expect(parsePoints('4.5,5.5; 10.5, 5.5;bad; 3,2')).toEqual([{ x: 4.5, y: 5.5 }, { x: 10.5, y: 5.5 }, { x: 3, y: 2 }]);
    expect(formatPoints([{ x: 1, y: 2 }, { x: 3.5, y: 4 }])).toBe('1,2; 3.5,4');
    expect(parsePoints('')).toEqual([]);
  });

  it('walks between its points, pausing at each, in a loop', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 20.5, 20.5), enemy('g', 4.5, 5.5, { patrol: { points: '4.5,5.5; 9.5,5.5', speed: 3, waitSeconds: 0.3 } }));
    const r = rig(scene);
    const xs: number[] = [];
    for (let i = 0; i < 400; i++) {
      r.run(1);
      xs.push(pos(r, 'g').x);
    }
    expect(Math.max(...xs)).toBeGreaterThan(9.3);
    expect(Math.min(...xs.slice(120))).toBeLessThan(5.2); // came back
    expect(xs.some((x, i) => i > 0 && x === xs[i - 1])).toBe(true); // waits at the ends
  });

  it('goes around a wall to reach the next point (A*)', () => {
    const { map, scene } = flatScene();
    for (let y = 0; y < 9; y++) map.setFlag(8, y, FLAG.BLOCK);
    scene.map = tileMapToRows(map);
    scene.entities.push(player('p', 20.5, 20.5), enemy('g', 5.5, 3.5, { patrol: { points: '5.5,3.5; 11.5,3.5', speed: 4, waitSeconds: 0 } }));
    const r = rig(scene);
    let maxY = 0;
    let reached = false;
    for (let i = 0; i < 700 && !reached; i++) {
      r.run(1);
      maxY = Math.max(maxY, pos(r, 'g').y);
      reached = pos(r, 'g').x > 10.8;
    }
    expect(reached).toBe(true);
    expect(maxY).toBeGreaterThan(9); // it detoured round the end of the wall
  });

  it('patrols around crates in the way', () => {
    const { scene } = flatScene();
    scene.entities.push(
      player('p', 20.5, 20.5),
      enemy('g', 5.5, 5.5, { patrol: { points: '5.5,5.5; 11.5,5.5', speed: 4, waitSeconds: 0 } }),
      thing('crate', 'Crate', 8.5, 5.5, {}, { collider: { w: 0.9, d: 0.9, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } }),
    );
    const r = rig(scene);
    let maxX = 0;
    for (let i = 0; i < 400; i++) {
      r.run(1);
      maxX = Math.max(maxX, pos(r, 'g').x);
    }
    expect(maxX).toBeGreaterThan(10);
  });
});

describe('vision', () => {
  const facing = (x: number, y: number, tx: number, ty: number): number => facingOfGridDir(tx - x, ty - y);

  function sees(opts: { guard?: Record<string, object>; playerAt?: [number, number]; setup?: (s: ReturnType<typeof flatScene>) => void; guardFacing?: [number, number] }): VisionState {
    const fs = flatScene();
    const pAt = opts.playerAt ?? [9.5, 5.5];
    const g = enemy('g', 5.5, 5.5, { vision: { range: 7, angle: 90, hearing: 0, ...(opts.guard?.vision ?? {}) } });
    (g.components.transform as TransformIso).facing = facing(5.5, 5.5, ...(opts.guardFacing ?? [9.5, 5.5]));
    fs.scene.entities.push(player('p', pAt[0], pAt[1]), g);
    opts.setup?.(fs);
    const r = rig(fs.scene);
    r.run(3);
    return r.get('g').get<VisionState>('state:vision')!;
  }

  it('sees a target in front, within range', () => {
    expect(sees({}).seen).not.toBeNull();
    expect(sees({ playerAt: [15.5, 5.5] }).seen).toBeNull(); // too far
  });

  it('does not see behind or outside the cone', () => {
    expect(sees({ playerAt: [1.5, 5.5] }).seen).toBeNull();
    expect(sees({ playerAt: [5.5, 9.5] }).seen).toBeNull(); // 90 degrees off
    expect(sees({ playerAt: [5.5, 9.5], guard: { vision: { angle: 270 } } }).seen).not.toBeNull();
  });

  it('walls block the view', () => {
    const v = sees({
      setup: ({ map, scene }) => {
        map.setFlag(7, 5, FLAG.BLOCK);
        scene.map = tileMapToRows(map);
      },
    });
    expect(v.seen).toBeNull();
  });

  it('cannot see far into the dark but sees close up, and light helps', () => {
    const dark: RegionData = { id: 'r', name: 'Dark', x: 0, y: 0, w: 24, h: 24, cameraBounds: false, music: '', darkness: 0.95, bossActive: false };
    const inDark = (at: [number, number], withLamp = false): VisionState =>
      sees({
        playerAt: at,
        setup: ({ scene }) => {
          scene.regions.push(dark);
          if (withLamp) scene.entities.push(thing('lamp', 'Lamp', at[0] - 0.5, at[1], { light: { flicker: 0, radius: 4 } }));
        },
      });
    expect(inDark([9.5, 5.5]).seen).toBeNull();
    expect(inDark([6.5, 5.5]).seen).not.toBeNull(); // within close range
    expect(inDark([9.5, 5.5], true).seen).not.toBeNull(); // the lamp lights the player up
  });

  it('hears footsteps behind it but not standing still', () => {
    const fs = flatScene();
    const g = enemy('g', 5.5, 5.5, { vision: { range: 7, angle: 60, hearing: 4 } });
    (g.components.transform as TransformIso).facing = facing(5.5, 5.5, 9.5, 5.5);
    fs.scene.entities.push(player('p', 3.5, 5.5), g);
    const r = rig(fs.scene);
    r.run(3);
    expect(r.get('g').get<VisionState>('state:vision')!.heard).toBe(false);
    r.run(3, { move_left: 1, move_up: 1 }); // walking about behind the guard
    expect(r.get('g').get<VisionState>('state:vision')!.heard).toBe(true);
    expect(output(r.get('g'), 'heard')).toBe(true);
  });
});

describe('chase', () => {
  function guardScene(extra?: (s: ReturnType<typeof flatScene>) => void) {
    const fs = flatScene();
    const g = enemy('g', 5.5, 5.5, { chase: { speed: 3.5, searchSeconds: 1, stopDistance: 0.8 }, patrol: { points: '5.5,5.5; 5.5,6.5', speed: 1, waitSeconds: 5 } });
    (g.components.transform as TransformIso).facing = facingOfGridDir(1, 0);
    fs.scene.entities.push(player('p', 10.5, 5.5), g);
    extra?.(fs);
    return fs.scene;
  }
  const mode = (r: Rig): string => (r.get('g').get('state:chase') as { mode: string }).mode;

  it('notices the player, chases, stops near, searches, then goes home', () => {
    const r = rig(guardScene());
    r.run(3);
    expect(mode(r)).toBe('chase');
    r.run(120);
    expect(pos(r, 'g').x).toBeGreaterThan(8.5); // closed in
    expect(pos(r, 'g').x).toBeLessThan(10.5);
    expect(output(r.get('g'), 'chasing')).toBe(true);
    // the player vanishes behind the guard's back: out of sight and out of earshot
    const p = r.get('p').get<TransformIso>(C.Transform)!;
    p.x = 1.5;
    p.y = 20.5;
    r.run(240);
    expect(mode(r)).toBe('idle'); // gave up and went home
    expect(Math.hypot(pos(r, 'g').x - 5.5, pos(r, 'g').y - 5.5)).toBeLessThan(1.2);
  });

  it('goes around a wall to reach a player it can only hear', () => {
    const { map, scene } = flatScene();
    for (let y = 0; y < 9; y++) map.setFlag(8, y, FLAG.BLOCK);
    scene.map = tileMapToRows(map);
    const g = enemy('g', 5.5, 3.5, { chase: { speed: 4, stopDistance: 0.8 }, vision: { range: 3, angle: 60, hearing: 12 } });
    scene.entities.push(player('p', 9.5, 3.5), g);
    const r = rig(scene);
    let maxY = 0;
    for (let i = 0; i < 700; i++) {
      r.run(1, GRID_MINUS_X); // the player keeps pushing against the far side of the wall: footsteps the guard can hear
      maxY = Math.max(maxY, pos(r, 'g').y);
    }
    expect(maxY).toBeGreaterThan(8.5); // it went round the end of the wall
    expect(Math.hypot(pos(r, 'g').x - pos(r, 'p').x, pos(r, 'g').y - pos(r, 'p').y)).toBeLessThan(1.6);
  });
  it('a guard that chases and touches hurts the player', () => {
    const r = rig(
      guardScene(({ scene }) => {
        const g = scene.entities.find((e) => e.id === 'g')!;
        attachBehavior(g.components, 'damageOnTouch');
        const ph = scene.entities.find((e) => e.id === 'p')!;
        attachBehavior(ph.components, 'health');
      }),
    );
    r.run(240);
    expect(healthOf(r.get('p'))!.hp).toBeLessThan(3);
  });

  it('does nothing while switched off (dead or in another room)', () => {
    const r = rig(guardScene());
    r.run(2);
    aiFlags(r.get('g')).disabled = true;
    r.run(2);
    const frozen = pos(r, 'g');
    r.run(60);
    expect(mode(r)).toBe('idle');
    expect(pos(r, 'g').x).toBeCloseTo(frozen.x, 2);
  });
});

describe('boss phases', () => {
  const prefab: PrefabData = {
    schemaVersion: 1,
    name: 'Minion',
    root: { name: 'Minion', tags: ['minion'], components: { transform: { x: 0, y: 0, h: 0, facing: 2 }, sprite: { shape: 'box', color: 0xaa3333, w: 0.5, d: 0.5, height: 0.8, sortOffset: 0, visible: true } }, children: [] },
  };
  const room: RegionData = { id: 'arena', name: 'Arena', x: 10, y: 10, w: 10, h: 10, cameraBounds: false, music: '', darkness: 0, bossActive: true };

  function bossScene(playerAt: [number, number]) {
    const { scene } = flatScene();
    scene.regions.push(room);
    scene.entities.push(
      player('p', playerAt[0], playerAt[1]),
      enemy('boss', 14.5, 14.5, { bossPhases: { phase2At: 60, phase3At: 25, speedUp: 1.5, damageUp: 2, summonPrefab: 'Minion', summonCount: 2 }, health: { max: 10, onDeath: 'stay', invulnerableSeconds: 0 }, damageOnTouch: { amount: 1 } }),
    );
    return scene;
  }

  it('gets angrier as health falls, calls helpers, and signals each phase', () => {
    const r = rig(bossScene([12.5, 12.5]));
    r.sim.assets.prefabs.set('Minion', prefab);
    r.run(3);
    const boss = r.get('boss');
    expect(output(boss, 'phase2')).toBe(false);
    damage(ctxOf(r), boss, 4, {}); // 6/10 = 60%
    r.run(2);
    expect(output(boss, 'phase2')).toBe(true);
    expect(output(boss, 'phase3')).toBe(false);
    expect(aiFlags(boss).speedScale).toBeCloseTo(1.5, 5);
    expect(aiFlags(boss).damageScale).toBeCloseTo(2, 5);
    expect(r.sim.world.withTag('minion')).toHaveLength(2);
    damage(ctxOf(r), boss, 4, {}); // 2/10
    r.run(2);
    expect(output(boss, 'phase3')).toBe(true);
    expect(aiFlags(boss).speedScale).toBeCloseTo(2.25, 5);
    expect(r.sim.world.withTag('minion')).toHaveLength(4);
  });

  it('a phase-2 boss hits harder', () => {
    const scene = bossScene([14.5, 14.5]);
    const p = scene.entities.find((e) => e.id === 'p')!;
    attachBehavior(p.components, 'health');
    Object.assign(p.components.health as object, { max: 20, invulnerableSeconds: 1 });
    const r = rig(scene);
    r.sim.assets.prefabs.set('Minion', prefab);
    r.run(2);
    expect(healthOf(r.get('p'))!.hp).toBe(19); // phase 1: one damage
    damage(ctxOf(r), r.get('boss'), 4, {});
    r.run(70); // phase 2 starts, the player's invulnerability ends, the next hit lands
    expect(healthOf(r.get('p'))!.hp).toBe(17); // hit for 2, not 1: phase 2 doubles damage
  });
  it('only fights while the player is in its room', () => {
    const r = rig(bossScene([2.5, 2.5]));
    r.sim.assets.prefabs.set('Minion', prefab);
    r.run(3);
    expect(output(r.get('boss'), 'active')).toBe(false);
    expect(aiFlags(r.get('boss')).disabled).toBe(true);
    const p = r.get('p').get<TransformIso>(C.Transform)!;
    p.x = 12.5;
    p.y = 12.5;
    r.run(3);
    expect(output(r.get('boss'), 'active')).toBe(true);
    expect(aiFlags(r.get('boss')).disabled).toBe(false);
  });

  it('stays down and keeps its Defeated signal on', () => {
    const r = rig(bossScene([12.5, 12.5]));
    r.sim.assets.prefabs.set('Minion', prefab);
    r.run(3);
    damage(ctxOf(r), r.get('boss'), 99, {});
    r.run(3);
    expect(r.sim.world.get(r.get('boss').id)).toBeDefined();
    expect(output(r.get('boss'), 'defeated')).toBe(true);
    expect(output(r.get('boss'), 'active')).toBe(false);
    r.run(200);
    expect(output(r.get('boss'), 'defeated')).toBe(true);
  });
});

describe('echoes with health', () => {
  it('echoes do not take damage (they have no Health) and are not hurt-by-touch targets', () => {
    const { scene } = flatScene();
    const p = hero(5.5, 5.5);
    attachBehavior(p.components, 'echoRecorder');
    scene.entities.push(p, thing('spike', 'Spike', 9.5, 5.5, { damageOnTouch: { hurts: 'anything', knockback: 0 } }));
    const r = rig(scene);
    r.run(1, { echo: 1 });
    r.run(1);
    r.run(60, GRID_PLUS_X);
    r.run(1, { echo: 1 });
    r.run(100, GRID_MINUS_X);
    expect(r.sim.world.withTag('echo')).toHaveLength(1);
    expect(r.sim.world.withTag('echo')[0]!.has('health')).toBe(false);
  });
});

describe('event sheet and combat', () => {
  const cond = (type: string, params: Record<string, unknown> = {}) => ({ ...newCondition(type), params: { ...newCondition(type).params, ...params } });
  const act = (type: string, params: Record<string, unknown> = {}) => ({ ...newAction(type), params: { ...newAction(type).params, ...params } });

  it('"health compares" and "hurt an object" work from an event row', () => {
    const { scene } = flatScene();
    scene.variables.push({ name: 'low', value: 0 });
    scene.entities.push(hero(5.5, 5.5));
    scene.events = [
      { ...newRow('hurt'), conditions: [cond('start')], actions: [act('damage', { who: 'player', amount: 2 })] },
      { ...newRow('warn'), conditions: [cond('health', { who: 'player', op: '<=', value: 1 })], actions: [act('setVariable', { name: 'low', op: 'set', value: '1' })] },
    ];
    const r = rig(scene);
    r.run(4);
    expect(healthOf(r.get('p'))!.hp).toBe(1);
    expect(r.sim.runtime.vars.low).toBe(1);
  });

  it('can react to combat events and heal', () => {
    const { scene } = flatScene();
    scene.variables.push({ name: 'phases', value: 0 });
    scene.entities.push(hero(5.5, 5.5));
    scene.events = [
      { ...newRow('h'), conditions: [cond('start')], actions: [act('damage', { who: 'player', amount: 2 })] },
      { ...newRow('heal'), conditions: [cond('onEvent', { name: 'damaged' })], actions: [act('heal', { who: 'player', amount: 1 })] },
    ];
    const r = rig(scene);
    r.run(4);
    expect(healthOf(r.get('p'))!.hp).toBe(2); // 3 - 2 + 1
  });
});