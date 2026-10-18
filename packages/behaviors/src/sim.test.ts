import { describe, expect, it } from 'vitest';
import { TableSchema } from '@tilewright/runtime';
import { flatScene, player, rig, thing, type Rig } from './testing';
import { canAfford, earn, parseCosts, setActivePacks, spend, newAction, newCondition, newRow } from './index';

setActivePacks(undefined);

const body = () => ({ body: player('x', 0, 0).components.body });

describe('resources and production', () => {
  it('parse, check and pay costs all-or-nothing', () => {
    expect(parseCosts('wood:2, stone:1, gold')).toEqual([['wood', 2], ['stone', 1], ['gold', 1]]);
    const vars = { wood: 5, stone: 1 };
    expect(canAfford(vars, 'wood:5, stone:1')).toBe(true);
    expect(canAfford(vars, 'wood:5, stone:2')).toBe(false);
    expect(spend(vars, 'wood:6')).toBe(false);
    expect(vars).toEqual({ wood: 5, stone: 1 });
    expect(spend(vars, 'wood:2, stone:1')).toBe(true);
    expect(vars).toEqual({ wood: 3, stone: 0 });
    earn(vars, 'gold:4, wood:1');
    expect(vars).toEqual({ wood: 4, stone: 0, gold: 4 });
  });

  it('a production chain: farm makes grain, mill turns grain into flour, bakery turns flour into bread; a stalled one waits', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('f', 'Farm', 3, 3, { producer: { makes: 'grain:2', uses: '', seconds: 1 } }));
    scene.entities.push(thing('m', 'Mill', 6, 3, { producer: { makes: 'flour:1', uses: 'grain:2', seconds: 1 } }));
    scene.entities.push(thing('b', 'Bakery', 9, 3, { producer: { makes: 'bread:3', uses: 'flour:1', seconds: 1 } }));
    const r = rig(scene);
    const made: string[] = [];
    r.sim.events.on('produced', (e) => made.push(String(e.makes)));
    r.run(60 * 6);
    const v = r.sim.runtime.vars;
    expect(Number(v.grain)).toBeGreaterThanOrEqual(0);
    expect(Number(v.bread)).toBeGreaterThanOrEqual(6);
    expect(made).toContain('bread:3');
    // with the farm switched off the rest of the chain runs dry and stalls, and says so on its signal
    const stalled = rig(flatScene().scene);
    stalled.sim.world.spawn({ name: 'Mill', components: { producer: { makes: 'flour:1', uses: 'grain:2', seconds: 1, enabled: true }, signals: { inputs: {}, outputs: {} } } });
    stalled.run(200);
    expect(stalled.sim.runtime.vars.flour).toBeUndefined();
    expect(stalled.sim.world.all()[0]!.get<{ outputs: Record<string, boolean> }>('signals')!.outputs.blocked).toBe(true);
  });

  it('are used by event rows: pay a cost only when it can be afforded', () => {
    const { scene } = flatScene();
    scene.variables.push({ name: 'gold', value: 25 });
    scene.events = [
      { ...newRow('buy'), conditions: [{ ...newCondition('canAfford'), params: { costs: 'gold:10' } }, newCondition('start')], actions: [{ ...newAction('spend'), params: { costs: 'gold:10' } }, { ...newAction('setVariable'), params: { name: 'bought', op: 'add', value: '1' } }], once: true },
    ];
    const r = rig(scene);
    r.run(5);
    expect(r.sim.runtime.vars.gold).toBe(15);
    expect(r.sim.runtime.vars.bought).toBe(1);
    expect(r.sim.runtime.vars['spend.ok']).toBe(true);
  });
});

describe('the calendar', () => {
  it('keeps the time from the game clock: hours, days, seasons, night, and announces the changes', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('c', 'Calendar', 1, 1, { calendar: { dayLength: 24, startHour: 8, daysPerSeason: 2, tint: true } }));
    const r = rig(scene);
    const events: string[] = [];
    for (const t of ['new-day', 'night-start', 'day-start', 'new-season']) r.sim.events.on(t, (e) => events.push(`${t}${e.name ? ':' + String(e.name) : ''}`));
    r.run(5);
    expect(r.sim.runtime.vars['time.clock']).toMatch(/^08:/);
    expect(r.sim.runtime.vars['time.night']).toBe(false);
    expect(r.sim.runtime.view.tint).toBeNull();
    r.run(60 * 13); // thirteen game hours (one hour a second) later it is the evening
    expect(Number(r.sim.runtime.vars['time.hour'])).toBeGreaterThan(20);
    expect(r.sim.runtime.vars['time.night']).toBe(true);
    expect(r.sim.runtime.view.tint?.alpha).toBeGreaterThan(0.3);
    r.run(60 * 24 * 2);
    expect(Number(r.sim.runtime.vars['time.day'])).toBeGreaterThanOrEqual(3);
    expect(events).toContain('night-start');
    expect(events).toContain('day-start');
    expect(events).toContain('new-day');
    expect(events.some((e) => e.startsWith('new-season'))).toBe(true);
    expect(r.sim.runtime.vars['time.seasonName']).toBeDefined();
  });

  it('stops while paused or by turns, and runs faster with the speed of the clock steps', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('c', 'Calendar', 1, 1, { calendar: { dayLength: 24, startHour: 8, daysPerSeason: 5, tint: false } }));
    const r = rig(scene);
    r.run(60);
    const h1 = Number(r.sim.runtime.vars['time.hour']);
    r.sim.runtime.clock.mode = 'paused';
    r.run(120);
    expect(Number(r.sim.runtime.vars['time.hour'])).toBe(h1);
    r.sim.runtime.clock.mode = 'turns';
    r.run(120);
    expect(Number(r.sim.runtime.vars['time.hour'])).toBe(h1);
    r.sim.runtime.clock.mode = 'realtime';
    r.run(60);
    expect(Number(r.sim.runtime.vars['time.hour'])).toBeGreaterThan(h1);
  });
});

describe('waves and routes', () => {
  const waves = TableSchema.parse({
    name: 'Waves',
    columns: [{ id: 'prefab', type: 'prefab' }, { id: 'count', type: 'number' }, { id: 'gap', type: 'number' }, { id: 'delay', type: 'number' }],
    rows: [{ id: 'w1', prefab: 'Runner', count: 3, gap: 0.5, delay: 0 }, { id: 'w2', prefab: 'Runner', count: 2, gap: 0.5, delay: 0 }],
  });
  const runner = {
    schemaVersion: 1,
    name: 'Runner',
    root: { name: 'Runner', tags: ['enemy'], children: [], components: { transform: { x: 0, y: 0, h: 0, facing: 2 }, sprite: { shape: 'box', color: 0xaa3333, w: 0.5, d: 0.5, height: 0.8, sortOffset: 0, visible: true }, body: player('x', 0, 0).components.body, pathFollower: { points: '', routeTag: 'route', speed: 6, removeAtEnd: true } } },
  };

  function td(): Rig {
    const { scene } = flatScene(24, 12);
    scene.entities.push(thing('s', 'Spawner', 2, 2, { waveSpawner: { table: 'Waves', autoStart: true, rest: 1, endless: false } }));
    for (const [i, p] of [[1, [2, 2]], [2, [10, 2]], [3, [10, 8]], [4, [20, 8]]] as const) scene.entities.push({ ...thing(`w${i}`, `Waypoint ${i}`, p[0], p[1], {}), tags: ['route'] });
    const r = rig(scene);
    r.sim.assets.tables.set('Waves', waves);
    r.sim.assets.prefabs.set('Runner', runner as never);
    return r;
  }

  it('send enemies from a table, they follow the route to the end, and the next wave comes after a rest', () => {
    const r = td();
    const log: string[] = [];
    for (const t of ['wave-started', 'wave-cleared', 'waves-done', 'path-end']) r.sim.events.on(t, (e) => log.push(`${t}${e.index ? ':' + String(e.index) : ''}`));
    r.run(75);
    expect(r.sim.runtime.vars['wave.state']).toBe('spawning');
    expect(r.sim.runtime.vars['wave.total']).toBe(2);
    r.run(60 * 30);
    expect(log.filter((l) => l === 'path-end')).toHaveLength(5); // three, then two
    expect(log.filter((l) => l.startsWith('wave-started'))).toEqual(['wave-started:1', 'wave-started:2']);
    expect(log).toContain('wave-cleared:1');
    expect(log).toContain('waves-done');
    expect(r.sim.runtime.vars['wave.state']).toBe('done');
    expect(r.sim.world.withTag('wave-enemy')).toHaveLength(0); // they removed themselves at the end
  });

  it('can be started by hand, and a wave counts only the enemies still alive', () => {
    const { scene } = flatScene(24, 12);
    scene.entities.push(thing('s', 'Spawner', 2, 2, { waveSpawner: { table: 'Waves', autoStart: false, rest: 0, endless: false } }));
    scene.events = [{ ...newRow('go'), conditions: [{ ...newCondition('variable'), params: { name: 'go', op: '>=', value: '1' } }], actions: [newAction('nextWave')], once: true }];
    const r = rig(scene);
    r.sim.assets.tables.set('Waves', waves);
    r.sim.assets.prefabs.set('Runner', { ...runner, root: { ...runner.root, components: { ...runner.root.components, pathFollower: { points: '2,2; 3,2', routeTag: '', speed: 0.01, removeAtEnd: false } } } } as never);
    r.run(60);
    expect(r.sim.runtime.vars['wave.state']).toBe('idle');
    r.sim.runtime.vars.go = 1;
    r.run(60 * 3);
    expect(r.sim.runtime.vars['wave.alive']).toBe(3);
    // kill them: the wave is cleared and the next one starts
    for (const e of r.sim.world.withTag('wave-enemy')) r.sim.world.destroy(e);
    r.run(60 * 2);
    expect(r.sim.runtime.vars['wave.index']).toBe(2);
  });

  it('endless waves keep coming, stronger each time', () => {
    const { scene } = flatScene(24, 12);
    scene.entities.push(thing('s', 'Spawner', 2, 2, { waveSpawner: { table: 'Waves', autoStart: true, rest: 0, endless: true } }));
    const r = rig(scene);
    r.sim.assets.tables.set('Waves', waves);
    r.sim.assets.prefabs.set('Runner', { ...runner, root: { ...runner.root, components: { ...runner.root.components, pathFollower: { points: '2,2; 2.1,2', routeTag: '', speed: 6, removeAtEnd: true } } } } as never);
    r.run(60 * 8);
    expect(Number(r.sim.runtime.vars['wave.index'])).toBeGreaterThanOrEqual(2);
    expect(r.sim.runtime.vars['wave.total']).toBe(9999);
  });
});

describe('needs and utility choices', () => {
  const activities = TableSchema.parse({
    name: 'Activities',
    columns: [{ id: 'need', type: 'text' }, { id: 'gain', type: 'number' }, { id: 'target', type: 'text' }, { id: 'seconds', type: 'number' }, { id: 'weight', type: 'number' }, { id: 'when', type: 'text' }, { id: 'makes', type: 'text' }],
    rows: [
      { id: 'eat', need: 'hunger', gain: 40, target: 'food', seconds: 2, weight: 0, when: 'any', makes: '' },
      { id: 'sleep', need: 'energy', gain: 30, target: 'bed', seconds: 3, weight: 0, when: 'night', makes: '' },
      { id: 'chop', need: '', gain: 0, target: 'tree', seconds: 2, weight: 30, when: 'day', makes: 'wood:1' },
    ],
  });

  function village(night = false): Rig {
    const { scene } = flatScene(30, 12);
    scene.entities.push({ ...thing('v', 'Villager', 5, 5, { utilityAgent: { table: 'Activities', needs: 'hunger:20, energy:0.1', speed: 6 } }, body()), tags: [] });
    scene.entities.push({ ...thing('f', 'Farm', 20, 5, {}), tags: ['food'] }, { ...thing('b', 'House', 3, 9, {}), tags: ['bed'] }, { ...thing('t', 'Tree', 10, 2, {}), tags: ['tree'] });
    scene.variables.push({ name: 'time.night', value: night });
    const r = rig(scene);
    r.sim.assets.tables.set('Activities', activities);
    return r;
  }

  it('works when nothing is urgent and eats when hungry: choosing, walking to the nearest target, doing it, and the need recovering', () => {
    const r = village();
    const chosen: string[] = [];
    r.sim.events.on('activity-chosen', (e) => chosen.push(String(e.activity)));
    r.run(60 * 2);
    expect(chosen[0]).toBe('chop'); // the villager starts with every need full, so work wins
    r.run(60 * 8);
    // hunger fell at 20 a second: well before it works again it has gone to the farm
    expect(chosen).toContain('eat');
    expect(Number(r.sim.runtime.vars.wood)).toBeGreaterThanOrEqual(1);
    const st = r.get('v').get<{ needs: Record<string, number> }>('state:agent')!;
    expect(st.needs.hunger).toBeGreaterThan(0);
  });

  it('only does night activities at night and day activities by day', () => {
    const night = village(true);
    const chosen: string[] = [];
    night.sim.events.on('activity-chosen', (e) => chosen.push(String(e.activity)));
    night.run(60 * 6);
    expect(chosen).not.toContain('chop');
    const day = village(false);
    const chosenDay: string[] = [];
    day.sim.events.on('activity-chosen', (e) => chosenDay.push(String(e.activity)));
    day.run(60 * 20);
    expect(chosenDay).not.toContain('sleep');
  });

  it('skips activities whose target does not exist', () => {
    const { scene } = flatScene(20, 10);
    scene.entities.push({ ...thing('v', 'Villager', 5, 5, { utilityAgent: { table: 'Activities', needs: 'hunger:50', speed: 6 } }, body()), tags: [] });
    const r = rig(scene);
    r.sim.assets.tables.set('Activities', activities);
    const chosen: string[] = [];
    r.sim.events.on('activity-chosen', (e) => chosen.push(String(e.activity)));
    r.run(60 * 5);
    expect(chosen).toEqual([]);
  });
});

describe('cellular automata', () => {
  const rules = TableSchema.parse({
    name: 'Automata',
    columns: [{ id: 'from', type: 'number' }, { id: 'to', type: 'number' }, { id: 'near', type: 'number' }, { id: 'min', type: 'number' }, { id: 'chance', type: 'number' }],
    rows: [
      { id: 'spread', from: 1, to: 7, near: 7, min: 1, chance: 100 }, // grass (1) next to fire (7) catches fire
      { id: 'burnout', from: 7, to: 3, near: 0, min: 0, chance: 50 }, // fire (7) dies out into sand (3)
    ],
  });

  function burn(): Rig {
    const { scene } = flatScene(21, 3);
    scene.entities.push(thing('a', 'Fire', 1, 1, { automaton: { table: 'Automata', every: 0.2, diagonal: false } }));
    const r = rig(scene);
    r.sim.assets.tables.set('Automata', rules);
    r.sim.map!.set(0, 1, 7, 0); // a spark
    return r;
  }

  it('spreads fire across grass one step at a time and burns out, with the same result every time', () => {
    const a = burn();
    const b = burn();
    a.run(30);
    b.run(30);
    expect(a.sim.map!.getTile(1, 1)).toBe(7);
    let burning = 0;
    for (let x = 0; x < 21; x++) if (a.sim.map!.getTile(x, 1) === 7) burning++;
    expect(burning).toBeGreaterThan(0);
    a.run(60 * 12);
    b.run(60 * 12);
    let sand = 0;
    for (let x = 0; x < 21; x++) if (a.sim.map!.getTile(x, 1) === 3) sand++;
    expect(sand).toBeGreaterThan(10);
    expect(JSON.stringify(a.sim.map!.toJSON())).toBe(JSON.stringify(b.sim.map!.toJSON()));
    expect(a.sim.stateHash()).toBe(b.sim.stateHash());
    // the host is told which cells to draw again
    const dirty = a.sim.runtime.scratch.get('dirtyCells') as unknown[];
    expect(dirty.length).toBeGreaterThan(0);
  });
});
