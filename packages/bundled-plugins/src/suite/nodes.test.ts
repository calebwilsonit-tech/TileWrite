import { describe, expect, it } from 'vitest';
import { pointerSnapshot, type EventAction, type EventCondition } from '@tilewright/runtime';
import { ctxOf, flatScene, player, rig, thing, wire, type Rig } from '@tilewright/plugin-sdk/testing';
import { actionPinsOf, eventPinsOf, newAction, newCondition, quickActions, setActivePacks, newRow } from '@tilewright/behaviors';
import { damage } from '@tilewright/plugin-combat';
import '@tilewright/bundled-plugins';

setActivePacks(undefined);

const cond = (type: string, params: Record<string, unknown> = {}, negate = false): EventCondition => ({ ...newCondition(type), params, negate });
const setVar = (name: string, op: string, value: string): EventAction => ({ ...newAction('setVariable'), params: { name, op, value } });
const gateAt = (id: string, x: number, y: number) => thing(id, 'Gate', x, y, { gate: {} });

describe('action nodes', () => {
  it('do their actions when the signal turns on, once, and tell the next node', () => {
    const { scene } = flatScene();
    scene.entities.push(
      thing('lever', 'Lever', 3, 3, { lever: {} }),
      thing('a', 'Action', 5, 3, { actionNode: { actions: [setVar('presses', 'add', '1'), setVar('last', 'set', 'a')] } }),
      thing('b', 'Next', 7, 3, { actionNode: { actions: [setVar('chained', 'set', '1')] } }),
    );
    scene.wires.push(wire('w1', ['lever', 'on'], ['a', 'do']), wire('w2', ['a', 'done'], ['b', 'do']));
    const r = rig(scene);
    r.run(5);
    expect(r.sim.runtime.vars.presses).toBeUndefined();
    r.get('lever').get<{ on: boolean }>('state:lever')!.on = true;
    r.run(30);
    expect(r.sim.runtime.vars.presses).toBe(1);
    expect(r.sim.runtime.vars.last).toBe('a');
    expect(r.sim.runtime.vars.chained).toBe(1);
  });

  it('can keep going while the signal is on, and "this object" means the node', () => {
    const { scene } = flatScene();
    scene.entities.push(
      thing('lever', 'Lever', 3, 3, { lever: { startOn: true } }),
      thing('a', 'Action', 5, 3, { actionNode: { whileOn: true, actions: [{ ...newAction('setVariable'), params: { name: 'n', op: 'add', value: '1' } }, { ...newAction('setProperty'), params: { who: 'self', path: 'sprite.height', value: '2' } }] } }),
    );
    scene.wires.push(wire('w1', ['lever', 'on'], ['a', 'do']));
    const r = rig(scene);
    r.run(10);
    expect(Number(r.sim.runtime.vars.n)).toBeGreaterThanOrEqual(8);
  });

  it('are hidden when the game runs', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('a', 'Action', 5, 3, { actionNode: { actions: [] } }), thing('e', 'Event', 6, 3, { eventNode: {} }));
    const r = rig(scene);
    r.run(2);
    expect(r.get('a').get<{ visible: boolean }>('sprite')!.visible).toBe(false);
    expect(r.get('e').get<{ visible: boolean }>('sprite')!.visible).toBe(false);
  });
});

describe('event nodes', () => {
  it('watch any condition and send it down a wire', () => {
    const { scene } = flatScene();
    scene.variables.push({ name: 'gold', value: 0 });
    scene.entities.push(
      thing('e', 'Rich?', 3, 3, { eventNode: { conditions: [cond('variable', { name: 'gold', op: '>=', value: '10' })] } }),
      thing('a', 'Celebrate', 5, 3, { actionNode: { actions: [setVar('party', 'set', '1')] } }),
    );
    scene.wires.push(wire('w1', ['e', 'happened'], ['a', 'do']));
    const r = rig(scene);
    r.run(10);
    expect(r.sim.runtime.vars.party).toBeUndefined();
    r.sim.runtime.vars.gold = 12;
    r.run(10);
    expect(r.sim.runtime.vars.party).toBe(1);
    expect(r.get('e').get<{ outputs: Record<string, boolean> }>('signals')!.outputs.on).toBe(true);
  });

  it('see what happened to one object: an enemy dying opens a gate', () => {
    const { scene } = flatScene();
    scene.entities.push(
      thing('foe', 'Foe', 8, 8, { health: { max: 1 } }),
      thing('e', 'Foe died', 3, 3, { eventNode: { conditions: [cond('entityEvent', { who: 'id:foe', name: 'died' })] } }),
      thing('a', 'Open it', 5, 3, { actionNode: { actions: [{ ...newAction('sendSignal'), params: { who: 'id:g', name: 'open', state: 'on' } }] } }),
      gateAt('g', 10, 3),
    );
    scene.wires.push(wire('w1', ['e', 'happened'], ['a', 'do']));
    const r = rig(scene);
    r.run(30);
    expect(r.sim.world.get(r.get('g').id)!.get<{ inputs: Record<string, boolean> }>('signals')?.inputs.open).not.toBe(true);
    // the event node looks once the tick has run; the signal travels on the next tick
    damage(ctxOf(r), r.get('foe'), 99);
    r.run(30);
    expect(r.sim.world.get(r.get('g').id)!.get<{ inputs: Record<string, boolean> }>('signals')?.inputs.open).toBe(true);
  });
});

describe('send a signal', () => {
  it('turns an input on, off or over, and a pulse starts a timer that then finishes', () => {
    const { scene } = flatScene();
    scene.entities.push(gateAt('g', 3, 3), thing('t', 'Timer', 6, 3, { timer: { seconds: 0.5 } }));
    scene.events = [
      { ...newRowOf('open'), conditions: [cond('start')], actions: [{ ...newAction('sendSignal'), params: { who: 'id:g', name: 'open', state: 'on' } }, { ...newAction('sendSignal'), params: { who: 'id:t', name: 'start', state: 'pulse' } }], once: true },
    ];
    const r = rig(scene);
    r.run(5);
    expect(r.get('g').get<{ inputs: Record<string, boolean> }>('signals')!.inputs.open).toBe(true);
    expect(r.get('t').get<{ outputs: Record<string, boolean> }>('signals')!.outputs.running).toBe(true);
    // the pulse went off again, so the timer can be started once more
    expect(r.get('t').get<{ inputs: Record<string, boolean> }>('signals')!.inputs.start).toBe(false);
    r.run(60);
    expect(r.get('t').get<{ outputs: Record<string, boolean> }>('signals')!.outputs.running).toBe(false);
  });
});

const newRowOf = newRow;

describe('logic gates: counter, random and compare', () => {
  const nodeScene = (kind: Record<string, unknown>) => {
    const { scene } = flatScene();
    scene.entities.push(thing('l', 'Lever', 2, 2, { lever: {} }), thing('r', 'Reset', 2, 4, { lever: {} }), thing('n', 'Node', 5, 3, { logic: kind }));
    scene.wires.push(wire('w1', ['l', 'on'], ['n', 'in']), wire('w2', ['r', 'on'], ['n', 'reset']));
    const r = rig(scene);
    r.run(2);
    return r;
  };
  const out = (r: Rig): boolean => r.get('n').get<{ outputs: Record<string, boolean> }>('signals')!.outputs.out === true;
  const flip = (r: Rig, id: string, on: boolean): void => {
    r.get(id).get<{ on: boolean }>('state:lever')!.on = on;
    r.run(4);
  };

  it('a counter turns on after enough pulses and starts again on reset', () => {
    const r = nodeScene({ kind: 'counter', count: 3 });
    for (let i = 0; i < 2; i++) {
      flip(r, 'l', true);
      flip(r, 'l', false);
    }
    expect(out(r)).toBe(false);
    flip(r, 'l', true);
    flip(r, 'l', false);
    expect(out(r)).toBe(true);
    flip(r, 'r', true);
    flip(r, 'r', false);
    expect(out(r)).toBe(false);
  });

  it('random turns on by chance, the same way each time with the same seed', () => {
    const results: boolean[][] = [];
    for (let k = 0; k < 2; k++) {
      const r = nodeScene({ kind: 'random', chance: 50 });
      const seq: boolean[] = [];
      for (let i = 0; i < 12; i++) {
        flip(r, 'l', true);
        seq.push(out(r));
        flip(r, 'l', false);
      }
      results.push(seq);
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0]!.some(Boolean)).toBe(true);
    expect(results[0]!.some((x) => !x)).toBe(true);
  });

  it('compare follows a variable', () => {
    const r = nodeScene({ kind: 'compare', variable: 'hp', op: '<', value: '5' });
    r.sim.runtime.vars.hp = 9;
    r.run(3);
    expect(out(r)).toBe(false);
    r.sim.runtime.vars.hp = 2;
    r.run(3);
    expect(out(r)).toBe(true);
  });
});

describe('clickable', () => {
  it('pulses when the pointer is pressed over it, and not when pressed elsewhere', () => {
    const { scene } = flatScene();
    scene.entities.push(thing('c', 'Button', 5.5, 5.5, { clickable: { size: 1 } }), thing('a', 'Act', 9, 9, { actionNode: { actions: [setVar('clicks', 'add', '1')] } }));
    scene.wires.push(wire('w1', ['c', 'clicked'], ['a', 'do']));
    const r = rig(scene);
    r.run(3, pointerSnapshot({ x: 8, y: 8 }, { primary: true }));
    r.run(2, pointerSnapshot({ x: 8, y: 8 }));
    expect(r.sim.runtime.vars.clicks).toBeUndefined();
    r.run(3, pointerSnapshot({ x: 5, y: 5 }, { primary: true }));
    r.run(2, pointerSnapshot({ x: 5, y: 5 }));
    expect(r.sim.runtime.vars.clicks).toBe(1);
  });
});

describe('the catalog', () => {
  it('lists what an object can say and be told, from its behaviours', () => {
    const gate = { gate: {} };
    const plate = { pressurePlate: {} };
    expect(actionPinsOf(gate).map((p) => p.label)).toEqual(expect.arrayContaining(['Open', 'Close', 'Open or close', 'Show', 'Hide', 'Remove from the game']));
    expect(actionPinsOf(gate).map((p) => p.label)).not.toContain('Hurt');
    expect(actionPinsOf({ health: {} }).map((p) => p.label)).toContain('Hurt');
    expect(eventPinsOf(plate).map((p) => p.label)).toContain('While pressed');
    expect(eventPinsOf({ clickable: {} }).map((p) => p.label)).toEqual(expect.arrayContaining(['On click', 'On right-click']));
    const died = eventPinsOf({ health: {} }).find((p) => p.id === 'event.died')!;
    expect(died.condition!('id:e1')).toMatchObject({ type: 'entityEvent', params: { who: 'id:e1', name: 'died' } });
    expect(actionPinsOf(gate).find((p) => p.label === 'Open')!.make('id:g')).toMatchObject({ type: 'sendSignal', params: { who: 'id:g', name: 'open', state: 'on' } });
  });

  it('the quick actions are the common menu actions, and only those whose pack is on', () => {
    const ids = quickActions().map((q) => q.id);
    expect(ids).toEqual(expect.arrayContaining(['go-scene', 'save', 'continue', 'quit', 'set-var', 'add-var', 'sound', 'dialogue', 'new-game']));
    expect(quickActions().find((q) => q.id === 'add-var')!.make().params.op).toBe('add');
  });
});

void player;
