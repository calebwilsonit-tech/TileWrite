import { describe, expect, it } from 'vitest';
import { EventRowSchema, type EventAction, type EventCondition, type EventRow, type Sprite, type TransformIso } from '@tilewright/runtime';
import { ACTIONS, CONDITIONS, actionDef, checkSheet, compare, conditionDef, describeCondition, describeRef, describeRow, interpolate, newAction, newCondition, newRow, resolveRef } from './sheet';
import { GRID_PLUS_X, flatScene, player, rig, thing } from '../testing';
import { output, setInput } from '../signals';

const row = (partial: Partial<EventRow> & { id: string }): EventRow => ({ ...newRow(partial.id), conditions: [], ...partial });
const cond = (type: string, params: Record<string, unknown> = {}, negate = false): EventCondition => ({ ...newCondition(type), params: { ...newCondition(type).params, ...params }, negate });
const act = (type: string, params: Record<string, unknown> = {}): EventAction => ({ ...newAction(type), params: { ...newAction(type).params, ...params } });

function sim(rows: EventRow[], extra?: (s: ReturnType<typeof flatScene>['scene']) => void) {
  const { scene } = flatScene();
  scene.entities.push(player('p', 5.5, 5.5), thing('lamp', 'Lamp', 9.5, 9.5, {}), thing('e1', 'Slime', 12.5, 12.5, {}), thing('e2', 'Slime', 14.5, 12.5, {}));
  scene.entities[2]!.tags.push('enemy');
  scene.entities[3]!.tags.push('enemy');
  scene.events = rows;
  scene.variables = [{ name: 'score', value: 0 }];
  extra?.(scene);
  return rig(scene);
}

describe('definitions', () => {
  it('every condition and action has a label, category and plain-English description', () => {
    for (const d of [...CONDITIONS, ...ACTIONS]) {
      expect(d.label.length, d.id).toBeGreaterThan(3);
      expect(d.category.length, d.id).toBeGreaterThan(2);
      const params = Object.fromEntries(d.params.map((p) => [p.key, p.default]));
      expect(d.describe(params).length, d.id).toBeGreaterThan(2);
      expect(d.describe(params), d.id).not.toMatch(/undefined|\[object/);
    }
  });

  it('ids are unique and defaults produce valid rows', () => {
    expect(new Set(CONDITIONS.map((c) => c.id)).size).toBe(CONDITIONS.length);
    expect(new Set(ACTIONS.map((c) => c.id)).size).toBe(ACTIONS.length);
    const r = newRow('r1');
    r.actions.push(...ACTIONS.map((a) => newAction(a.id)));
    r.conditions.push(...CONDITIONS.map((c) => newCondition(c.id)));
    expect(EventRowSchema.safeParse(JSON.parse(JSON.stringify(r))).success).toBe(true);
  });
});

describe('references', () => {
  it('finds objects by id, tag, name and player, and picked inside loops', () => {
    const r = sim([]);
    const ctx = { world: r.sim.world, runtime: r.sim.runtime } as never;
    expect(resolveRef(ctx, 'id:lamp')).toHaveLength(1);
    expect(resolveRef(ctx, 'tag:enemy')).toHaveLength(2);
    expect(resolveRef(ctx, 'name:Slime')).toHaveLength(2);
    expect(resolveRef(ctx, 'player')).toHaveLength(1);
    expect(resolveRef(ctx, 'id:nope')).toEqual([]);
    expect(resolveRef(ctx, 'picked')).toEqual([]);
    expect(resolveRef(ctx, 'picked', r.get('lamp'))).toEqual([r.get('lamp')]);
    expect(resolveRef(ctx, '')).toEqual([]);
    expect(resolveRef(ctx, 'weird')).toEqual([]);
  });

  it('describes references in words', () => {
    const names = { entity: (id: string) => (id === 'lamp' ? 'Lamp' : undefined) };
    expect(describeRef('player')).toBe('the player');
    expect(describeRef('tag:enemy')).toBe('anything tagged "enemy"');
    expect(describeRef('id:lamp', names)).toBe('"Lamp"');
    expect(describeRef('id:zzz', names)).toBe('"zzz"');
    expect(describeRef('')).toBe('nothing chosen');
  });
});

describe('comparing and text', () => {
  it('compares numbers and text sensibly', () => {
    expect(compare(5, '>', 3)).toBe(true);
    expect(compare(undefined, '=', 0)).toBe(true);
    expect(compare('abc', '=', 'abc')).toBe(true);
    expect(compare('abc', '!=', 'abd')).toBe(true);
    expect(compare(true, '=', true)).toBe(true);
    expect(compare(2, '<=', 2)).toBe(true);
    expect(compare(2, '>=', 3)).toBe(false);
    expect(compare('5', '=', 5)).toBe(true);
  });

  it('fills {variable} placeholders and leaves unknown ones alone', () => {
    expect(interpolate('Score: {score}!', { score: 3 })).toBe('Score: 3!');
    expect(interpolate('Hi {who}', {})).toBe('Hi {who}');
  });
});

describe('running rows', () => {
  it('runs a row every tick while its condition holds, or once if asked', () => {
    const every = row({ id: 'a', conditions: [cond('always')], actions: [act('setVariable', { name: 'score', op: 'add', value: '1' })] });
    const once = row({ id: 'b', once: true, conditions: [cond('always')], actions: [act('setVariable', { name: 'once', op: 'add', value: '1' })] });
    const r = sim([every, once]);
    r.run(10);
    expect(r.sim.runtime.vars.score).toBe(10);
    expect(r.sim.runtime.vars.once).toBe(1);
  });

  it('"once" fires again each time the condition becomes true again', () => {
    const rows = [row({ id: 'x', once: true, conditions: [cond('variable', { name: 'flag', op: '=', value: '1' })], actions: [act('setVariable', { name: 'hits', op: 'add', value: '1' })] })];
    const r = sim(rows);
    for (const v of [1, 1, 0, 1, 1, 0, 1]) {
      r.sim.runtime.vars.flag = v;
      r.run(1);
    }
    expect(r.sim.runtime.vars.hits).toBe(3);
  });

  it('AND needs every condition, OR needs one, NOT flips', () => {
    const rows = [
      row({ id: 'and', mode: 'all', conditions: [cond('variable', { name: 'a', op: '=', value: '1' }), cond('variable', { name: 'b', op: '=', value: '1' })], actions: [act('setVariable', { name: 'and', op: 'set', value: '1' })] }),
      row({ id: 'or', mode: 'any', conditions: [cond('variable', { name: 'a', op: '=', value: '1' }), cond('variable', { name: 'b', op: '=', value: '1' })], actions: [act('setVariable', { name: 'or', op: 'set', value: '1' })] }),
      row({ id: 'not', conditions: [cond('variable', { name: 'a', op: '=', value: '1' }, true)], actions: [act('setVariable', { name: 'not', op: 'set', value: '1' })] }),
    ];
    const r = sim(rows);
    r.sim.runtime.vars.a = 1;
    r.sim.runtime.vars.b = 0;
    r.run(1);
    expect(r.sim.runtime.vars.and).toBeUndefined();
    expect(r.sim.runtime.vars.or).toBe(1);
    expect(r.sim.runtime.vars.not).toBeUndefined();
    r.sim.runtime.vars.b = 1;
    r.sim.runtime.vars.a = 0;
    r.run(1);
    expect(r.sim.runtime.vars.not).toBe(1);
  });

  it('disabled rows do nothing; rows with no conditions always run', () => {
    const r = sim([row({ id: 'off', enabled: false, actions: [act('setVariable', { name: 'x', op: 'set', value: '1' })] }), row({ id: 'on', actions: [act('setVariable', { name: 'y', op: 'set', value: '1' })] })]);
    r.run(2);
    expect(r.sim.runtime.vars.x).toBeUndefined();
    expect(r.sim.runtime.vars.y).toBe(1);
  });

  it('sub-events run only while their parent holds', () => {
    const child = row({ id: 'child', conditions: [cond('always')], actions: [act('setVariable', { name: 'inner', op: 'add', value: '1' })] });
    const parent = row({ id: 'parent', conditions: [cond('variable', { name: 'go', op: '=', value: '1' })], actions: [], children: [child] });
    const r = sim([parent]);
    r.run(5);
    expect(r.sim.runtime.vars.inner).toBeUndefined();
    r.sim.runtime.vars.go = 1;
    r.run(5);
    expect(r.sim.runtime.vars.inner).toBe(5);
  });

  it('repeat runs the actions several times', () => {
    const r = sim([row({ id: 'rep', once: true, repeat: 4, conditions: [cond('start')], actions: [act('setVariable', { name: 'n', op: 'add', value: '2' })] })]);
    r.run(3);
    expect(r.sim.runtime.vars.n).toBe(8);
  });

  it('"for each" checks every matching object and "picked" means the current one', () => {
    const r = sim([
      row({
        id: 'loop',
        forEach: 'tag:enemy',
        conditions: [cond('near', { a: 'picked', b: 'player', cells: 20 })],
        actions: [act('setVisible', { who: 'picked', visible: 'hidden' })],
        children: [],
      }),
    ]);
    r.run(2);
    for (const id of ['e1', 'e2']) expect(r.get(id).get<Sprite>('sprite')!.visible).toBe(false);
    expect(r.get('lamp').get<Sprite>('sprite')!.visible).toBe(true);
  });

  it('a loop can remove only the objects that satisfy its condition', () => {
    const r = sim([row({ id: 'loop', forEach: 'tag:enemy', conditions: [cond('near', { a: 'picked', b: 'id:lamp', cells: 5 })], actions: [act('destroy', { who: 'picked' })] })]);
    // e1 is at (12.5,12.5), lamp at (9.5,9.5): distance 4.2 -> near; e2 at (14.5,12.5): 5.8 -> not near
    r.run(2);
    expect(r.sim.world.withTag('enemy')).toHaveLength(1);
    expect(r.sim.world.withTag('enemy')[0]!.name).toBe('Slime');
    expect(r.sim.world.get(r.get('e2').id)).toBeDefined();
    expect(r.sim.world.get(r.get('e1').id)).toBeUndefined();
  });
});

describe('conditions', () => {
  const holds = (c: EventCondition, setup?: (r: ReturnType<typeof sim>) => void, ticks = 1): boolean => {
    const r = sim([row({ id: 't', conditions: [c], actions: [act('setVariable', { name: 'hit', op: 'set', value: '1' })] })]);
    setup?.(r);
    r.run(ticks);
    return r.sim.runtime.vars.hit === 1;
  };

  it('start is true only on the first tick', () => {
    const r = sim([row({ id: 's', conditions: [cond('start')], actions: [act('setVariable', { name: 'n', op: 'add', value: '1' })] })]);
    r.run(30);
    expect(r.sim.runtime.vars.n).toBe(1);
  });

  it('every N seconds fires at the right rate', () => {
    const r = sim([row({ id: 'e', conditions: [cond('every', { seconds: 0.5 })], actions: [act('setVariable', { name: 'n', op: 'add', value: '1' })] })]);
    r.run(121);
    expect(r.sim.runtime.vars.n).toBe(4); // ticks 30, 60, 90, 120
  });

  it('chance is deterministic for a seed and respects 0 and 100', () => {
    const run = (p: number) => {
      const r = sim([row({ id: 'c', conditions: [cond('chance', { percent: p })], actions: [act('setVariable', { name: 'n', op: 'add', value: '1' })] })]);
      r.run(500);
      return (r.sim.runtime.vars.n as number | undefined) ?? 0;
    };
    expect(run(0)).toBe(0);
    expect(run(100)).toBe(500);
    expect(run(10)).toBe(run(10));
    expect(run(10)).toBeGreaterThan(20);
    expect(run(10)).toBeLessThan(90);
  });

  it('counts, existence, signals, closeness and being inside an area', () => {
    expect(holds(cond('count', { tag: 'enemy', op: '=', value: 2 }))).toBe(true);
    expect(holds(cond('count', { tag: 'enemy', op: '>', value: 2 }))).toBe(false);
    expect(holds(cond('exists', { who: 'tag:enemy' }))).toBe(true);
    expect(holds(cond('exists', { who: 'tag:dragon' }))).toBe(false);
    expect(holds(cond('near', { a: 'player', b: 'id:lamp', cells: 2 }))).toBe(false);
    expect(holds(cond('near', { a: 'player', b: 'id:lamp', cells: 6 }))).toBe(true);
    expect(holds(cond('signal', { who: 'id:lamp', side: 'output', name: 'x', state: 'on' }), (r) => setInput(r.get('lamp'), 'x', true))).toBe(false);
    expect(holds(cond('signal', { who: 'id:lamp', side: 'input', name: 'x', state: 'on' }), (r) => setInput(r.get('lamp'), 'x', true))).toBe(true);
    expect(holds(cond('signal', { who: 'id:lamp', side: 'output', name: 'x', state: 'off' }))).toBe(true);

    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('zone', 'Zone', 5.5, 5.5, { triggerZone: {} }));
    scene.events = [row({ id: 'in', conditions: [cond('inside', { who: 'player', zone: 'id:zone' })], actions: [act('setVariable', { name: 'inside', op: 'set', value: '1' })] })];
    const r = rig(scene);
    r.run(5);
    expect(r.sim.runtime.vars.inside).toBe(1);
    expect(output(r.get('zone'), 'occupied')).toBe(true);
  });

  it('buttons: pressed, held, released', () => {
    const rows = ['pressed', 'held', 'released'].map((mode) => row({ id: mode, conditions: [cond('action', { name: 'interact', mode })], actions: [act('setVariable', { name: mode, op: 'add', value: '1' })] }));
    const r = sim(rows);
    r.run(2);
    r.run(5, { interact: 1 });
    r.run(3);
    expect(r.sim.runtime.vars.pressed).toBe(1);
    expect(r.sim.runtime.vars.held).toBe(5);
    expect(r.sim.runtime.vars.released).toBe(1);
  });

  it('reacts to game events such as pickups and pushes', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 5.5, 5.5), thing('coin', 'Coin', 6.5, 5.5, { pickup: { variable: 'coins' } }));
    scene.events = [row({ id: 'pick', conditions: [cond('onEvent', { name: 'pickup' })], actions: [act('message', { text: 'Coins: {coins}' })] })];
    const r = rig(scene);
    const msgs: unknown[] = [];
    r.sim.events.on('message', (e) => msgs.push(e.text));
    r.run(60, GRID_PLUS_X);
    expect(msgs).toEqual(['Coins: 1']);
  });
});

describe('actions', () => {
  const runOnce = (a: EventAction, tweak?: (r: ReturnType<typeof sim>) => void) => {
    const r = sim([row({ id: 'a', once: true, conditions: [cond('start')], actions: [a] })]);
    tweak?.(r);
    r.run(2);
    return r;
  };

  it('changes variables in every way', () => {
    const r = sim([
      row({ id: '1', once: true, conditions: [cond('start')], actions: [act('setVariable', { name: 'v', op: 'set', value: '10' }), act('setVariable', { name: 'v', op: 'add', value: '5' }), act('setVariable', { name: 'v', op: 'subtract', value: '3' }), act('setVariable', { name: 'v', op: 'multiply', value: '2' }), act('setVariable', { name: 'f', op: 'toggle', value: '' }), act('setVariable', { name: 's', op: 'set', value: 'hello' })] }),
    ]);
    r.run(2);
    expect(r.sim.runtime.vars).toMatchObject({ v: 24, f: true, s: 'hello' });
  });

  it('turns signals on, off and toggles them', () => {
    const on = runOnce(act('setSignal', { who: 'id:lamp', name: 'lit', state: 'on' }));
    expect(output(on.get('lamp'), 'lit')).toBe(true);
    const tog = runOnce(act('setSignal', { who: 'id:lamp', name: 'lit', state: 'toggle' }));
    expect(output(tog.get('lamp'), 'lit')).toBe(true);
    const off = sim([row({ id: 'a', conditions: [cond('start')], actions: [act('setSignal', { who: 'id:lamp', name: 'lit', state: 'on' })] }), row({ id: 'b', conditions: [cond('every', { seconds: 0.1 })], actions: [act('setSignal', { who: 'id:lamp', name: 'lit', state: 'off' })] })]);
    off.run(10);
    expect(output(off.get('lamp'), 'lit')).toBe(false);
  });

  it('removes, hides, switches collision, teleports, and sets any property', () => {
    expect(runOnce(act('destroy', { who: 'tag:enemy' })).sim.world.withTag('enemy')).toHaveLength(0);
    expect(runOnce(act('setVisible', { who: 'id:lamp', visible: 'hidden' })).get('lamp').get<Sprite>('sprite')!.visible).toBe(false);
    const r = runOnce(act('teleport', { who: 'player', to: 'id:lamp' }));
    expect(r.get('p').get<TransformIso>('transform')).toMatchObject({ x: 9.5, y: 9.5 });
    const prop = runOnce(act('setProperty', { who: 'id:lamp', component: 'sprite', key: 'color', value: '255' }));
    expect(prop.get('lamp').get<Sprite>('sprite')!.color).toBe(255);
    const missing = runOnce(act('setProperty', { who: 'id:lamp', component: 'sprite', key: 'nope', value: '1' }));
    expect(missing.get('lamp').get<Record<string, unknown>>('sprite')!.nope).toBeUndefined(); // only existing settings can be changed
  });

  it('shows messages, announces events and sounds', () => {
    const r = sim([row({ id: 'a', once: true, conditions: [cond('start')], actions: [act('message', { text: 'Score {score}' }), act('emit', { name: 'ding' }), act('sound', { name: 'boom' })] })]);
    const seen: string[] = [];
    r.sim.events.on('*', (e) => seen.push(`${e.type}:${e.text ?? e.name ?? ''}`));
    r.run(2);
    expect(seen).toEqual(['message:Score 0', 'ding:', 'sound:boom']);
  });

  it('asks the host for sounds, music, sparks, a shake and a freeze', () => {
    const r = sim([
      row({
        id: 'a',
        once: true,
        conditions: [cond('start')],
        actions: [act('sound', { name: 'boom', volume: 0.5 }), act('music', { name: 'calm' }), act('particles', { at: 'id:lamp', effect: 'confetti', count: 12 }), act('shake', { pixels: 6 }), act('hitStop', { seconds: 0.1 })],
      }),
    ]);
    r.run(2);
    const rt = r.sim.runtime;
    expect(rt.fx).toContainEqual({ kind: 'sound', name: 'boom', volume: 0.5 });
    expect(rt.fx).toContainEqual({ kind: 'music', name: 'calm' });
    expect(rt.fx).toContainEqual({ kind: 'burst', preset: 'confetti', x: 9.5, y: 9.5, h: 0, count: 12 });
    expect(rt.view.impact).toBeGreaterThan(0);
    expect(rt.hitStop).toBe(6);
    expect(describeRow(row({ id: 'p', conditions: [cond('always')], actions: [act('particles', { at: 'player', effect: 'dust', count: 0 }), act('music', { name: '' })] }))).toBe('Always, throw dust at the player, then fade the music out.');
  });

  it('creates objects from a prefab at another object', () => {
    const r = sim([row({ id: 'a', once: true, conditions: [cond('start')], actions: [act('spawn', { prefab: 'Orb', at: 'id:lamp', dx: 1, dy: -1 })] })]);
    r.sim.assets.prefabs.set('Orb', { schemaVersion: 1, name: 'Orb', root: { name: 'Orb', tags: ['orb'], components: { transform: { x: 0, y: 0, h: 0, facing: 2 } }, children: [] } });
    r.run(3);
    const orb = r.sim.world.withTag('orb')[0]!;
    expect(orb.get<TransformIso>('transform')).toMatchObject({ x: 10.5, y: 8.5 });
  });

  it('survives unknown types and missing objects', () => {
    const r = sim([row({ id: 'a', conditions: [{ type: 'mystery', params: {}, negate: false }], actions: [{ type: 'mystery', params: {} }] }), row({ id: 'b', conditions: [cond('always')], actions: [act('destroy', { who: 'id:ghost' }), act('teleport', { who: 'player', to: 'id:ghost' }), act('setSignal', { who: 'tag:none', name: 'x', state: 'on' })] })]);
    expect(() => r.run(5)).not.toThrow();
    expect(conditionDef('mystery')).toBeUndefined();
    expect(actionDef('mystery')).toBeUndefined();
  });
});

describe('plain English', () => {
  const names = { entity: (id: string) => ({ lamp: 'Lamp', zone: 'Door area' })[id] };

  it('reads a row as a sentence', () => {
    const r = row({
      id: 'r',
      conditions: [cond('inside', { who: 'player', zone: 'id:zone' }), cond('variable', { name: 'keys', op: '>=', value: '1' })],
      actions: [act('message', { text: 'Unlocked' }), act('destroy', { who: 'id:lamp' })],
    });
    expect(describeRow(r, names)).toBe('When the player is inside "Door area" and keys is at least 1, show the message "Unlocked", then remove "Lamp".');
    expect(describeRow({ ...r, mode: 'any' }, names)).toContain(' or ');
    expect(describeRow({ ...r, once: true, repeat: 3 }, names)).toContain('(only the moment it becomes true, 3 times)');
    expect(describeRow(row({ id: 'e', conditions: [cond('always')], actions: [] }))).toBe('Always, do nothing yet.');
    expect(describeRow(row({ id: 'l', forEach: 'tag:enemy', conditions: [cond('always')], actions: [act('destroy', { who: 'picked' })] }))).toBe('For each thing tagged "enemy": Always, remove the picked object.');
    expect(describeCondition(cond('start', {}, true))).toBe('NOT the game starts');
  });
});

describe('checking a sheet', () => {
  const facts = { entityIds: new Set(['lamp']), tags: new Set(['enemy']), variables: new Set(['score']), prefabs: new Set(['Orb']) };

  it('finds mistakes in plain English', () => {
    const rows = [
      row({ id: 'a', conditions: [cond('inside', { who: 'player', zone: 'id:gone' })], actions: [act('destroy', { who: 'tag:dragon' }), act('spawn', { prefab: 'Missing' }), act('spawn', { prefab: '' }), act('setVariable', { name: '' })] }),
      row({ id: 'b', conditions: [cond('variable', { name: 'mystery', op: '=', value: '1' })], actions: [act('destroy', { who: 'picked' })] }),
      row({ id: 'c', conditions: [{ type: 'weird', params: {}, negate: false }], actions: [{ type: 'weird', params: {} }] }),
    ];
    const text = checkSheet(rows, facts).map((p) => p.text).join('\n');
    expect(text).toMatch(/object "gone" no longer exists/);
    expect(text).toMatch(/no object has the tag "dragon"/);
    expect(text).toMatch(/prefab "Missing" does not exist/);
    expect(text).toMatch(/no prefab is chosen/);
    expect(text).toMatch(/no variable is chosen/);
    expect(text).toMatch(/"mystery" is checked but never set/);
    expect(text).toMatch(/only works inside a "for each" row/);
    expect(text).toMatch(/condition of type "weird"/);
    expect(text).toMatch(/action of type "weird"/);
  });

  it('reports sounds that are not in the project, but only when it knows which sounds there are', () => {
    const rows = [row({ id: 'a', conditions: [cond('start')], actions: [act('sound', { name: 'boom' }), act('music', { name: 'calm' }), act('music', { name: '' })] })];
    expect(checkSheet(rows, facts)).toEqual([]);
    const text = checkSheet(rows, { ...facts, sounds: new Set(['calm']) }).map((p) => p.text);
    expect(text).toHaveLength(1);
    expect(text[0]).toMatch(/sound "boom" is not in Assets -> Sounds/);
  });

  it('is quiet for a good sheet, and allows "picked" inside loops and variables set elsewhere', () => {
    const rows = [
      row({ id: 'a', conditions: [cond('start')], actions: [act('setVariable', { name: 'made', op: 'set', value: '1' })] }),
      row({ id: 'b', conditions: [cond('variable', { name: 'made', op: '=', value: '1' }), cond('variable', { name: 'score', op: '>', value: '0' })], actions: [act('spawn', { prefab: 'Orb', at: 'id:lamp' })] }),
      row({ id: 'c', forEach: 'tag:enemy', conditions: [cond('near', { a: 'picked', b: 'player', cells: 3 })], actions: [act('destroy', { who: 'picked' })] }),
    ];
    expect(checkSheet(rows, facts)).toEqual([]);
  });
});

describe('determinism', () => {
  it('replays a busy sheet exactly', () => {
    const rows = [
      row({ id: 'a', conditions: [cond('chance', { percent: 5 })], actions: [act('setVariable', { name: 'score', op: 'add', value: '1' })] }),
      row({ id: 'b', forEach: 'tag:enemy', conditions: [cond('chance', { percent: 1 })], actions: [act('setVisible', { who: 'picked', visible: 'hidden' })] }),
    ];
    const a = sim(rows);
    const b = sim(rows);
    a.run(400);
    b.run(400);
    expect(a.sim.stateHash()).toBe(b.sim.stateHash());
    expect(a.sim.runtime.vars.score).toBeGreaterThan(0);
  });
});
