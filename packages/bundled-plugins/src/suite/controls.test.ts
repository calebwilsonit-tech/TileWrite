import { describe, expect, it } from 'vitest';
import { C, TableSchema, cameraSnapshot, pictureOf, pointerSnapshot, type TransformIso } from '@tilewright/runtime';
import { ctxOf, flatScene, player, rig, thing, type Rig } from '@tilewright/plugin-sdk/testing';
import { actionDef, setActivePacks } from '@tilewright/behaviors';
import { beginTurns, currentUnit } from '@tilewright/plugin-turns';
import { healthOf } from '@tilewright/plugin-combat';
import { selectedUnits } from '@tilewright/plugin-controls';
import '@tilewright/bundled-plugins';

setActivePacks(undefined);

const walker = (id: string, x: number, y: number, extra: Record<string, object> = {}) => ({ ...thing(id, id, x, y, extra, { body: player('x', 0, 0).components.body }) });
const at = (r: Rig, id: string): { x: number; y: number } => {
  const t = r.get(id).get<TransformIso>(C.Transform)!;
  return { x: t.x, y: t.y };
};
const camera = { x: 0, y: 200, zoom: 1, w: 1280, h: 720 };

/** Hold a pointer state for some ticks (a press lasts one tick; a release is the next). */
function click(r: Rig, cell: { x: number; y: number }, buttons: { primary?: boolean; secondary?: boolean; shift?: boolean } = { primary: true }, ticks = 1, extra: Record<string, number> = {}): void {
  r.run(ticks, { ...cameraSnapshot(camera), ...pointerSnapshot(cell, buttons), ...extra });
  r.run(1, { ...cameraSnapshot(camera), ...pointerSnapshot(cell), ...extra });
}

describe('the pointer', () => {
  it('reaches behaviours as cells, buttons and a camera, and a click is one press', () => {
    const { scene } = flatScene(20, 20);
    scene.entities.push(walker('w', 3.5, 3.5, { clickToMove: { speed: 6 } }));
    const r = rig(scene);
    click(r, { x: 12, y: 6 });
    r.run(150);
    const p = at(r, 'w');
    expect(Math.hypot(p.x - 12.5, p.y - 6.5)).toBeLessThan(0.3);
  });
});

describe('click to move and hotspots', () => {
  it('walks around a wall of crates to the clicked cell, and the marker is drawn while it goes', () => {
    const { scene } = flatScene(20, 20);
    scene.entities.push(walker('w', 3.5, 8.5, { clickToMove: { speed: 6 } }));
    for (let y = 4; y <= 12; y++) scene.entities.push(thing(`c${y}`, 'Crate', 8.5, y + 0.5, {}, { collider: { w: 0.9, d: 0.9, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } }));
    const r = rig(scene);
    click(r, { x: 14, y: 8 });
    r.run(10);
    expect(r.sim.runtime.view.cells.length).toBe(1);
    r.run(400);
    const p = at(r, 'w');
    expect(Math.hypot(p.x - 14.5, p.y - 8.5)).toBeLessThan(0.3);
  });

  it('use a hotspot: walk up to it, then say its words or start a conversation', () => {
    const { scene } = flatScene(20, 20);
    scene.entities.push(walker('w', 3.5, 3.5, { clickToMove: { speed: 6 } }));
    scene.entities.push(thing('h', 'Lamp', 10.5, 10.5, { hotspot: { label: 'Old lamp', look: 'It flickers.', use: 'You pull the chain.', talk: '' } }));
    const r = rig(scene);
    const said: string[] = [];
    r.sim.events.on('message', (e) => said.push(String(e.text)));
    r.sim.runtime.vars.verb = 'look';
    click(r, { x: 10, y: 10 });
    r.run(200);
    expect(said).toEqual(['It flickers.']);
    // it did not stand on the lamp
    expect(Math.hypot(at(r, 'w').x - 10.5, at(r, 'w').y - 10.5)).toBeGreaterThan(0.6);
    r.sim.runtime.vars.verb = 'use';
    click(r, { x: 10, y: 10 });
    r.run(60);
    expect(said).toEqual(['It flickers.', 'You pull the chain.']);
    // hovering names it
    r.run(1, { ...cameraSnapshot(camera), ...pointerSnapshot({ x: 10, y: 10 }) });
    expect(r.sim.runtime.vars['hover.name']).toBe('Old lamp');
    r.run(1, { ...cameraSnapshot(camera), ...pointerSnapshot({ x: 2, y: 2 }) });
    expect(r.sim.runtime.vars['hover.name']).toBe('');
  });
});

describe('the grid cursor (tactics)', () => {
  const unit = (id: string, x: number, y: number, team: string, extra: Record<string, unknown> = {}) =>
    thing(id, id, x, y, { turnTaker: { team, apMax: 4, initiative: team === 'blue' ? 9 : 1, attackRange: 1, attackDamage: 4, attackCost: 2, ...extra }, gridMover: { speed: 12 }, health: { max: 6, onDeath: 'stay' } });

  it('selects your unit, lights up where it can go, and moves and attacks with clicks', () => {
    const { scene } = flatScene(16, 16);
    scene.entities.push(unit('hero', 4.5, 4.5, 'blue'), unit('orc', 7.5, 4.5, 'red'), thing('ctl', 'Controls', 0.5, 0.5, { gridCursor: { team: 'blue' } }));
    scene.events = [];
    const r = rig(scene);
    beginTurns(ctxOf(r));
    r.run(2);
    click(r, { x: 4, y: 4 });
    expect(r.sim.runtime.vars['sel.name']).toBe('hero');
    expect(r.sim.runtime.vars['sel.ap']).toBe(4);
    const tinted = r.sim.runtime.view.cells.filter((c) => c.color === 0x4aa3df).length;
    expect(tinted).toBeGreaterThan(30);
    expect(tinted).toBeLessThanOrEqual(40);
    click(r, { x: 6, y: 4 });
    r.run(60);
    expect(Math.floor(at(r, 'hero').x)).toBe(6);
    // next to the orc: click it
    click(r, { x: 7, y: 4 });
    expect(healthOf(r.get('orc'))!.hp).toBe(2);
    // right click puts the selection away
    click(r, { x: 0, y: 0 }, { secondary: true });
    expect(r.sim.runtime.vars['sel.name']).toBe('');
    expect(currentUnit).toBeDefined();
  });
});

/** The picture rectangle that holds the corners of a block of cells. */
function boxAround(r: Rig, a: { x: number; y: number }, b: { x: number; y: number }, pad = 60): { x0: number; y0: number; x1: number; y1: number } {
  const pts = [pictureOf(camera, 0, r.sim.map, a.x, a.y, 0), pictureOf(camera, 0, r.sim.map, b.x, a.y, 0), pictureOf(camera, 0, r.sim.map, b.x, b.y, 0), pictureOf(camera, 0, r.sim.map, a.x, b.y, 0)];
  return { x0: Math.min(...pts.map((p) => p.x)) - pad, x1: Math.max(...pts.map((p) => p.x)) + pad, y0: Math.min(...pts.map((p) => p.y)) - pad, y1: Math.max(...pts.map((p) => p.y)) + pad };
}

describe('RTS control', () => {
  function army(n: number, team: string, x0: number, y0: number, extra: Record<string, unknown> = {}) {
    return Array.from({ length: n }, (_, i) => walker(`${team}${i}`, x0 + (i % 10) * 0.6, y0 + Math.floor(i / 10) * 0.6, { commandable: { team, speed: 5, aggro: team === 'red' ? 5 : 0, ...extra }, health: { max: 6, onDeath: 'stay' } }));
  }

  it('selects by clicking and by dragging a box, and a right click sends the group there, spread out', () => {
    const { scene } = flatScene(40, 40);
    scene.entities.push(...army(20, 'blue', 5.5, 5.5), thing('ctl', 'Controls', 0.5, 0.5, { rtsControl: { team: 'blue' } }));
    const r = rig(scene);
    // one unit by clicking it
    click(r, { x: 5, y: 5 }, { primary: true });
    expect(r.sim.runtime.vars['rts.selected']).toBe(1);
    // a box around the whole army, in picture pixels
    const bx = boxAround(r, { x: 4, y: 4 }, { x: 12, y: 8 });
    const snap = (down: boolean, x: number, y: number): Record<string, number> => ({ ...cameraSnapshot(camera), ...pointerSnapshot({ x: 6, y: 6 }, { primary: down, screen: { x, y } }) });
    r.run(1, snap(true, bx.x0, bx.y0));
    r.run(2, snap(true, bx.x1, bx.y1));
    r.run(1, snap(false, bx.x1, bx.y1));
    expect(r.sim.runtime.vars['rts.selected']).toBe(20);
    expect(selectedUnits({ world: r.sim.world } as never)).toHaveLength(20);
    // send them to a spot across the map
    click(r, { x: 30, y: 30 }, { secondary: true });
    expect(r.sim.runtime.vars['rts.selected']).toBe(20);
    r.run(900);
    const spots = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const p = at(r, `blue${i}`);
      expect(Math.hypot(p.x - 30.5, p.y - 30.5), `unit ${i}`).toBeLessThan(5);
      spots.add(`${Math.round(p.x * 2)},${Math.round(p.y * 2)}`);
    }
    expect(spots.size).toBeGreaterThan(12); // they stand apart, not on one point
  });

  it('queue orders with shift and stop with S; units fight enemies that come close by themselves', () => {
    const { scene } = flatScene(40, 40);
    scene.entities.push(...army(4, 'blue', 5.5, 5.5, { attackDamage: 6, aggro: 6 }), ...army(2, 'red', 12.5, 6.5, { attackDamage: 1 }), thing('ctl', 'Controls', 0.5, 0.5, { rtsControl: { team: 'blue' } }));
    const r = rig(scene);
    const bx = boxAround(r, { x: 4, y: 4 }, { x: 9, y: 8 }, 80);
    const snap = (down: boolean, x: number, y: number): Record<string, number> => ({ ...cameraSnapshot(camera), ...pointerSnapshot({ x: 6, y: 6 }, { primary: down, screen: { x, y } }) });
    r.run(1, snap(true, bx.x0, bx.y0));
    r.run(2, snap(true, bx.x1, bx.y1));
    r.run(1, snap(false, bx.x1, bx.y1));
    expect(r.sim.runtime.vars['rts.selected']).toBe(4);
    click(r, { x: 8, y: 20 }, { secondary: true });
    click(r, { x: 20, y: 20 }, { secondary: true, shift: true }, 1, { modifier_shift: 1 });
    // it goes to the first place, and then on to the second
    let nearest = Infinity;
    for (let i = 0; i < 700; i++) {
      r.run(1);
      nearest = Math.min(nearest, Math.hypot(at(r, 'blue0').x - 8.5, at(r, 'blue0').y - 20.5));
    }
    expect(nearest).toBeLessThan(1.6);
    expect(Math.hypot(at(r, 'blue0').x - 20.5, at(r, 'blue0').y - 20.5)).toBeLessThan(5);
    // stop
    click(r, { x: 35, y: 35 }, { secondary: true });
    r.run(20);
    r.run(1, { ...cameraSnapshot(camera), rts_stop: 1 });
    const stopped = at(r, 'blue0');
    r.run(60);
    expect(Math.hypot(at(r, 'blue0').x - stopped.x, at(r, 'blue0').y - stopped.y)).toBeLessThan(0.05);
  });

  it('red units on guard attack blue units that wander near, and the blue fight back', () => {
    const { scene } = flatScene(30, 30);
    scene.entities.push(...army(3, 'blue', 10.5, 10.5, { attackDamage: 6, aggro: 6 }), ...army(3, 'red', 14.5, 10.5, { attackDamage: 1, aggro: 6 }));
    const r = rig(scene);
    r.run(400);
    const hp = (id: string): number => healthOf(r.get(id))!.hp;
    expect([hp('red0'), hp('red1'), hp('red2')].every((h) => h === 0)).toBe(true);
    expect(Math.min(hp('blue0'), hp('blue1'), hp('blue2'))).toBeGreaterThan(0);
  });

  it('moves two hundred units with flow fields in a small share of a frame', () => {
    const { scene } = flatScene(64, 64);
    scene.entities.push(...army(200, 'blue', 4.5, 4.5, { aggro: 0 }), thing('ctl', 'Controls', 0.5, 0.5, { rtsControl: { team: 'blue' } }));
    const r = rig(scene);
    for (let i = 0; i < 200; i++) r.get(`blue${i}`).set('state:selected', true);
    click(r, { x: 55, y: 55 }, { secondary: true });
    const t0 = performance.now();
    r.run(300);
    const msPerTick = (performance.now() - t0) / 300;
    expect(msPerTick).toBeLessThan(12); // (about 3 on a quiet machine; the budget for a whole frame is 16.7)
    r.run(1000);
    const arrived = Array.from({ length: 200 }, (_, i) => at(r, `blue${i}`)).filter((p) => Math.hypot(p.x - 55.5, p.y - 55.5) < 9).length;
    expect(arrived).toBeGreaterThan(150);
  });
});

describe('camera rig and builder', () => {
  it('turns the world with the camera buttons, zooms with the wheel, and pans', () => {
    const { scene } = flatScene(30, 30);
    scene.entities.push(thing('rig', 'Rig', 1.5, 1.5, { cameraRig: {} }));
    const r = rig(scene);
    r.run(2, cameraSnapshot(camera));
    expect(r.sim.runtime.view.cameraTarget).toEqual({ x: 15, y: 15 });
    r.run(1, { ...cameraSnapshot(camera), camera_rotate_right: 1 });
    r.run(1, cameraSnapshot(camera));
    expect(r.sim.runtime.view.rotation).toBe(1);
    r.run(1, { ...cameraSnapshot(camera), camera_rotate_left: 1 });
    r.run(1, cameraSnapshot(camera));
    r.run(1, { ...cameraSnapshot(camera), camera_rotate_left: 1 });
    r.run(1, cameraSnapshot(camera));
    expect(r.sim.runtime.view.rotation).toBe(3);
    r.run(1, { ...cameraSnapshot(camera), pointer_wheel_up: 1 });
    r.run(1, cameraSnapshot(camera));
    expect(r.sim.runtime.view.cameraZoom).toBeGreaterThan(1.1);
    // up the screen pans up the screen whichever way the world is turned
    const before = { ...r.sim.runtime.view.cameraTarget! };
    r.run(30, { ...cameraSnapshot(camera), move_up: 1 });
    const after = r.sim.runtime.view.cameraTarget!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(1);
  });

  const buildings = TableSchema.parse({
    name: 'Buildings',
    columns: [{ id: 'name', type: 'text' }, { id: 'prefab', type: 'prefab' }, { id: 'w', type: 'number' }, { id: 'd', type: 'number' }, { id: 'cost', type: 'number' }],
    rows: [
      { id: 'house', name: 'House', prefab: 'House', w: 2, d: 3, cost: 30 },
      { id: 'wall', name: 'Wall', prefab: 'Wall', w: 1, d: 1, cost: 2 },
    ],
  });

  function townRig(): Rig {
    const { scene } = flatScene(30, 30);
    scene.entities.push(thing('b', 'Builder', 1.5, 1.5, { builder: {} }));
    const r = rig(scene);
    r.sim.assets.tables.set('Buildings', buildings);
    const box = (name: string, w: number, d: number) => ({ schemaVersion: 1, name, root: { name, tags: ['building'], children: [], components: { transform: { x: 0, y: 0, h: 0, facing: 2 }, sprite: { shape: 'box', color: 0xaa8855, w, d, height: 1.5, sortOffset: 0, visible: true }, collider: { w: w * 0.95, d: d * 0.95, height: 1.5, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } } } });
    r.sim.assets.prefabs.set('House', box('House', 2, 3) as never);
    r.sim.assets.prefabs.set('Wall', box('Wall', 1, 1) as never);
    r.sim.runtime.vars.gold = 100;
    return r;
  }

  it('shows a ghost footprint (valid or not), turns it, pays for it and places it where it fits', () => {
    const r = townRig();
    r.sim.runtime.vars['build.selected'] = 'house';
    r.run(1, { ...cameraSnapshot(camera), ...pointerSnapshot({ x: 10, y: 10 }) });
    expect(r.sim.runtime.vars['build.valid']).toBe(true);
    expect(r.sim.runtime.view.cells).toHaveLength(6);
    expect(r.sim.runtime.view.cells.every((c) => c.color === 0x5fd38d)).toBe(true);
    // turned a quarter turn the 2 x 3 footprint becomes 3 x 2
    r.run(1, { ...cameraSnapshot(camera), ...pointerSnapshot({ x: 10, y: 10 }), build_rotate: 1 });
    expect(new Set(r.sim.runtime.view.cells.map((c) => c.x)).size).toBe(3);
    // place it
    click(r, { x: 10, y: 10 });
    expect(r.sim.runtime.vars.gold).toBe(70);
    const house = r.sim.world.all().find((e) => e.name === 'House')!;
    expect(house.get('footprint')).toMatchObject({ w: 3, d: 2 });
    expect(house.get<TransformIso>(C.Transform)!.x).toBeCloseTo(10.5, 3); // the footprint hangs from the clicked cell
    // the same spot is now taken, and the ghost turns red with a reason
    r.sim.runtime.vars['build.selected'] = 'house';
    r.run(1, { ...cameraSnapshot(camera), ...pointerSnapshot({ x: 10, y: 10 }) });
    expect(r.sim.runtime.vars['build.valid']).toBe(false);
    expect(r.sim.runtime.vars['build.why']).toBe('Something is already there.');
    expect(r.sim.runtime.view.cells.every((c) => c.color === 0xe0566b)).toBe(true);
    // not enough money
    r.sim.runtime.vars.gold = 5;
    r.run(1, { ...cameraSnapshot(camera), ...pointerSnapshot({ x: 20, y: 20 }) });
    expect(String(r.sim.runtime.vars['build.why'])).toContain('Not enough gold');
    // right click puts the building away
    click(r, { x: 20, y: 20 }, { secondary: true });
    expect(r.sim.runtime.vars['build.selected']).toBe('');
  });

  it('drags walls out one cell at a time, and refuses water and steep ground', () => {
    const r = townRig();
    r.sim.runtime.vars['build.selected'] = 'wall';
    for (let x = 5; x < 9; x++) r.run(1, { ...cameraSnapshot(camera), ...pointerSnapshot({ x, y: 5 }, { primary: true }) });
    r.run(1, { ...cameraSnapshot(camera), ...pointerSnapshot({ x: 9, y: 5 }) });
    expect(r.sim.world.all().filter((e) => e.name === 'Wall')).toHaveLength(4);
    expect(r.sim.runtime.vars.gold).toBe(92);
    r.sim.map!.setFlag(15, 15, 8); // water
    r.sim.runtime.vars['build.selected'] = 'house';
    r.run(1, { ...cameraSnapshot(camera), ...pointerSnapshot({ x: 15, y: 15 }) });
    expect(String(r.sim.runtime.vars['build.why'])).toContain('cannot be built on');
    r.sim.map!.set(20, 20, 1, 2);
    r.run(1, { ...cameraSnapshot(camera), ...pointerSnapshot({ x: 20, y: 20 }) });
    expect(String(r.sim.runtime.vars['build.why'])).toContain('not flat enough');
  });
});

describe('buttons in a list of buildings', () => {
  it('choose the building of their own row, and producers start their resources at zero', () => {
    const { scene } = flatScene(10, 10);
    scene.entities.push(thing('f', 'Farm', 3.5, 3.5, { producer: { makes: 'food:3', uses: 'seed:1', seconds: 4 } }));
    const r = rig(scene);
    r.run(2);
    expect(r.sim.runtime.vars.food).toBe(0);
    expect(r.sim.runtime.vars.seed).toBe(0);
    r.sim.runtime.vars['row.id'] = 'farm'; // what a list does while it runs a button's actions
    actionDef('selectBuilding')!.run(ctxOf(r), { row: '{row.id}' }, { picked: undefined } as never);
    expect(r.sim.runtime.vars['build.selected']).toBe('farm');
  });
});
