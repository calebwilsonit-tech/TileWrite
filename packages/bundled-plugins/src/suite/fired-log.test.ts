import { describe, expect, it } from 'vitest';
import { flatScene, player, rig, thing } from '@tilewright/plugin-sdk/testing';
import { firedKind, firedLog, newAction, newCondition, newMachineState, newRow, newTreeNode, FIRED_LOG_LIMIT, type BehaviorTree, type StateMachine, type TreeNode } from '@tilewright/behaviors';
import '@tilewright/bundled-plugins';

const BODY = { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 4, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null };

const N = (id: string, kind: TreeNode['type'], patch: object = {}): TreeNode => ({ ...newTreeNode(id, kind), ...patch }) as TreeNode;

describe('one record of what fired, whatever kind of logic it was', () => {
  it('names the kind from the way the id is written', () => {
    expect(firedKind('g:graph1:node2#ran')).toBe('graph');
    expect(firedKind('e:wire-node')).toBe('wire');
    expect(firedKind('m:guard:chase')).toBe('machine');
    expect(firedKind('t:guard:n3')).toBe('tree');
    expect(firedKind('row7')).toBe('row');
  });

  it('has event rows, state machines and behaviour trees in the same list, in the order they fired', () => {
    const { scene } = flatScene();
    scene.variables.push({ name: 'gold', value: 0 });
    scene.events = [{ ...newRow('r1'), conditions: [newCondition('sceneStart')], actions: [newAction('setVariable')], once: true }];
    const machine: StateMachine = {
      target: 'player',
      start: 'a',
      states: [{ ...newMachineState('a', 'Idle'), behaviours: [] }, { ...newMachineState('b', 'Alert'), behaviours: [] }],
      transitions: [{ id: 't', from: 'a', to: 'b', when: { type: 'time', seconds: 0.5 } }],
    };
    const tree: BehaviorTree = { target: 'player', root: 'seq', nodes: [N('seq', 'sequence', { children: ['say'] }), N('say', 'action', { action: { type: 'say', text: 'Hm.' } })] };
    scene.entities.push(player('p', 20.5, 20.5), thing('m', 'Guard', 5.5, 5.5, { stateMachine: machine }, { body: BODY }), thing('t', 'Thinker', 8.5, 8.5, { behaviorTree: tree }, { body: BODY }));
    const r = rig(scene);
    r.run(60);
    const log = firedLog(r.sim);
    const kinds = new Set(log.map((e) => e.kind));
    expect(kinds.has('row')).toBe(true);
    expect(kinds.has('machine')).toBe(true);
    expect(kinds.has('tree')).toBe(true);
    const change = log.find((e) => e.kind === 'machine')!;
    expect(change.what).toContain('goes from "a" to "Alert"');
    expect(change.tick).toBeGreaterThan(20); // after half a second, not at the start
    const asked = log.filter((e) => e.kind === 'tree');
    expect(asked).toHaveLength(1); // an action that keeps running is noted when it starts, not every step
    expect(asked[0]!.what).toContain('starts:');
    // newest last
    for (let i = 1; i < log.length; i++) expect(log[i]!.tick).toBeGreaterThanOrEqual(log[i - 1]!.tick);
  });

  it('stops the game at a state or a tree action that has a breakpoint, as it does at an event row', () => {
    const { scene } = flatScene();
    const machine: StateMachine = {
      target: 'player',
      start: 'a',
      states: [{ ...newMachineState('a', 'Idle'), behaviours: [] }, { ...newMachineState('b', 'Alert'), behaviours: [], breakpoint: true }],
      transitions: [{ id: 't', from: 'a', to: 'b', when: { type: 'time', seconds: 0.2 } }],
    };
    const tree: BehaviorTree = { target: 'player', root: 'say', nodes: [N('say', 'action', { action: { type: 'say', text: 'Hm.' }, breakpoint: true })] };
    scene.entities.push(player('p', 20.5, 20.5), thing('m', 'Guard', 5.5, 5.5, { stateMachine: machine }, { body: BODY }), thing('t', 'Thinker', 8.5, 8.5, { behaviorTree: tree }, { body: BODY }));
    const r = rig(scene);
    const hits: string[] = [];
    r.sim.events.on('logic-break', (e) => hits.push(String(e.text)));
    r.run(40);
    expect(hits).toHaveLength(2);
    expect(hits.some((h) => h.includes('(state machine)') && h.includes('"Alert"'))).toBe(true);
    expect(hits.some((h) => h.includes('(behaviour tree)'))).toBe(true);
  });

  it('keeps only the newest few hundred', () => {
    const { scene } = flatScene();
    scene.events = [{ ...newRow('r1'), conditions: [newCondition('always')], actions: [newAction('setVariable')], once: false }];
    const r = rig(scene);
    r.run(FIRED_LOG_LIMIT + 50);
    expect(firedLog(r.sim).length).toBe(FIRED_LOG_LIMIT);
  });
});
