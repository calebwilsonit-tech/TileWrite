import { describe, expect, it } from 'vitest';
import { Simulation, loadScene, newScene, physicsSystem, type EntityData, type GraphData } from '@tilewright/runtime';
import { ACTIONS, CONDITIONS, actionPinsOf, addStandardSystems, eventPinsOf, newAction, setActivePacks } from '@tilewright/behaviors';
import { EditorDoc } from './doc';
import { addLink, addNode, boxChoices, canLink, collapseToFunction, newGraph, openAsGraph, removeNodes, searchBoxes, targetChoices, updateNode } from './graph-edit';
import { addQuickAction, ownedNodes } from './logic-edit';
import { applyFix } from './logic-fix';
import { validateScene } from './validate';

setActivePacks(undefined);

const setVar = (name: string, value: string) => ({ ...newAction('setVariable'), params: { name, op: 'set', value } });

function twoBoxes(): { graphs: GraphData[]; id: string; a: string; b: string } {
  const made = newGraph([], 'Test');
  const e = addNode(made.graphs, made.id, 'event', 0, 0);
  const a = addNode(e.graphs, made.id, 'action', 200, 0, { action: setVar('x', '1') });
  return { graphs: a.graphs, id: made.id, a: e.id, b: a.id };
}

describe('editing a graph', () => {
  it('adds boxes and joins them with lines', () => {
    const { graphs, id, a, b } = twoBoxes();
    const linked = addLink(graphs, id, a, 'out', b);
    expect(linked[0]!.links).toEqual([{ from: { node: a, pin: 'out' }, to: { node: b, pin: 'in' } }]);
    expect(linked[0]!.nodes).toHaveLength(2);
  });

  it('refuses lines that make no sense, and says why', () => {
    const { graphs, id, a, b } = twoBoxes();
    const g = addLink(graphs, id, a, 'out', b)[0]!;
    expect(canLink(g, b, 'out', a)).toContain('starts a flow'); // nothing leads into an event
    expect(canLink(g, a, 'out', a)).toContain('itself');
    expect(canLink(g, a, 'out', b)).toContain('already');
    expect(canLink(g, a, 'nope', b)).toContain('no "nope" output');
    const c = addNode([g], id, 'action', 400, 0);
    const g2 = addLink(c.graphs, id, b, 'out', c.id)[0]!;
    expect(canLink(g2, c.id, 'out', b)).toContain('circle');
  });

  it('removes a box with its lines, and edits its settings', () => {
    const { graphs, id, a, b } = twoBoxes();
    const linked = addLink(graphs, id, a, 'out', b);
    const edited = updateNode(linked, id, b, (n) => (n.breakpoint = true));
    expect(edited[0]!.nodes.find((n) => n.id === b)!.breakpoint).toBe(true);
    const gone = removeNodes(edited, id, [b]);
    expect(gone[0]!.nodes).toHaveLength(1);
    expect(gone[0]!.links).toHaveLength(0);
  });

  it('collapses boxes into a function and puts a call in their place, and it still does the same thing', () => {
    let graphs: GraphData[] = [];
    const made = newGraph(graphs, 'Main');
    graphs = made.graphs;
    const id = made.id;
    const ev = addNode(graphs, id, 'event', 0, 0, { conditions: [{ type: 'start', params: {}, negate: false }], mode: 'all', once: true });
    const one = addNode(ev.graphs, id, 'action', 200, 0, { action: setVar('one', '1') });
    const two = addNode(one.graphs, id, 'action', 400, 0, { action: setVar('two', '2') });
    const after = addNode(two.graphs, id, 'action', 600, 0, { action: setVar('after', '3') });
    let g = addLink(after.graphs, id, ev.id, 'out', one.id);
    g = addLink(g, id, one.id, 'out', two.id);
    g = addLink(g, id, two.id, 'out', after.id);
    const collapsed = collapseToFunction(g, id, [one.id, two.id], 'Setup');
    expect(collapsed.problem).toBeUndefined();
    expect(collapsed.graphs).toHaveLength(2);
    const main = collapsed.graphs.find((x) => x.id === id)!;
    expect(main.nodes.map((n) => n.type).sort()).toEqual(['action', 'call', 'event']);
    const fn = collapsed.graphs.find((x) => x.id === collapsed.functionId)!;
    expect(fn.nodes.map((n) => n.type).sort()).toEqual(['action', 'action', 'function']);

    const doc = EditorDoc.fromScene({ ...newScene('T', 8, 8) });
    doc.setGraphs('x', collapsed.graphs);
    const sim = new Simulation(1);
    loadScene(sim, doc.toScene());
    addStandardSystems(sim, physicsSystem);
    for (let i = 0; i < 5; i++) sim.step({});
    expect(sim.runtime.vars).toMatchObject({ one: 1, two: 2, after: 3 });
  });

  it('says why a selection cannot be collapsed', () => {
    const { graphs, id, a } = twoBoxes();
    expect(collapseToFunction(graphs, id, [a], 'F').problem).toContain('cannot be collapsed');
    expect(collapseToFunction(graphs, id, [], 'F').problem).toContain('Select');
  });
});

describe('the box picker', () => {
  it('finds boxes as you type, by any words in the name', () => {
    const choices = boxChoices(ACTIONS, CONDITIONS);
    expect(searchBoxes(choices, 'variable').some((c) => c.label.startsWith('Do: Change a variable'))).toBe(true);
    expect(searchBoxes(choices, 'do variable')[0]!.label.startsWith('Do:')).toBe(true);
    expect(searchBoxes(choices, 'wait')[0]!.label).toContain('Wait');
    expect(searchBoxes(choices, 'zzzzzz')).toEqual([]);
    expect(searchBoxes(choices, '').length).toBeGreaterThan(5);
  });

  it('offers only what is valid for the chosen object', () => {
    const gate: EntityData = { id: 'e1', name: 'Gate', tags: [], components: { transform: { x: 1, y: 1, h: 0, facing: 2 }, gate: {} } };
    const labels = targetChoices(gate).map((c) => c.label);
    expect(labels).toContain('Gate: Open');
    expect(labels.some((l) => l.includes('Hurt'))).toBe(false);
    expect(targetChoices(gate).find((c) => c.label === 'Gate: Open')!.make().params.action).toMatchObject({ type: 'sendSignal', params: { who: 'id:e1' } });
  });
});

describe('from quick actions to a graph', () => {
  function build(): { doc: EditorDoc; button: EntityData } {
    const doc = EditorDoc.fromScene(newScene('T', 16, 16));
    const [button] = doc.addEntities([{ name: 'Button', tags: [], components: { transform: { x: 3, y: 3, h: 0, facing: 2 }, sprite: { shape: 'box', color: 1, w: 1, d: 1, height: 1, sortOffset: 0, visible: true }, clickable: { size: 1 } } }]);
    return { doc, button: button! };
  }

  it('the nodes are replaced by one graph that does the same thing', () => {
    const { doc, button } = build();
    const pin = eventPinsOf(button.components).find((p) => p.label === 'On click')!;
    addQuickAction(doc, button.id, pin, setVar('clicked', '1'));
    addQuickAction(doc, button.id, pin, setVar('twice', '2'));
    const id = openAsGraph(doc, button.id, pin.id)!;
    expect(ownedNodes(doc, button.id)).toHaveLength(0);
    expect(doc.wires).toHaveLength(0);
    const g = doc.graphs.find((x) => x.id === id)!;
    expect(g.nodes.map((n) => n.type)).toEqual(['event', 'action', 'action']);
    const sim = new Simulation(1);
    loadScene(sim, doc.toScene());
    addStandardSystems(sim, physicsSystem);
    for (let i = 0; i < 3; i++) sim.step({});
    expect(sim.runtime.vars.clicked).toBeUndefined();
    for (let i = 0; i < 3; i++) sim.step({ pointer_cx: 4, pointer_cy: 4, pointer_primary: 1 });
    for (let i = 0; i < 3; i++) sim.step({ pointer_cx: 4, pointer_cy: 4 });
    expect(sim.runtime.vars).toMatchObject({ clicked: 1, twice: 2 });
    doc.undo();
    expect(doc.graphs).toHaveLength(0);
    expect(ownedNodes(doc, button.id)).toHaveLength(1);
  });
});

describe('one-click fixes', () => {
  it('removes a wire to nothing, an action on a deleted object, and a line to a deleted box', () => {
    const doc = EditorDoc.fromScene(newScene('T', 16, 16));
    const mk = (name: string, c: Record<string, unknown>) => ({ name, tags: [], components: { transform: { x: 3, y: 3, h: 0, facing: 2 }, sprite: { shape: 'box', color: 1, w: 1, d: 1, height: 1, sortOffset: 0, visible: true }, ...c } });
    const [button, gate] = doc.addEntities([mk('Button', { clickable: { size: 1 } }), mk('Gate', { gate: {} })]);
    const pin = eventPinsOf(button!.components).find((p) => p.label === 'On click')!;
    addQuickAction(doc, button!.id, pin, actionPinsOf(gate!.components).find((p) => p.label === 'Open')!.make(`id:${gate!.id}`));
    doc.removeEntities([gate!.id]);
    const problems = validateScene(doc).filter((p) => p.fix);
    expect(problems.map((p) => p.fix!.kind)).toContain('remove-action');
    applyFix(doc, problems.find((p) => p.fix!.kind === 'remove-action')!.fix!);
    expect(validateScene(doc).filter((p) => p.message.includes('no longer exists'))).toEqual([]);

    const g = newGraph([], 'G');
    const e = addNode(g.graphs, g.id, 'event', 0, 0);
    const withLink = e.graphs.map((x) => ({ ...x, links: [{ from: { node: e.id, pin: 'out' }, to: { node: 'ghost', pin: 'in' } }] }));
    doc.setGraphs('add', withLink);
    const lineProblem = validateScene(doc).find((p) => p.fix?.kind === 'remove-graph-link')!;
    expect(lineProblem).toBeDefined();
    applyFix(doc, lineProblem.fix!);
    expect(doc.graphs[0]!.links).toHaveLength(0);
    expect(validateScene(doc).some((p) => p.fix?.kind === 'remove-graph-link')).toBe(false);
  });
});
