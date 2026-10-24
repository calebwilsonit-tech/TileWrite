import { describe, expect, it } from 'vitest';
import { C, type EntityData, type TransformIso } from '@tilewright/runtime';
import { flatScene, player, rig, thing, type Rig } from '@tilewright/plugin-sdk/testing';
import { attachBehavior } from '@tilewright/behaviors';
import { healthOf } from '@tilewright/plugin-combat';
import { archerTree, checkTree, childrenOf, describeTreeAction, describeNode, guardTree, newTreeNode, wandererTree, type BehaviorTree, type TreeNode } from '@tilewright/behaviors';
import '@tilewright/bundled-plugins';

const BODY = { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 4, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null };

const pos = (r: Rig, id: string): { x: number; y: number } => {
  const t = r.get(id).get<TransformIso>(C.Transform)!;
  return { x: t.x, y: t.y };
};
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

function hero(x: number, y: number, hp = 5): EntityData {
  const p = player('p', x, y);
  attachBehavior(p.components, 'health');
  Object.assign(p.components.health as object, { max: hp, onDeath: 'respawn', invulnerableSeconds: 0.2 });
  return p;
}

function brain(tree: BehaviorTree, x = 5.5, y = 5.5, more: Record<string, object> = {}): EntityData {
  return thing('b', 'Brain', x, y, { behaviorTree: tree, vision: { range: 10, angle: 360, hearing: 0 }, health: { max: 3, onDeath: 'remove' }, ...more }, { body: BODY });
}

const N = (id: string, kind: TreeNode['type'], patch: object = {}): TreeNode => ({ ...newTreeNode(id, kind), ...patch }) as TreeNode;
const tree = (root: string, nodes: TreeNode[]): BehaviorTree => ({ target: 'player', root, nodes });
const trace = (r: Rig): Record<string, string> => r.get('b').get<{ trace: Record<string, string> }>('state:tree')!.trace;

describe('behaviour tree: the nodes', () => {
  const ok = N('ok', 'condition', { condition: { type: 'variable', name: 'yes', op: '=', value: true } });
  const no = N('no', 'condition', { condition: { type: 'variable', name: 'no', op: '=', value: true } });
  const setA = N('setA', 'action', { action: { type: 'setVariable', name: 'a', value: 1 } });
  const setB = N('setB', 'action', { action: { type: 'setVariable', name: 'b', value: 1 } });

  function run(nodes: TreeNode[], root: string, ticks = 3): Rig {
    const { scene } = flatScene();
    scene.variables.push({ name: 'yes', value: true }, { name: 'no', value: false }, { name: 'a', value: 0 }, { name: 'b', value: 0 });
    scene.entities.push(hero(15.5, 15.5), brain(tree(root, nodes)));
    const r = rig(scene);
    r.run(ticks);
    return r;
  }
  const vars = (r: Rig) => ({ a: r.sim.runtime.vars.a, b: r.sim.runtime.vars.b });

  it('a sequence does its children in order and stops at the first that fails', () => {
    expect(vars(run([N('s', 'sequence', { children: ['ok', 'setA', 'setB'] }), ok, setA, setB], 's'))).toEqual({ a: 1, b: 1 });
    expect(vars(run([N('s', 'sequence', { children: ['ok', 'no', 'setA'] }), ok, no, setA], 's'))).toEqual({ a: 0, b: 0 });
  });

  it('a selector tries its children until one works', () => {
    expect(vars(run([N('s', 'selector', { children: ['no', 'setA', 'setB'] }), no, setA, setB], 's'))).toEqual({ a: 1, b: 0 });
    const r = run([N('s', 'selector', { children: ['no', 'no2'] }), no, N('no2', 'condition', { condition: { type: 'variable', name: 'no', op: '=', value: true } })], 's');
    expect(r.get('b').get<{ last: string }>('state:tree')!.last).toBe('failure');
  });

  it('inverters flip yes and no, succeeders turn a no into a yes, and an empty decorator fails', () => {
    expect(vars(run([N('s', 'sequence', { children: ['inv', 'setA'] }), N('inv', 'inverter', { child: 'no' }), no, setA], 's')).a).toBe(1);
    expect(vars(run([N('s', 'sequence', { children: ['inv', 'setA'] }), N('inv', 'inverter', { child: 'ok' }), ok, setA], 's')).a).toBe(0);
    expect(vars(run([N('s', 'sequence', { children: ['su', 'setA'] }), N('su', 'succeeder', { child: 'no' }), no, setA], 's')).a).toBe(1);
    const r = run([N('d', 'inverter', { child: null })], 'd');
    expect(r.get('b').get<{ last: string }>('state:tree')!.last).toBe('failure');
  });

  it('a wait keeps the tree running for its time, and an interrupted wait starts again', () => {
    const wait = N('w', 'action', { action: { type: 'wait', seconds: 0.5 } });
    const r = run([N('s', 'sequence', { children: ['w', 'setA'] }), wait, setA], 's', 20);
    expect(vars(r).a).toBe(0);
    expect(r.get('b').get<{ last: string }>('state:tree')!.last).toBe('running');
    r.run(15);
    expect(vars(r).a).toBe(1);
    // interrupted by a higher priority branch: the wait forgets how long it waited
    const { scene } = flatScene();
    scene.variables.push({ name: 'busy', value: false }, { name: 'a', value: 0 });
    const nodes = [
      N('root', 'selector', { children: ['urgent', 'calm'] }),
      N('urgent', 'sequence', { children: ['isBusy', 'shout'] }),
      N('isBusy', 'condition', { condition: { type: 'variable', name: 'busy', op: '=', value: true } }),
      N('shout', 'action', { action: { type: 'wait', seconds: 5 } }),
      N('calm', 'sequence', { children: ['w', 'setA'] }),
      wait,
      setA,
    ];
    scene.entities.push(hero(15.5, 15.5), brain(tree('root', nodes)));
    const r2 = rig(scene);
    r2.run(20); // 0.33 s of the 0.5 s wait
    r2.sim.runtime.vars.busy = true;
    r2.run(30);
    r2.sim.runtime.vars.busy = false;
    r2.run(20); // another 0.33 s: not enough if it started again, plenty if it remembered
    expect(r2.sim.runtime.vars.a).toBe(0);
    r2.run(15);
    expect(r2.sim.runtime.vars.a).toBe(1);
  });

  it('instant actions happen once while the tree keeps asking, and again after being interrupted', () => {
    const say = N('say', 'action', { action: { type: 'say', text: 'Hello' } });
    const wait = N('w', 'action', { action: { type: 'wait', seconds: 1 } });
    const { scene } = flatScene();
    scene.entities.push(hero(15.5, 15.5), brain(tree('s', [N('s', 'sequence', { children: ['say', 'w'] }), say, wait])));
    const r = rig(scene);
    const messages: string[] = [];
    r.sim.events.on('message', (e) => void messages.push(String(e.text)));
    r.run(50);
    expect(messages).toEqual(['Hello']);
  });

  it('repeat runs its child again and again (or a number of times), and cooldown makes a branch rest after it runs', () => {
    const inc = N('inc', 'action', { action: { type: 'setVariable', name: 'a', value: 1 } });
    const rep = N('rep', 'repeat', { child: 'seq', count: 3 });
    const sq = N('seq', 'sequence', { children: ['inc', 'wait'] });
    const wait = N('wait', 'action', { action: { type: 'wait', seconds: 0.1 } });
    const r = run([rep, sq, inc, wait], 'rep', 60);
    expect(r.get('b').get<{ mem: Record<string, { rounds?: number }> }>('state:tree')!.mem.rep?.rounds).toBeGreaterThanOrEqual(1);
    // cooldown: the branch runs, then fails for the rest period
    const cd = N('cd', 'cooldown', { child: 'inc2', seconds: 1 });
    const inc2 = N('inc2', 'action', { action: { type: 'setVariable', name: 'b', value: 1 } });
    const r2 = run([cd, inc2], 'cd', 2);
    expect(r2.get('b').get<{ last: string }>('state:tree')!.last).toBe('failure');
    let succeeded = false;
    for (let i = 0; i < 70; i++) {
      r2.run(1);
      succeeded ||= r2.get('b').get<{ last: string }>('state:tree')!.last === 'success';
    }
    expect(succeeded).toBe(true); // after its rest it runs again
  });

  it('parallel runs every child each tick and finishes when all have', () => {
    const wait = N('w', 'action', { action: { type: 'wait', seconds: 0.2 } });
    const r = run([N('p', 'parallel', { children: ['setA', 'w', 'setB'] }), setA, wait, setB], 'p', 2);
    expect(vars(r)).toEqual({ a: 1, b: 1 });
    expect(r.get('b').get<{ last: string }>('state:tree')!.last).toBe('running');
    r.run(20);
    expect(r.get('b').get<{ last: string }>('state:tree')!.last).toBe('success');
  });

  it('a chance is rolled once and kept, and the same seed gives the same luck', () => {
    const roll = N('c', 'condition', { condition: { type: 'chance', percent: 50 } });
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const { scene } = flatScene();
      scene.entities.push(hero(15.5, 15.5), brain(tree('c', [roll])));
      const r = rig(scene, { seed });
      r.run(1);
      const first = r.get('b').get<{ last: string }>('state:tree')!.last;
      r.run(30);
      expect(r.get('b').get<{ last: string }>('state:tree')!.last).toBe(first); // no flicker
      const again = rig(scene, { seed });
      again.run(1);
      expect(again.get('b').get<{ last: string }>('state:tree')!.last).toBe(first);
      outcomes.add(first);
    }
    expect(outcomes.size).toBe(2); // sometimes yes, sometimes no
  });

  it('switching a behaviour off and on gates it, so a guard can be made harmless and dangerous again', () => {
    const { scene } = flatScene();
    const off = N('off', 'action', { action: { type: 'disable', behaviour: 'damageOnTouch' } });
    const on = N('on', 'action', { action: { type: 'enable', behaviour: 'damageOnTouch' } });
    const gate = N('g', 'condition', { condition: { type: 'variable', name: 'armed', op: '=', value: true } });
    scene.variables.push({ name: 'armed', value: false });
    const nodes = [N('root', 'selector', { children: ['arm', 'off'] }), N('arm', 'sequence', { children: ['g', 'on'] }), gate, on, off];
    scene.entities.push(hero(5.5, 5.5, 500), brain(tree('root', nodes), 5.5, 5.5, { damageOnTouch: { amount: 1, hurts: 'player', knockback: 0 } }));
    const r = rig(scene);
    r.run(60);
    expect(healthOf(r.get('p'))!.hp).toBe(500); // switched off
    expect(r.get('b').get<{ off: string[] }>('state:machineGate')!.off).toEqual(['damageOnTouch']);
    r.sim.runtime.vars.armed = true;
    r.run(60);
    expect(healthOf(r.get('p'))!.hp).toBeLessThan(500);
    expect(r.get('b').get<{ off: string[] }>('state:machineGate')!.off).toEqual([]);
  });
});

describe('behaviour tree: walking and examples', () => {
  function world(t: BehaviorTree, playerAt: [number, number], extra: Record<string, object> = {}): Rig {
    const { scene } = flatScene();
    scene.entities.push(hero(playerAt[0], playerAt[1]), brain(t, 5.5, 5.5, extra));
    return rig(scene);
  }

  it('the guard example wanders near home, chases what it sees, then looks around and goes home', () => {
    const r = world(guardTree(), [20.5, 20.5], { vision: { range: 5, angle: 360, hearing: 0 } });
    r.run(240);
    const wandered = pos(r, 'b');
    expect(dist(wandered, { x: 5.5, y: 5.5 })).toBeLessThan(5);
    // the player comes into view: it chases and reaches them
    const pt = r.get('p').get<TransformIso>(C.Transform)!;
    pt.x = 9.5;
    pt.y = 5.5;
    r.run(80);
    expect(dist(pos(r, 'b'), { x: 9.5, y: 5.5 })).toBeLessThan(1.6);
    expect(['running', 'success']).toContain(trace(r).chase);
    // the player vanishes: it looks around, then walks home
    pt.x = 20.5;
    pt.y = 20.5;
    r.run(30);
    expect(trace(r).look).toBe('running');
    r.run(400);
    expect(dist(pos(r, 'b'), { x: 5.5, y: 5.5 })).toBeLessThan(4);
  });

  it('the archer example backs away when the player is close and follows when far', () => {
    const near = world(archerTree(), [7.5, 5.5], { vision: { range: 12, angle: 360, hearing: 0 } });
    near.run(60);
    expect(dist(pos(near, 'b'), pos(near, 'p'))).toBeGreaterThan(3);
    const far = world(archerTree(), [22.5, 5.5], { vision: { range: 30, angle: 360, hearing: 0 } });
    const before = dist(pos(far, 'b'), pos(far, 'p'));
    far.run(80);
    expect(dist(pos(far, 'b'), pos(far, 'p'))).toBeLessThan(before - 2);
  });

  it('the wanderer example flees when hurt', () => {
    const r = world(wandererTree(), [6.5, 5.5]);
    r.run(2);
    r.get('b').get<{ hp: number }>('state:health')!.hp = 1; // below half of 3
    r.run(60);
    expect(dist(pos(r, 'b'), pos(r, 'p'))).toBeGreaterThan(3);
  });
});

describe('behaviour tree: checking and describing', () => {
  it('says what is wrong in plain English', () => {
    expect(checkTree({ target: 'player', root: '', nodes: [] })).toEqual(['It has no nodes yet.']);
    expect(checkTree({ target: 'player', root: 'x', nodes: [N('a', 'sequence', { children: [] })] })[0]).toMatch(/starts from "x"/);
    const bad = checkTree(
      tree('s', [
        N('s', 'sequence', { children: ['c', 'v', 'loop', 'ghost'] }),
        N('c', 'condition', { condition: { type: 'variable', name: '', op: '>=', value: 1 } }),
        N('v', 'action', { action: { type: 'disable', behaviour: 'flying' } }),
        N('loop', 'inverter', { child: 's' }),
        N('empty', 'selector', { children: [] }),
      ]),
      (b) => b === 'patrol',
    ).join('\n');
    expect(bad).toMatch(/checks a variable but no variable is chosen/);
    expect(bad).toMatch(/behaviour "flying", which this object does not have/);
    expect(bad).toMatch(/leads back to itself/);
    expect(bad).toMatch(/has a child that does not exist/);
    expect(bad).toMatch(/not connected to the tree/);
    expect(checkTree(guardTree())).toEqual([]);
    expect(checkTree(archerTree(), () => true)).toEqual([]);
    expect(checkTree(wandererTree())).toEqual([]);
  });

  it('catches a node used in two places and a missing child', () => {
    const t = tree('s', [N('s', 'selector', { children: ['a', 'b'] }), N('a', 'inverter', { child: 'x' }), N('b', 'inverter', { child: 'x' }), N('x', 'action', { action: { type: 'stop' } }), N('d', 'repeat', { child: null })]);
    const text = checkTree(t).join('\n');
    expect(text).toMatch(/used in more than one place/);
    expect(text).toMatch(/not connected/);
  });

  it('describes nodes the way a person would', () => {
    expect(describeNode(N('a', 'action', { action: { type: 'wait', seconds: 2 } }))).toBe('wait 2 s');
    expect(describeNode(N('a', 'selector', { name: 'Boss brain' }))).toBe('Boss brain');
    expect(describeNode(N('c', 'condition', { condition: { type: 'near', cells: 4 } }))).toBe('If its target is within 4 cells');
    expect(describeNode(N('r', 'repeat', { count: 0 }))).toBe('Repeat forever');
    expect(describeTreeAction({ type: 'setVariable', name: 'mood', value: 'angry' })).toBe('set mood to angry');
    expect(childrenOf(N('s', 'sequence', { children: ['a', 'b'] }))).toEqual(['a', 'b']);
    expect(childrenOf(N('i', 'inverter', { child: 'a' }))).toEqual(['a']);
    expect(childrenOf(N('x', 'action'))).toEqual([]);
  });
});
