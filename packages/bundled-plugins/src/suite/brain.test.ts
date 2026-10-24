import { describe, expect, it } from 'vitest';
import { C, facingOfGridDir, type TransformIso } from '@tilewright/runtime';
import { flatScene, player, rig, thing, type Rig } from '@tilewright/plugin-sdk/testing';
import { attachBehavior, setInput } from '@tilewright/behaviors';
import {
  bossMachine,
  checkMachine,
  describeMachineCondition,
  gatedBehaviours,
  guardMachine,
  newMachineCondition,
  newMachineState,
  type MachineCondition,
  type StateMachine,
} from '@tilewright/plugin-ai';
import '@tilewright/bundled-plugins';

const body = { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 4, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null };

function guard(machine: StateMachine, extras: Record<string, object> = {}, at: [number, number] = [5.5, 5.5], patrolling = true) {
  const g = thing('g', 'Guard', at[0], at[1], { health: { max: 4, onDeath: 'stay' }, vision: { range: 7, angle: 100, hearing: 0 }, ...(patrolling ? { patrol: { points: '5.5,5.5; 5.5,9.5', speed: 3, waitSeconds: 0 } } : {}), stateMachine: machine, ...extras }, { body: { ...body } });
  (g.components.transform as TransformIso).facing = facingOfGridDir(1, 0);
  return g;
}

const x = (r: Rig, id: string): number => r.get(id).get<TransformIso>(C.Transform)!.x;
const y = (r: Rig, id: string): number => r.get(id).get<TransformIso>(C.Transform)!.y;
const stateName = (r: Rig): string => {
  const rt = r.get('g').get<{ current: string }>('state:machine');
  return rt?.current ?? '';
};
const states = (r: Rig): string[] => {
  const seen: string[] = [];
  r.sim.events.on('state-changed', (e) => seen.push(String(e.to)));
  return seen;
};

function two(when: MachineCondition, extra: Partial<StateMachine['states'][number]> = {}): StateMachine {
  return {
    target: 'player',
    start: 'a',
    states: [{ ...newMachineState('a', 'Idle'), behaviours: [] }, { ...newMachineState('b', 'Walk'), behaviours: ['patrol'], ...extra }],
    transitions: [{ id: 't', from: 'a', to: 'b', when }],
  };
}

describe('state machine: switching behaviours on and off', () => {
  it('a behaviour that the current state does not list is switched off, and comes back when a state lists it', () => {
    const { scene } = flatScene();
    scene.entities.push(player('p', 20.5, 20.5), guard(two({ type: 'time', seconds: 1 })));
    const r = rig(scene);
    r.run(40);
    expect(stateName(r)).toBe('a');
    expect(y(r, 'g')).toBeCloseTo(5.5, 5); // patrol is off in "Idle": it stands still
    r.run(40);
    expect(stateName(r)).toBe('b');
    r.run(40);
    expect(y(r, 'g')).toBeGreaterThan(6); // patrol is on in "Walk"
  });

  it('behaviours no state mentions are never touched, and a machine with no states changes nothing', () => {
    const empty: StateMachine = { target: 'player', start: '', states: [], transitions: [] };
    const { scene } = flatScene();
    scene.entities.push(player('p', 20.5, 20.5), guard(empty));
    const r = rig(scene);
    r.run(60);
    expect(y(r, 'g')).toBeGreaterThan(6); // patrol runs as it always did
    expect(r.get('g').get('state:machineGate')).toBeUndefined();
    expect(gatedBehaviours(two({ type: 'always' }), 'a')).toEqual(['patrol']);
    expect(gatedBehaviours(two({ type: 'always' }), 'b')).toEqual([]);
  });

  it('a moving guard stops dead when a state takes its behaviours away', () => {
    const { scene } = flatScene();
    const m: StateMachine = {
      target: 'player',
      start: 'walk',
      states: [{ ...newMachineState('walk', 'Walk'), behaviours: ['patrol'] }, { ...newMachineState('rest', 'Rest'), behaviours: [] }],
      transitions: [{ id: 't', from: 'walk', to: 'rest', when: { type: 'time', seconds: 0.5 } }],
    };
    scene.entities.push(player('p', 20.5, 20.5), guard(m));
    const r = rig(scene);
    r.run(60);
    const at = y(r, 'g');
    r.run(60);
    expect(y(r, 'g')).toBeCloseTo(at, 2);
    expect(r.get('g').get<{ vx: number; vy: number }>(C.Body)).toMatchObject({ vx: 0, vy: 0 });
  });
});

describe('state machine: conditions', () => {
  const run = (when: MachineCondition, setup?: (r: Rig) => void, ticks = 5, scene = flatScene().scene, extras: Record<string, object> = {}): Rig => {
    scene.entities.push(player('p', 9.5, 5.5), guard(two(when), extras));
    const r = rig(scene);
    setup?.(r);
    r.run(ticks);
    return r;
  };

  it('"it sees its target" fires when the target is in view, not before', () => {
    expect(stateName(run({ type: 'sees' }))).toBe('b');
    const far = flatScene().scene;
    far.entities.push(player('p', 20.5, 20.5), guard(two({ type: 'sees' })));
    const r = rig(far);
    r.run(10);
    expect(stateName(r)).toBe('a');
  });

  it('near and far compare the distance to the nearest target', () => {
    expect(stateName(run({ type: 'near', cells: 5 }))).toBe('b'); // the player is 4 cells away
    expect(stateName(run({ type: 'near', cells: 2 }))).toBe('a');
    expect(stateName(run({ type: 'far', cells: 2 }))).toBe('b');
    expect(stateName(run({ type: 'far', cells: 8 }))).toBe('a');
  });

  it('health fires at or below the percentage', () => {
    const r = run({ type: 'health', percent: 50 });
    expect(stateName(r)).toBe('a');
    const s = flatScene().scene;
    s.entities.push(player('p', 20.5, 20.5), guard(two({ type: 'health', percent: 50 })));
    const r2 = rig(s);
    (r2.get('g').get('state:health') as { hp: number } | undefined);
    r2.run(2);
    (r2.get('g').get('state:health') as { hp: number }).hp = 2; // half of 4
    r2.run(3);
    expect(stateName(r2)).toBe('b');
  });

  it('variable, signal, time and defeated', () => {
    expect(stateName(run({ type: 'variable', name: 'alarm', op: '>=', value: 1 }, (r) => (r.sim.runtime.vars.alarm = 1)))).toBe('b');
    expect(stateName(run({ type: 'variable', name: 'alarm', op: '>=', value: 1 }))).toBe('a');
    const s = flatScene().scene;
    s.entities.push(player('p', 20.5, 20.5), guard(two({ type: 'signal' })));
    const r = rig(s);
    r.run(5);
    expect(stateName(r)).toBe('a');
    setInput(r.get('g'), 'trigger', true);
    r.run(2);
    expect(stateName(r)).toBe('b');
    expect(stateName(run({ type: 'time', seconds: 0.2 }, undefined, 30))).toBe('b');
    const d = flatScene().scene;
    d.entities.push(player('p', 20.5, 20.5), guard(two({ type: 'defeated' })));
    const r3 = rig(d);
    r3.run(3);
    (r3.get('g').get('state:health') as { dead: boolean }).dead = true;
    r3.run(3);
    expect(stateName(r3)).toBe('b');
  });

  it('"lost" counts the time since the target was last seen or heard', () => {
    const s = flatScene().scene;
    const m: StateMachine = {
      target: 'player',
      start: 'a',
      states: [newMachineState('a', 'Watch'), newMachineState('b', 'Gave up')],
      transitions: [{ id: 't', from: 'a', to: 'b', when: { type: 'lost', seconds: 1 } }],
    };
    s.entities.push(player('p', 9.5, 5.5), guard(m, {}, [5.5, 5.5], false));
    const r = rig(s);
    r.run(40);
    expect(stateName(r)).toBe('a'); // it sees the player the whole time
    r.get('p').get<TransformIso>(C.Transform)!.x = 1.5; // behind it
    r.run(30);
    expect(stateName(r)).toBe('a'); // not a whole second yet
    r.run(60);
    expect(stateName(r)).toBe('b');
  });

  it('the first transition that holds wins, "from any state" applies everywhere, and chains settle in one tick', () => {
    const s = flatScene().scene;
    const m: StateMachine = {
      target: 'player',
      start: 'a',
      states: [newMachineState('a', 'A'), newMachineState('b', 'B'), newMachineState('c', 'C')],
      transitions: [
        { id: '1', from: 'a', to: 'b', when: { type: 'always' } },
        { id: '2', from: 'b', to: 'c', when: { type: 'always' } },
        { id: '3', from: '*', to: 'a', when: { type: 'variable', name: 'reset', op: '=', value: 1 } },
      ],
    };
    s.entities.push(player('p', 20.5, 20.5), guard(m));
    const r = rig(s);
    const seen = states(r);
    r.run(2);
    expect(stateName(r)).toBe('c');
    expect(seen.slice(0, 2)).toEqual(['b', 'c']);
    r.sim.runtime.vars.reset = 1;
    r.run(1);
    expect(seen).toContain('a');
  });
});

describe('state machine: what a state does', () => {
  it('moves toward the target, away from it, and home, and says when it arrived', () => {
    const toward = flatScene().scene;
    const m = (move: 'toward' | 'away' | 'home'): StateMachine => ({
      target: 'player',
      start: 'a',
      states: [{ ...newMachineState('a', 'Go'), move, speed: 3 }, newMachineState('b', 'There')],
      transitions: [{ id: 't', from: 'a', to: 'b', when: { type: 'arrived' } }],
    });
    toward.entities.push(player('p', 11.5, 5.5), guard(m('toward'), { patrol: { points: '5.5,5.5', speed: 1, waitSeconds: 0 } }));
    const r = rig(toward);
    r.run(120);
    expect(x(r, 'g')).toBeGreaterThan(9); // walked toward the player
    expect(stateName(r)).toBe('b'); // and arrived
    const away = flatScene().scene;
    away.entities.push(player('p', 7.5, 5.5), guard(m('away'), { patrol: { points: '5.5,5.5', speed: 1, waitSeconds: 0 } }));
    const r2 = rig(away);
    r2.run(60);
    expect(x(r2, 'g')).toBeLessThan(5.3); // backed off from the player on its right
  });

  it('plays the animation, shows the message, asks for the sound and announces the change on entering', () => {
    const s = flatScene().scene;
    const m = two({ type: 'time', seconds: 0.1 }, { anim: 'run', message: 'Over here!', sound: 'alarm' });
    s.entities.push(player('p', 20.5, 20.5), guard(m, {}, [5.5, 5.5]));
    const g = s.entities[1]!;
    g.components.animator = { asset: '', clip: 'idle', time: 0, playing: true, speed: 1 };
    const r = rig(s);
    const messages: string[] = [];
    const changes: Record<string, unknown>[] = [];
    r.sim.events.on('message', (e) => messages.push(String(e.text)));
    r.sim.events.on('state-changed', (e) => changes.push(e));
    r.run(20);
    expect(messages).toContain('Over here!');
    expect(r.sim.runtime.fx).toContainEqual({ kind: 'sound', name: 'alarm' });
    expect(changes[0]).toMatchObject({ from: 'a', to: 'b', name: 'Walk' });
    expect((r.get('g').get('animator') as { clip: string }).clip).toBe('run');
  });
});

describe('state machine: the examples and the checker', () => {
  it('the Guard example patrols, chases what it sees, looks around, goes back and patrols again', () => {
    const s = flatScene().scene;
    s.entities.push(player('p', 9.5, 5.5), guard(guardMachine(), { chase: { speed: 3 } }));
    const r = rig(s);
    const seen = states(r);
    r.run(30);
    expect(stateName(r)).toBe('chase');
    // the player vanishes into the distance and stands still
    r.get('p').get<TransformIso>(C.Transform)!.x = 20.5;
    r.get('p').get<TransformIso>(C.Transform)!.y = 20.5;
    r.run(60 * 12);
    expect(seen).toContain('search');
    expect(seen).toContain('back');
    expect(seen).toContain('patrol');
    expect(checkMachine(guardMachine(), () => true)).toEqual([]);
    expect(checkMachine(bossMachine(), () => true)).toEqual([]);
  });

  it('finds mistakes in plain English', () => {
    const base = guardMachine();
    expect(checkMachine({ ...base, states: [], transitions: [] })).toEqual(['It has no states yet.']);
    expect(checkMachine({ ...base, start: 'nowhere' })[0]).toMatch(/starts in "nowhere"/);
    const broken: StateMachine = {
      ...base,
      transitions: [...base.transitions, { id: 'x', from: 'patrol', to: 'ghost', when: { type: 'always' } }, { id: 'y', from: 'gone', to: 'patrol', when: { type: 'variable', name: '', op: '=', value: 1 } }],
    };
    const text = checkMachine(broken).join('\n');
    expect(text).toMatch(/goes to a state that does not exist/);
    expect(text).toMatch(/starts at a state that does not exist/);
    expect(text).toMatch(/no variable is chosen/);
    const lonely: StateMachine = { ...base, states: [...base.states, newMachineState('island', 'Island')] };
    const lonelyText = checkMachine(lonely).join('\n');
    expect(lonelyText).toMatch(/"Island" can never be reached/);
    expect(lonelyText).toMatch(/"Island" has no way out/);
    expect(checkMachine(base, (b) => b !== 'patrol').join('\n')).toMatch(/uses the behaviour "patrol", which this object does not have/);
    const loop: StateMachine = { ...base, transitions: [...base.transitions, { id: 'z', from: 'chase', to: 'chase', when: { type: 'always' } }] };
    expect(checkMachine(loop).join('\n')).toMatch(/loops on itself forever/);
  });

  it('describes conditions in words', () => {
    expect(describeMachineCondition(newMachineCondition('sees'))).toBe('it sees its target');
    expect(describeMachineCondition({ type: 'lost', seconds: 2 })).toBe('it has lost its target for 2 s');
    expect(describeMachineCondition({ type: 'health', percent: 25 })).toBe('its health is 25% or less');
    expect(describeMachineCondition(newMachineCondition('variable'))).toBe('(variable) >= 1');
  });

  it('the behaviour can be added like any other', () => {
    const c: Record<string, unknown> = {};
    attachBehavior(c, 'stateMachine');
    expect(c.stateMachine).toMatchObject({ target: 'player', states: [], transitions: [] });
  });
});
