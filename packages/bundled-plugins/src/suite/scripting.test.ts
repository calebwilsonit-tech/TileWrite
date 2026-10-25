import { afterEach, describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { C, type EntityData, type EventRow, type PrefabData, type TransformIso } from '@tilewright/runtime';
import { GRID_PLUS_X, flatScene, player, rig, thing, wire, type Rig } from '@tilewright/plugin-sdk/testing';
import {
  attachBehavior,
  getBehavior,
  newAction,
  newCondition,
  newRow,
  output,
  activate,
  clearScripts,
  defaultImporter,
  eventsToScript,
  installScriptGlobals,
  instrument,
  lineMapOf,
  loadScript,
  scriptId,
  settingFields,
  tsTranspiler,
} from '@tilewright/behaviors';
import { healthOf } from '@tilewright/plugin-combat';
import '@tilewright/bundled-plugins';

const transpiler = tsTranspiler(ts as never);
const importer = defaultImporter();

interface Captured {
  logs: { kind: string; text: string }[];
  breaks: { script: string; line: number; x: number; vars: string }[];
}

async function install(file: string, source: string, bps: number[] = []): Promise<{ id: string; cap: Captured; problems: { line: number; message: string }[]; unplaced: number[] }> {
  const cap: Captured = { logs: [], breaks: [] };
  const hooks = {
    log: (kind: 'log' | 'warn' | 'error', text: string) => void cap.logs.push({ kind, text }),
    onBreak: (hit: { script: string; line: number; me: { x: number }; game: { vars: Record<string, unknown> } }) => void cap.breaks.push({ script: hit.script, line: hit.line, x: hit.me.x, vars: JSON.stringify(hit.game.vars) }),
  };
  installScriptGlobals(hooks as never);
  const r = await loadScript(file, source, transpiler, importer, bps);
  if (!r.loaded) return { id: '', cap, problems: r.problems, unplaced: r.unplaced };
  const def = activate(r.loaded, hooks as never);
  return { id: def.id, cap, problems: [], unplaced: r.unplaced };
}

afterEach(() => clearScripts());

function withScript(id: string, settings: Record<string, unknown> = {}, extra: Partial<EntityData> = {}): EntityData {
  const e = thing('s', 'Scripted', 8.5, 8.5, {});
  attachBehavior(e.components, id);
  Object.assign(e.components[id] as object, settings);
  return { ...e, ...extra };
}

function scene(...entities: EntityData[]) {
  const fs = flatScene();
  fs.scene.entities.push(player('p', 3.5, 3.5), ...entities);
  return fs.scene;
}

const SPINNER = `
interface Spin { turns: number }
const names: Record<string, string> = { a: 'x' };

export default defineScript({
  name: 'Spinner',
  description: 'Turns on the spot.',
  settings: { everySeconds: { value: 0.5, label: 'Turn every', min: 0.1, step: 0.1 }, clockwise: true, label: 'hello' },
  outputs: ['turned'],
  start(me, game) {
    me.state.started = (me.state.started ?? 0) + 1;
    game.vars.starts = (game.vars.starts as number ?? 0) + 1;
  },
  update(me, game) {
    me.state.t = (me.state.t ?? 0) + game.dt;
    if (me.state.t >= me.settings.everySeconds) {
      me.state.t = 0;
      me.facing += me.settings.clockwise ? 1 : -1;
      me.output('turned', true);
    } else me.output('turned', false);
  },
});
`;

describe('loading scripts', () => {
  it('a TypeScript script becomes a behaviour with Inspector fields, runs start once and update every tick', async () => {
    const { id, problems } = await install('assets/scripts/Spinner.script.ts', SPINNER);
    expect(problems).toEqual([]);
    expect(id).toBe('script_Spinner');
    const def = getBehavior(id)!;
    expect(def.category).toBe('Scripts');
    expect(def.description).toBe('Turns on the spot.');
    expect(def.fields.map((f) => [f.key, f.type, f.label])).toEqual([
      ['everySeconds', 'number', 'Turn every'],
      ['clockwise', 'boolean', 'Clockwise'],
      ['label', 'text', 'Label'],
    ]);
    expect(def.fields[0]).toMatchObject({ min: 0.1, step: 0.1 });
    expect(def.outputs.map((o) => o.name)).toEqual(['turned']);
    const r = rig(scene(withScript(id)));
    const f0 = r.get('s').get<TransformIso>(C.Transform)!.facing;
    r.run(65);
    expect(r.get('s').get<TransformIso>(C.Transform)!.facing).toBe((f0 + 2) % 8); // two turns in a bit over a second
    expect(r.sim.runtime.vars.starts).toBe(1);
    expect((r.get('s').get('state:script_Spinner') as { data: { started: number } }).data.started).toBe(1);
  });

  it('its settings come from the Inspector (and fill in defaults for old scenes)', async () => {
    const { id } = await install('Spinner.script.ts', SPINNER);
    const r = rig(scene(withScript(id, { everySeconds: 0.2, clockwise: false })));
    r.run(30);
    expect(r.get('s').get<TransformIso>(C.Transform)!.facing).toBe(0); // two counter-clockwise turns from facing 2
    expect(settingFields({ speed: 5, on: true, mode: { value: 'a', options: ['a', 'b'] } }).fields.map((f) => f.type)).toEqual(['number', 'boolean', 'select']);
  });

  it('script names make safe ids', () => {
    expect(scriptId('My cool script!')).toBe('script_My_cool_script_');
  });

  it('signals, finding things, walking, damage, items and the rest of the game API', async () => {
    const source = `
export default defineScript({
  name: 'Hunter',
  inputs: ['go'],
  outputs: ['caught'],
  settings: { speed: 3 },
  update(me, game) {
    const p = game.player!;
    if (!me.input('go') || me.state.done) return;
    if (me.distanceTo(p) < 1.2) {
      me.state.done = true;
      me.output('caught', true);
      game.damage(p, 1);
      game.giveItem('coin', 2);
      game.vars.caught = true;
      game.say('Got you!');
      return;
    }
    me.walkTo(p.x, p.y, me.settings.speed);
  },
});`;
    const { id, problems } = await install('Hunter.script.ts', source);
    expect(problems).toEqual([]);
    const hero = player('p', 3.5, 3.5);
    attachBehavior(hero.components, 'health');
    const hunter = withScript(id);
    hunter.components.body = { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 4, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null };
    const fs = flatScene();
    fs.scene.entities.push(hero, hunter, thing('lever', 'Switch', 12.5, 12.5, { lever: { startOn: true } }));
    fs.scene.wires.push(wire('w', ['lever', 'on'], ['s', 'go']));
    const r = rig(fs.scene);
    r.run(400);
    expect(output(r.get('s'), 'caught')).toBe(true);
    expect(healthOf(r.get('p'))!.hp).toBeLessThan(3);
    expect(r.sim.runtime.vars.caught).toBe(true);
    expect(r.sim.runtime.vars['item:coin']).toBe(2);
  });

  it('can do anything an event row can, and check anything one can check', async () => {
    const source = `
export default defineScript({
  name: 'Bridge to rows',
  update(me, game) {
    if (!game.test('variable', { name: 'flag', op: '=', value: '1' })) game.do('setVariable', { name: 'flag', op: 'set', value: '1' });
    if (game.test('hasItem', { item: 'key' })) game.do('message', { text: 'Has a key' });
    game.do('giveItem', { item: 'key', amount: 1 });
  },
});`;
    const { id } = await install('Rows.script.ts', source);
    const r = rig(scene(withScript(id)));
    r.run(3);
    expect(r.sim.runtime.vars.flag).toBe(1);
    expect(r.sim.runtime.vars['item:key']).toBe(3);
    const bad = `export default defineScript({ name: 'Bad ids', update(me, game) { game.do('doesNotExist'); } });`;
    const b = await install('Bad.script.ts', bad);
    const r2 = rig(scene(withScript(b.id)));
    expect(() => r2.run(1)).toThrow(/There is no event action called "doesNotExist"/);
  });

  it('says so when setting gravity does nothing (the older physics, a bad direction, no body), like the event rows do', async () => {
    const source = `export default defineScript({ name: 'Flip', settings: { dir: 'sideways' }, update(me) { me.gravity = me.settings.dir as string; } });`;
    const { id } = await install('Flip.script.ts', source);
    const problems = (flags: Record<string, boolean>, dir: string, withBody = true): string[] => {
      const e = withScript(id, { dir });
      if (withBody) e.components.body = { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 4, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null };
      const r = rig(scene(e));
      Object.assign(r.sim.compat, flags);
      const said: string[] = [];
      r.sim.events.on('problem', (d) => void said.push(String(d.text)));
      r.run(2);
      return said;
    };
    expect(problems({ blockPhysics: true }, '+x')).toEqual([]); // works: nothing to say
    expect(problems({ blockPhysics: false }, '+x')[0]).toMatch(/older physics.*Compatibility/);
    expect(problems({ blockPhysics: true }, 'sideways')[0]).toMatch(/"sideways".*does nothing.*-z, \+z/);
    expect(problems({ blockPhysics: true }, '+x', false)[0]).toMatch(/has no Body/);
  });

  it('can spawn prefabs and react to events', async () => {
    const prefab: PrefabData = { schemaVersion: 1, name: 'Spark', root: { name: 'Spark', tags: ['spark'], components: { transform: { x: 0, y: 0, h: 0, facing: 2 } }, children: [] } };
    const source = `
export default defineScript({
  name: 'Sparky',
  phase: 'actuator',
  start(me, game) { game.spawn('Spark', me.x + 1, me.y); game.spawn('Nope', 1, 1); },
  onEvent(type, data, me, game) { if (type === 'pickup') game.vars.sawPickup = true; },
});`;
    const { id } = await install('Sparky.script.ts', source);
    const r = rig(scene(withScript(id), thing('coin', 'Coin', 3.5, 3.5, { pickup: { variable: 'coins' } })));
    r.sim.assets.prefabs.set('Spark', prefab);
    r.run(5);
    expect(r.sim.world.withTag('spark')).toHaveLength(1);
    expect(r.sim.runtime.vars.sawPickup).toBe(true); // the pickup happened earlier in the same update
    expect(r.sim.events.of('problem').length + 1).toBeGreaterThan(0);
  });
});

describe('console, errors and breakpoints', () => {
  it('console.log inside a script goes to the hooks, with objects written out', async () => {
    const { id, cap } = await install('Talker.script.ts', `export default defineScript({ name: 'Talker', start(me) { console.log('hello', { a: 1 }); console.warn('careful'); } });`);
    rig(scene(withScript(id))).run(2);
    expect(cap.logs).toEqual([
      { kind: 'log', text: 'hello {"a":1}' },
      { kind: 'warn', text: 'careful' },
    ]);
  });

  it('reports a syntax error with its line, and a script with no default export', async () => {
    const r = await install('Bad.script.ts', `export default defineScript({\n  name: 'Bad',\n  update(me, game) {\n    const x = ;\n  },\n});`);
    expect(r.id).toBe('');
    expect(r.problems[0]!.line).toBe(4);
    expect(r.problems[0]!.message.length).toBeGreaterThan(3);
    const none = await install('None.script.ts', `const a = 1;`);
    expect(none.problems[0]!.message).toMatch(/must end with `export default defineScript/);
  });

  it('a script that throws is reported with its name and the line in the source it was written in', async () => {
    const source = `interface Unused {\n  a: number;\n}\n\ntype Alias = string;\n\nexport default defineScript({\n  name: 'Crasher',\n  update(me, game) {\n    if (game.tick > 2) {\n      const o: any = undefined;\n      o.boom();\n    }\n  },\n});`;
    const { id } = await install('Crasher.script.ts', source);
    const r = rig(scene(withScript(id)));
    let msg = '';
    try {
      r.run(6);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('The Crasher behaviour on "Scripted" failed: The script "Crasher" failed at line 12 (update):');
    expect(msg).toContain('boom');
  });

  it('breakpoints report the object and the game when their line runs, and bad lines are said to be unplaceable', async () => {
    const source = `export default defineScript({\n  name: 'Watched',\n  update(me, game) {\n    game.vars.n = ((game.vars.n as number) ?? 0) + 1;\n    me.x += 0.5;\n  },\n});`;
    const { id, cap, unplaced } = await install('Watched.script.ts', source, [5, 2]);
    expect(unplaced).toEqual([2]); // line 2 is the middle of an object literal: a statement cannot start there
    const r = rig(scene(withScript(id)));
    r.run(2);
    expect(cap.breaks).toHaveLength(2);
    expect(cap.breaks[0]).toMatchObject({ script: 'Watched', line: 5, x: 8.5, vars: '{"n":1}' });
    expect(cap.breaks[1]!.x).toBe(9);
  });

  it('instrument keeps the line count, and the source map decoder maps generated lines back', () => {
    expect(instrument('a\n  b\nc', [2]).split('\n')).toHaveLength(3);
    expect(instrument('a\n  b\nc', [2])).toBe('a\n  __bp(2); b\nc');
    const out = transpiler.transpile('interface A { x: number }\nconst y: number = 1;\nexport default y;', 'f.ts');
    expect(lineMapOf(out.map).filter(Boolean)).toContain(2);
    expect(lineMapOf(undefined)).toEqual([]);
    expect(lineMapOf('not json')).toEqual([]);
  });
});

describe('reloading', () => {
  it('a changed script takes over on the next tick and keeps what the object remembered', async () => {
    const v1 = `export default defineScript({ name: 'Counter', update(me, game) { me.state.n = (me.state.n ?? 0) + 1; game.vars.n = me.state.n; } });`;
    await install('Counter.script.ts', v1);
    const r = rig(scene(withScript('script_Counter')));
    r.run(10);
    expect(r.sim.runtime.vars.n).toBe(10);
    const v2 = `export default defineScript({ name: 'Counter', update(me, game) { me.state.n = (me.state.n ?? 0) + 10; game.vars.n = me.state.n; } });`;
    await install('Counter.script.ts', v2);
    r.run(1);
    expect(r.sim.runtime.vars.n).toBe(20); // continued from 10, now by tens
  });

  it('removing scripts takes their behaviours out of the registry', async () => {
    const { id } = await install('Gone.script.ts', `export default defineScript({ name: 'Gone' });`);
    expect(getBehavior(id)).toBeDefined();
    clearScripts();
    expect(getBehavior(id)).toBeUndefined();
  });
});

describe('convert an event sheet to code', () => {
  const cond = (type: string, params: Record<string, unknown> = {}, negate = false) => ({ ...newCondition(type), params: { ...newCondition(type).params, ...params }, negate });
  const act = (type: string, params: Record<string, unknown> = {}) => ({ ...newAction(type), params: { ...newAction(type).params, ...params } });
  const row = (id: string, partial: Partial<EventRow>): EventRow => ({ ...newRow(id), conditions: [], ...partial });

  const sheet: EventRow[] = [
    row('count', { conditions: [cond('every', { seconds: 0.25 })], actions: [act('setVariable', { name: 'ticks', op: 'add', value: '1' })] }),
    row('once', { once: true, conditions: [cond('variable', { name: 'ticks', op: '>=', value: '3' })], actions: [act('setVariable', { name: 'big', op: 'add', value: '1' })], children: [row('child', { conditions: [cond('variable', { name: 'big', op: '>=', value: '1' })], actions: [act('setVariable', { name: 'kid', op: 'add', value: '1' })] })] }),
    row('any', { mode: 'any', conditions: [cond('variable', { name: 'nothing', op: '>=', value: '1' }), cond('variable', { name: 'ticks', op: '>=', value: '5' }, false)], actions: [act('setVariable', { name: 'either', op: 'set', value: '7' })] }),
    row('twice', { repeat: 3, once: true, conditions: [cond('variable', { name: 'ticks', op: '>=', value: '2' })], actions: [act('setVariable', { name: 'rep', op: 'add', value: '1' })] }),
    row('neg', { conditions: [cond('variable', { name: 'stop', op: '=', value: '1' }, true)], actions: [act('setVariable', { name: 'negs', op: 'add', value: '1' })] }),
    row('loop', { forEach: 'tag:thing', conditions: [cond('always')], actions: [act('setVariable', { name: 'things', op: 'add', value: '1' })], children: [row('inner', { once: true, conditions: [cond('always')], actions: [act('setVariable', { name: 'inner', op: 'add', value: '1' })] })] }),
    row('off', { enabled: false, actions: [act('setVariable', { name: 'never', op: 'set', value: '1' })] }),
    row('random', { conditions: [cond('chance', { percent: 20 })], actions: [act('setVariable', { name: 'luck', op: 'add', value: '1' })] }),
  ];

  const vars = [{ name: 'ticks', value: 0 }, { name: 'big', value: 0 }, { name: 'kid', value: 0 }, { name: 'either', value: 0 }, { name: 'rep', value: 0 }, { name: 'negs', value: 0 }, { name: 'things', value: 0 }, { name: 'inner', value: 0 }, { name: 'luck', value: 0 }, { name: 'stop', value: 0 }, { name: 'nothing', value: 0 }];

  function build(events: EventRow[], script?: string): Rig {
    const fs = flatScene();
    fs.scene.variables = structuredClone(vars);
    fs.scene.entities.push(player('p', 3.5, 3.5), { ...thing('t1', 'Thing A', 5.5, 5.5, {}), tags: ['thing'] }, { ...thing('t2', 'Thing B', 7.5, 5.5, {}), tags: ['thing'] });
    if (script) fs.scene.entities.push(withScript(script));
    fs.scene.events = events;
    return rig(fs.scene);
  }

  it('behaves exactly like the sheet it was made from', async () => {
    const code = eventsToScript(sheet);
    const loaded = await install('From events.script.ts', code);
    expect(loaded.problems).toEqual([]);
    const a = build(sheet);
    const b = build([], loaded.id);
    for (let i = 0; i < 300; i++) {
      a.sim.step(i % 90 < 30 ? GRID_PLUS_X : {});
      b.sim.step(i % 90 < 30 ? GRID_PLUS_X : {});
    }
    expect(b.sim.runtime.vars).toEqual(a.sim.runtime.vars);
    expect(a.sim.runtime.vars.ticks).toBeGreaterThan(5);
    expect(a.sim.runtime.vars.things).toBe(600); // two things, every tick
    expect(a.sim.runtime.vars.inner).toBe(1); // a sub-event of a loop shares its once-state across the objects, and so does the code
    expect(a.sim.runtime.vars.either).toBe(7);
    expect(a.sim.runtime.vars.luck).toBeGreaterThan(0);
  });

  it('writes readable code: a comment in plain English for each row, and the same shape every time', () => {
    const code = eventsToScript(sheet.slice(0, 2), undefined, 'My sheet');
    expect(code).toContain("name: \"My sheet\"");
    expect(code).toContain('// When every 0.25 seconds');
    expect(code).toContain('game.test("every", {"seconds":0.25}, picked)');
    expect(code).toContain('game.do("setVariable"');
    expect(code).toContain("me.state[\"row:once\"]");
    expect(eventsToScript([])).toContain('(the event sheet has no rows)');
  });
});
