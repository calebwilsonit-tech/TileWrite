import { describe, expect, it } from 'vitest';
import { FLAG, type Body, type Collider, type Sprite, type TransformIso } from '@tilewright/runtime';
import { behaviorList, getBehavior, attachBehavior, detachBehavior } from './framework';
import { input, output, setInput } from './signals';
import { GRID_PLUS_X, GRID_PLUS_Y, flatScene, player, rig, thing, wire } from './testing';

const pos = (e: { require<T>(n: string): T }): TransformIso => e.require<TransformIso>('transform');
const body = (e: { require<T>(n: string): T }): Body => e.require<Body>('body');
const col = (e: { require<T>(n: string): T }): Collider => e.require<Collider>('collider');
const spr = (e: { require<T>(n: string): T }): Sprite => e.require<Sprite>('sprite');

describe('behaviour registry', () => {
  it('registers the built-in behaviours with plain-English descriptions and fields', () => {
    const ids = behaviorList().map((b) => b.id);
    for (const id of ['pressurePlate', 'lever', 'timer', 'logic', 'gate', 'pushable', 'spawner', 'pickup', 'movingPlatform', 'fallingFloor', 'projectile', 'followCamera', 'triggerZone']) {
      expect(ids, id).toContain(id);
    }
    for (const b of behaviorList()) {
      expect(b.description.length, b.id).toBeGreaterThan(20);
      for (const f of b.fields) expect(f.label.length, `${b.id}.${f.key}`).toBeGreaterThan(2);
      for (const f of b.fields) expect(b.defaults, `${b.id}.${f.key}`).toHaveProperty(f.key);
    }
  });

  it('attaches defaults plus required components, and removes cleanly', () => {
    const comps: Record<string, unknown> = {};
    attachBehavior(comps, 'pressurePlate');
    expect(comps.pressurePlate).toEqual(getBehavior('pressurePlate')!.defaults);
    expect((comps.collider as Collider).trigger).toBe(true);
    (comps.collider as Collider).w = 3;
    attachBehavior(comps, 'pressurePlate'); // idempotent: keeps edits
    expect((comps.collider as Collider).w).toBe(3);
    detachBehavior(comps, 'pressurePlate');
    expect(comps.pressurePlate).toBeUndefined();
    expect(() => attachBehavior(comps, 'nonsense')).toThrow(/no behaviour called/);
  });

  it('copies defaults so attached settings never alias each other', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = {};
    attachBehavior(a, 'gate');
    attachBehavior(b, 'gate');
    (a.gate as { speed: number }).speed = 99;
    expect((b.gate as { speed: number }).speed).toBe(getBehavior('gate')!.defaults.speed);
  });
});

describe('pressure plates', () => {
  it('turns on while the player stands on it and off when they leave', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 4.5, 8.5), thing('plate', 'Plate', 8.5, 8.5, { pressurePlate: {} }));
    const r = rig(scene);
    r.run(5);
    expect(output(r.get('plate'), 'active')).toBe(false);
    r.run(60, GRID_PLUS_X); // walk east and stop on it
    expect(pos(r.get('p')).x).toBeCloseTo(8.5, 1);
    expect(output(r.get('plate'), 'active')).toBe(true);
    r.run(60, GRID_PLUS_X); // keep walking: off the plate
    expect(pos(r.get('p')).x).toBeGreaterThan(11);
    expect(output(r.get('plate'), 'active')).toBe(false);
  });

  it('latches, counts occupants and filters by who stands on it', () => {
    const { scene } = flatScene();
    scene.entities.push(
      player('p', 5.5, 5.5),
      thing('latch', 'Latch', 5.5, 5.5, { pressurePlate: { latch: true } }),
      thing('crateOnly', 'CratePlate', 5.5, 5.5, { pressurePlate: { activatedBy: 'crates' } }),
      thing('two', 'TwoPlate', 5.5, 5.5, { pressurePlate: { needs: 2 } }),
    );
    const r = rig(scene);
    r.run(3);
    expect(output(r.get('latch'), 'active')).toBe(true);
    expect(output(r.get('crateOnly'), 'active')).toBe(false); // the player is not a crate
    expect(output(r.get('two'), 'active')).toBe(false); // one occupant, two needed
    // walk away: the latched one stays on
    r.run(60, GRID_PLUS_X);
    expect(output(r.get('latch'), 'active')).toBe(true);
  });

  it('sinks while pressed', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('plate', 'Plate', 5.5, 5.5, { pressurePlate: { pressedHeight: 0.05 } }, { sprite: { shape: 'box', color: 1, w: 0.9, d: 0.9, height: 0.3, sortOffset: 0, visible: true } }));
    const r = rig(scene);
    r.run(3);
    expect(spr(r.get('plate')).height).toBe(0.05);
    r.run(60, GRID_PLUS_X);
    expect(spr(r.get('plate')).height).toBe(0.3);
  });
});

describe('wires, gates and logic', () => {
  it('opens a gate while a wired plate is held, and closes it again', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('plate', 'Plate', 5.5, 5.5, { pressurePlate: {} }), thing('gate', 'Gate', 12.5, 5.5, { gate: { speed: 0.2 } }));
    scene.wires.push(wire('w1', ['plate', 'active'], ['gate', 'open']));
    const r = rig(scene);
    r.run(30);
    expect(input(r.get('gate'), 'open')).toBe(true);
    expect(col(r.get('gate')).enabled).toBe(false);
    expect(spr(r.get('gate')).height).toBeLessThan(0.2);
    r.run(60, GRID_PLUS_X); // step off
    r.run(30);
    expect(col(r.get('gate')).enabled).toBe(true);
    expect(col(r.get('gate')).height).toBeGreaterThan(1.5);
  });

  it('opens gradually, not instantly', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('plate', 'Plate', 5.5, 5.5, { pressurePlate: {} }), thing('gate', 'Gate', 12.5, 5.5, { gate: { speed: 1 } }));
    scene.wires.push(wire('w1', ['plate', 'active'], ['gate', 'open']));
    const r = rig(scene);
    r.run(15);
    const mid = col(r.get('gate')).height;
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(1.6);
    expect(col(r.get('gate')).enabled).toBe(true); // not open enough to pass yet
    r.run(60);
    expect(col(r.get('gate')).enabled).toBe(false);
  });

  it('an inverted gate is open while its signal is off', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('g', 'Gate', 5.5, 5.5, { gate: { invert: true, speed: 0.1 } }));
    const r = rig(scene);
    r.run(20);
    expect(col(r.get('g')).enabled).toBe(false);
    setInput(r.get('g'), 'open', true);
    r.run(20);
    expect(col(r.get('g')).enabled).toBe(true);
  });

  it('echoes can pass a gate that allows ghosts', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('g', 'Gate', 5.5, 5.5, { gate: { ghostsPass: true } }), thing('g2', 'Gate2', 8.5, 5.5, { gate: { ghostsPass: false } }));
    const r = rig(scene);
    r.run(2);
    expect(col(r.get('g')).mask & 8).toBe(0);
    expect(col(r.get('g2')).mask & 8).toBe(8);
  });

  it('combines signals with AND, OR, NOT, XOR, NAND, NOR', () => {
    const table: [string, [boolean, boolean], boolean][] = [
      ['and', [true, true], true],
      ['and', [true, false], false],
      ['or', [false, true], true],
      ['or', [false, false], false],
      ['xor', [true, true], false],
      ['xor', [true, false], true],
      ['nand', [true, true], false],
      ['nand', [false, true], true],
      ['nor', [false, false], true],
      ['nor', [true, false], false],
    ];
    for (const [kind, [a, b], expected] of table) {
      const { scene } = flatScene();
      scene.entities.push(thing('n', 'N', 5.5, 5.5, { logic: { kind } }));
      const r = rig(scene);
      setInput(r.get('n'), 'a', a);
      setInput(r.get('n'), 'b', b);
      r.run(2);
      expect(output(r.get('n'), 'out'), `${kind}(${a},${b})`).toBe(expected);
    }
    const { scene } = flatScene();
    scene.entities.push(thing('n', 'N', 5.5, 5.5, { logic: { kind: 'not' } }));
    const r = rig(scene);
    r.run(2);
    expect(output(r.get('n'), 'out')).toBe(true);
    setInput(r.get('n'), 'in', true);
    r.run(2);
    expect(output(r.get('n'), 'out')).toBe(false);
  });

  it('chains plate -> AND -> gate: both plates are needed', () => {
    const { scene } = flatScene();
    scene.entities.push(
      player('p', 5.5, 5.5),
      thing('crate', 'Crate', 9.5, 5.5, {}, { collider: { w: 0.9, d: 0.9, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } }),
      thing('p1', 'Plate 1', 5.5, 5.5, { pressurePlate: {} }),
      thing('p2', 'Plate 2', 9.5, 5.5, { pressurePlate: {} }),
      thing('and', 'AND', 7.5, 9.5, { logic: { kind: 'and' } }),
      thing('gate', 'Gate', 12.5, 5.5, { gate: { speed: 0.1 } }),
    );
    scene.wires.push(wire('a', ['p1', 'active'], ['and', 'a']), wire('b', ['p2', 'active'], ['and', 'b']), wire('c', ['and', 'out'], ['gate', 'open']));
    const r = rig(scene);
    r.run(20);
    expect(output(r.get('p1'), 'active')).toBe(true);
    expect(output(r.get('p2'), 'active')).toBe(true); // the crate sits on the second plate
    expect(col(r.get('gate')).enabled).toBe(false); // both pressed: open
    r.run(60, GRID_PLUS_X); // the player leaves plate 1
    r.run(20);
    expect(output(r.get('p1'), 'active')).toBe(false);
    expect(col(r.get('gate')).enabled).toBe(true); // closed again
  });

  it('an input is on if ANY wire feeding it is on', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('a', 'A', 1.5, 1.5, { lever: {} }), thing('b', 'B', 3.5, 1.5, { lever: { startOn: true } }), thing('g', 'G', 6.5, 1.5, { gate: {} }));
    scene.wires.push(wire('w1', ['a', 'on'], ['g', 'open']), wire('w2', ['b', 'on'], ['g', 'open']));
    const r = rig(scene);
    r.run(3);
    expect(input(r.get('g'), 'open')).toBe(true);
  });

  it('survives wires to objects that do not exist', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('g', 'G', 6.5, 1.5, { gate: {} }));
    scene.wires.push(wire('w', ['ghost', 'on'], ['g', 'open']), wire('w2', ['g', 'isOpen'], ['nobody', 'open']));
    const r = rig(scene);
    expect(() => r.run(5)).not.toThrow();
  });

  it('a latch remembers; set and reset; reset wins', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('l', 'L', 5.5, 5.5, { logic: { kind: 'latch' } }));
    const r = rig(scene);
    setInput(r.get('l'), 'set', true);
    r.run(2);
    setInput(r.get('l'), 'set', false);
    r.run(5);
    expect(output(r.get('l'), 'out')).toBe(true);
    setInput(r.get('l'), 'set', true);
    setInput(r.get('l'), 'reset', true);
    r.run(2);
    expect(output(r.get('l'), 'out')).toBe(false);
  });

  it('a toggle flips on each rising edge, only once per press', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('t', 'T', 5.5, 5.5, { logic: { kind: 'toggle' } }));
    const r = rig(scene);
    const press = (): void => {
      setInput(r.get('t'), 'in', true);
      r.run(10);
      setInput(r.get('t'), 'in', false);
      r.run(10);
    };
    press();
    expect(output(r.get('t'), 'out')).toBe(true);
    press();
    expect(output(r.get('t'), 'out')).toBe(false);
    press();
    expect(output(r.get('t'), 'out')).toBe(true);
  });

  it('a delay repeats its input later, and a pulse is on for a while', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('d', 'D', 5.5, 5.5, { logic: { kind: 'delay', seconds: 0.5 } }), thing('p', 'P', 7.5, 5.5, { logic: { kind: 'pulse', seconds: 0.5 } }));
    const r = rig(scene);
    setInput(r.get('d'), 'in', true);
    setInput(r.get('p'), 'in', true);
    r.run(15);
    expect(output(r.get('d'), 'out')).toBe(false); // not yet
    expect(output(r.get('p'), 'out')).toBe(true);
    r.run(30);
    expect(output(r.get('d'), 'out')).toBe(true); // now
    expect(output(r.get('p'), 'out')).toBe(false); // the pulse is over though the input stays on
    setInput(r.get('d'), 'in', false);
    r.run(40);
    expect(output(r.get('d'), 'out')).toBe(false);
  });
});

describe('lever and timer', () => {
  it('flips a lever with the interact button, only when close', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('lv', 'Lever', 6.2, 5.5, { lever: {} }), thing('far', 'Far', 15.5, 15.5, { lever: {} }));
    const r = rig(scene);
    r.run(2);
    r.run(1, { interact: 1 });
    r.run(2);
    expect(output(r.get('lv'), 'on')).toBe(true);
    expect(output(r.get('far'), 'on')).toBe(false); // too far away
    r.run(1, { interact: 1 });
    r.run(2);
    expect(output(r.get('lv'), 'on')).toBe(false); // flipped back
    r.run(30, { interact: 1 }); // holding it down only flips it once
    expect(output(r.get('lv'), 'on')).toBe(true);
  });

  it('a momentary lever is on only while held', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('lv', 'Lever', 6.2, 5.5, { lever: { momentary: true } }));
    const r = rig(scene);
    r.run(5, { interact: 1 });
    expect(output(r.get('lv'), 'on')).toBe(true);
    r.run(5);
    expect(output(r.get('lv'), 'on')).toBe(false);
  });

  it('a timer runs for its time after being started, then pulses done', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('t', 'Timer', 5.5, 5.5, { timer: { seconds: 1 } }));
    const r = rig(scene);
    r.run(5);
    expect(output(r.get('t'), 'running')).toBe(false);
    setInput(r.get('t'), 'start', true);
    r.run(30);
    expect(output(r.get('t'), 'running')).toBe(true);
    let doneTicks = 0;
    for (let i = 0; i < 60; i++) {
      r.run(1);
      if (output(r.get('t'), 'done')) doneTicks++;
    }
    expect(doneTicks).toBe(1);
    expect(output(r.get('t'), 'running')).toBe(false);
  });

  it('a timer can start by itself and repeat', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('t', 'Timer', 5.5, 5.5, { timer: { seconds: 0.5, autoStart: true, loop: true } }));
    const r = rig(scene);
    let done = 0;
    for (let i = 0; i < 125; i++) {
      r.run(1);
      if (output(r.get('t'), 'done')) done++;
    }
    expect(done).toBe(4);
  });
});

describe('pushable crates', () => {
  const crate = (id: string, x: number, y: number) =>
    thing(id, 'Crate', x, y, { pushable: {} }, { collider: { w: 0.9, d: 0.9, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } });

  it('slides one cell when the player walks into it', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 8.5), crate('c', 7.5, 8.5));
    const r = rig(scene);
    r.run(80, GRID_PLUS_X);
    r.run(40); // let the slide finish
    const c = pos(r.get('c'));
    expect(c.x).toBeGreaterThan(8);
    expect(c.y).toBeCloseTo(8.5, 5);
    expect(c.x % 1).toBeCloseTo(0.5, 5); // always lands on a cell centre
    expect(pos(r.get('p')).x).toBeGreaterThan(7); // the player followed it
  });

  it('keeps pushing while the player keeps walking, one cell at a time', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 3.5, 8.5), crate('c', 5.5, 8.5));
    const r = rig(scene);
    r.run(200, GRID_PLUS_X);
    expect(pos(r.get('c')).x).toBeGreaterThan(9.5);
  });

  it('does not move into a wall, another crate, or a pit', () => {
    const wall = flatScene();
    wall.map.set(9, 8, 5, 3);
    wall.scene.map = { ...wall.scene.map, tiles: wall.scene.map.tiles.map((r, y) => r.map((v, x) => (x === 9 && y === 8 ? 5 : v))), heights: wall.scene.map.heights.map((r, y) => r.map((v, x) => (x === 9 && y === 8 ? 3 : v))) };
    wall.scene.entities.push(player('p', 5.5, 8.5), crate('c', 8.5, 8.5));
    const r1 = rig(wall.scene);
    r1.run(120, GRID_PLUS_X);
    expect(pos(r1.get('c')).x).toBeCloseTo(8.5, 5);

    const two = flatScene();
    two.scene.entities.push(player('p', 5.5, 8.5), crate('c', 7.5, 8.5), crate('d', 8.5, 8.5));
    const r2 = rig(two.scene);
    r2.run(120, GRID_PLUS_X);
    expect(pos(r2.get('c')).x).toBeCloseTo(7.5, 5);

    const pit = flatScene();
    pit.scene.map = { ...pit.scene.map, flags: pit.scene.map.flags.map((r, y) => r.map((v, x) => (x === 9 && y === 8 ? FLAG.PIT : v))) };
    pit.scene.entities.push(player('p', 5.5, 8.5), crate('c', 8.5, 8.5));
    const r3 = rig(pit.scene);
    r3.run(120, GRID_PLUS_X);
    expect(pos(r3.get('c')).x).toBeCloseTo(8.5, 5);
  });

  it('can be pushed onto a plate, which holds the plate down', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 8.5), crate('c', 7.5, 8.5), thing('plate', 'Plate', 8.5, 8.5, { pressurePlate: { activatedBy: 'crates' } }));
    const r = rig(scene);
    r.run(26, GRID_PLUS_X); // one push
    r.run(40);
    expect(pos(r.get('c')).x).toBeCloseTo(8.5, 1);
    r.run(30, GRID_PLUS_Y); // walk away; the crate stays
    expect(output(r.get('plate'), 'active')).toBe(true);
  });

  it('cannot be pushed into the player', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 8.5), crate('c', 6.5, 8.5), { ...thing('npc', 'NPC', 7.5, 8.5, {}), components: { ...thing('npc', 'NPC', 7.5, 8.5, {}).components, body: player('x', 0, 0).components.body } });
    const r = rig(scene);
    r.run(60, GRID_PLUS_X);
    expect(pos(r.get('c')).x).toBeCloseTo(6.5, 5);
  });
});

describe('world behaviours', () => {
  it('a pickup adds to a counter, shows its message and disappears', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('coin', 'Coin', 6.5, 5.5, { pickup: { variable: 'coins', amount: 3, message: 'Shiny!' } }));
    const r = rig(scene);
    const msgs: unknown[] = [];
    r.sim.events.on('message', (e) => msgs.push(e.text));
    r.run(60, GRID_PLUS_X);
    expect(r.sim.runtime.vars.coins).toBe(3);
    expect(msgs).toEqual(['Shiny!']);
    expect(r.sim.world.get(r.get('coin').id)).toBeUndefined();
  });

  it('a moving platform travels back and forth and carries a rider', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('mp', 'Platform', 5.5, 5.5, { movingPlatform: { dx: 6, dy: 0, dh: 0, speed: 2, pause: 0 } }, { collider: { w: 2, d: 2, height: 0.3, solid: true, trigger: false, layer: 1, mask: 65535, enabled: true, inside: [] } }));
    const r = rig(scene);
    r.run(5);
    expect(body(r.get('p')).standingOn).toBe(r.get('mp').id);
    r.run(85); // 1.5 s in total at 2 cells/s: 3 cells
    expect(pos(r.get('mp')).x).toBeCloseTo(8.5, 1);
    expect(pos(r.get('p')).x).toBeCloseTo(8.5, 1); // carried along
    r.run(120); // reaches the end (6 cells at 2/s = 3 s total), turns around
    r.run(60);
    expect(pos(r.get('mp')).x).toBeLessThan(10.5);
  });

  it('a moving platform that needs a signal waits for it', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('mp', 'Platform', 5.5, 5.5, { movingPlatform: { needsSignal: true, dx: 4, speed: 2 } }));
    const r = rig(scene);
    r.run(30);
    expect(pos(r.get('mp')).x).toBe(5.5);
    setInput(r.get('mp'), 'go', true);
    r.run(30);
    expect(pos(r.get('mp')).x).toBeGreaterThan(6);
  });

  it('a falling floor drops after being stood on, then comes back', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('ff', 'Floor', 5.5, 5.5, { fallingFloor: { delay: 0.3, respawnAfter: 1 } }, { collider: { w: 2, d: 2, height: 0.3, solid: true, trigger: false, layer: 1, mask: 65535, enabled: true, inside: [] } }));
    const r = rig(scene);
    r.run(5);
    expect(col(r.get('ff')).enabled).toBe(true);
    r.run(30);
    expect(col(r.get('ff')).enabled).toBe(false);
    expect(output(r.get('ff'), 'fallen')).toBe(true);
    expect(pos(r.get('p')).h).toBe(0); // dropped to the ground
    r.run(50);
    expect(col(r.get('ff')).enabled).toBe(true); // back (and about to crumble again under the player)
  });

  it('a projectile flies, hits a wall and announces it; or runs out of time', () => {
    const { scene } = flatScene();
    scene.map = { ...scene.map, tiles: scene.map.tiles.map((r, y) => r.map((v, x) => (x === 10 && y === 5 ? 5 : v))), heights: scene.map.heights.map((r, y) => r.map((v, x) => (x === 10 && y === 5 ? 3 : v))) };
    scene.entities.push(thing('pr', 'Bolt', 5.5, 5.5, { projectile: { speed: 6, useFacing: false, dirX: 1, dirY: 0, lifetime: 5 } }), thing('short', 'Short', 5.5, 12.5, { projectile: { speed: 1, useFacing: false, dirX: 1, dirY: 0, lifetime: 0.5 } }));
    const r = rig(scene);
    const hits: unknown[] = [];
    r.sim.events.on('projectile-hit', (e) => hits.push(e.entity));
    r.run(90);
    expect(hits).toEqual([r.get('pr').id]);
    expect(r.sim.world.get(r.get('pr').id)).toBeUndefined();
    expect(r.sim.world.get(r.get('short').id)).toBeUndefined();
  });

  it('a spawner creates prefab copies on its signal and on a timer, up to a maximum', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('sp', 'Spawner', 5.5, 5.5, { spawner: { prefab: 'Orb', everySeconds: 0, onStart: true, max: 2 } }));
    const r = rig(scene);
    r.sim.assets.prefabs.set('Orb', { schemaVersion: 1, name: 'Orb', root: { name: 'Orb', tags: ['orb'], components: { transform: { x: 0, y: 0, h: 0, facing: 2 }, sprite: { shape: 'box', color: 1, w: 0.4, d: 0.4, height: 0.4, sortOffset: 0, visible: true } }, children: [] } });
    r.run(3);
    expect(r.sim.world.withTag('orb')).toHaveLength(1); // onStart
    setInput(r.get('sp'), 'spawn', true);
    r.run(3);
    expect(r.sim.world.withTag('orb')).toHaveLength(2);
    setInput(r.get('sp'), 'spawn', false);
    setInput(r.get('sp'), 'spawn', true);
    r.run(3);
    expect(r.sim.world.withTag('orb')).toHaveLength(2); // max reached
    const orb = r.sim.world.withTag('orb')[0]!;
    expect(pos(orb)).toMatchObject({ x: 5.5, y: 5.5 });
  });

  it('a spawner with a missing prefab reports a problem instead of crashing', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('sp', 'Spawner', 5.5, 5.5, { spawner: { prefab: 'Nope', onStart: true } }));
    const r = rig(scene);
    const problems: string[] = [];
    r.sim.events.on('problem', (e) => problems.push(e.text as string));
    expect(() => r.run(3)).not.toThrow();
    expect(problems[0]).toMatch(/prefab "Nope", which does not exist/);
  });
});

describe('determinism', () => {
  it('a whole puzzle replays exactly from the same inputs', () => {
    const build = () => {
      const { scene } = flatScene();
      scene.entities.push(
        player('p', 5.5, 8.5),
        thing('c', 'Crate', 7.5, 8.5, { pushable: {} }, { collider: { w: 0.9, d: 0.9, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } }),
        thing('plate', 'Plate', 8.5, 8.5, { pressurePlate: {} }),
        thing('gate', 'Gate', 12.5, 8.5, { gate: {} }),
        thing('t', 'Timer', 3.5, 3.5, { timer: { seconds: 0.7, autoStart: true, loop: true } }),
      );
      scene.wires.push(wire('w', ['plate', 'active'], ['gate', 'open']));
      return rig(scene);
    };
    const a = build();
    const b = build();
    for (let i = 0; i < 300; i++) {
      const snap = i < 120 ? GRID_PLUS_X : i < 200 ? GRID_PLUS_Y : {};
      a.sim.step(snap);
      b.sim.step(snap);
    }
    expect(a.sim.stateHash()).toBe(b.sim.stateHash());
  });
});
