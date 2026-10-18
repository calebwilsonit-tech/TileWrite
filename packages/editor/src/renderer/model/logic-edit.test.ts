import { describe, expect, it } from 'vitest';
import { Simulation, loadScene, newScene, physicsSystem, type EntityData } from '@tilewright/runtime';
import { actionPinsOf, addStandardSystems, eventPinsOf, newAction, setActivePacks } from '@tilewright/behaviors';
import { EditorDoc } from './doc';
import { actionNodeFor, addQuickAction, connectToTarget, eventNodeFor, moveQuickAction, ownedNodes, removeQuickAction, usedPins } from './logic-edit';
import { validateScene } from './validate';

setActivePacks(undefined);

function thing(name: string, x: number, y: number, behaviours: Record<string, object>): Omit<EntityData, 'id'> {
  return { name, tags: [], components: { transform: { x, y, h: 0, facing: 2 }, sprite: { shape: 'box', color: 0xcccccc, w: 0.9, d: 0.9, height: 1, sortOffset: 0, visible: true }, ...behaviours } };
}

function build(): { doc: EditorDoc; button: EntityData; gate: EntityData } {
  const doc = EditorDoc.fromScene(newScene('T', 16, 16));
  const [button, gate] = doc.addEntities([thing('Button', 3, 3, { clickable: { size: 1 } }), thing('Gate', 9, 9, { gate: {}, collider: { w: 1, d: 1, height: 1.6, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } })]);
  return { doc, button: button!, gate: gate! };
}

const play = (doc: EditorDoc): Simulation => {
  const sim = new Simulation(1);
  loadScene(sim, doc.toScene());
  addStandardSystems(sim, physicsSystem);
  return sim;
};

describe('quick actions', () => {
  it('make the nodes and wires for a signal pin, and add to them afterwards', () => {
    const { doc, button } = build();
    const pin = eventPinsOf(button.components).find((p) => p.label === 'On click')!;
    const id = addQuickAction(doc, button.id, pin, { ...newAction('setVariable'), params: { name: 'clicks', op: 'add', value: '1' } })!;
    expect(ownedNodes(doc, button.id)).toHaveLength(1);
    expect(doc.wires).toHaveLength(1);
    expect(doc.wires[0]).toMatchObject({ from: { entity: button.id, output: 'clicked' }, to: { entity: id, input: 'do' } });
    addQuickAction(doc, button.id, pin, { ...newAction('message'), params: { text: 'Hi' } });
    expect(ownedNodes(doc, button.id)).toHaveLength(1);
    expect((doc.getEntity(id)!.components.actionNode as { actions: unknown[] }).actions).toHaveLength(2);
    expect(usedPins(doc, button.id).map((u) => u.pin.label)).toEqual(['On click']);
  });

  it('are one undo step each', () => {
    const { doc, button } = build();
    const pin = eventPinsOf(button.components).find((p) => p.label === 'On click')!;
    addQuickAction(doc, button.id, pin, newAction('message'));
    expect(doc.entities).toHaveLength(3);
    doc.undo();
    expect(doc.entities).toHaveLength(2);
    expect(doc.wires).toHaveLength(0);
    doc.redo();
    expect(doc.entities).toHaveLength(3);
    expect(doc.wires).toHaveLength(1);
  });

  it('a button opens a gate: connect to a target, play it, click it', () => {
    const { doc, button, gate } = build();
    const pin = eventPinsOf(button.components).find((p) => p.label === 'On click')!;
    const open = actionPinsOf(gate.components).find((p) => p.label === 'Open')!;
    connectToTarget(doc, button.id, pin, gate.id, open);
    const sim = play(doc);
    for (let i = 0; i < 5; i++) sim.step({});
    const gateLive = sim.world.all().find((e) => e.name === 'Gate')!;
    expect(gateLive.get<{ inputs: Record<string, boolean> }>('signals')?.inputs.open).not.toBe(true);
    for (let i = 0; i < 3; i++) sim.step({ pointer_cx: 4, pointer_cy: 4, pointer_primary: 1 });
    for (let i = 0; i < 5; i++) sim.step({ pointer_cx: 4, pointer_cy: 4 });
    expect(gateLive.get<{ inputs: Record<string, boolean> }>('signals')?.inputs.open).toBe(true);
  });

  it('an event pin gets an event node between the object and the action', () => {
    const { doc, gate } = build();
    const [foe] = doc.addEntities([thing('Foe', 5, 5, { health: { max: 1 } })]);
    const pin = eventPinsOf(foe!.components).find((p) => p.id === 'event.died')!;
    const open = actionPinsOf(gate.components).find((p) => p.label === 'Open')!;
    connectToTarget(doc, foe!.id, pin, gate.id, open);
    expect(eventNodeFor(doc, foe!.id, pin.id)).toBeDefined();
    expect(actionNodeFor(doc, foe!.id, pin.id)).toBeDefined();
    expect(doc.wires).toHaveLength(1);
    expect(doc.wires[0]!.from.output).toBe('happened');
  });

  it('can be removed and reordered, and go with their owner', () => {
    const { doc, button } = build();
    const pin = eventPinsOf(button.components).find((p) => p.label === 'On click')!;
    addQuickAction(doc, button.id, pin, { ...newAction('message'), params: { text: 'A' } });
    addQuickAction(doc, button.id, pin, { ...newAction('message'), params: { text: 'B' } });
    const texts = (): string[] => (actionNodeFor(doc, button.id, pin.id)!.components.actionNode as { actions: { params: { text: string } }[] }).actions.map((a) => a.params.text);
    expect(texts()).toEqual(['A', 'B']);
    moveQuickAction(doc, button.id, pin.id, 0, 1);
    expect(texts()).toEqual(['B', 'A']);
    removeQuickAction(doc, button.id, pin.id, 0);
    expect(texts()).toEqual(['A']);
    removeQuickAction(doc, button.id, pin.id, 0);
    expect(ownedNodes(doc, button.id)).toHaveLength(0);
    expect(doc.wires).toHaveLength(0);
    addQuickAction(doc, button.id, pin, newAction('message'));
    doc.removeEntities([button.id]);
    expect(doc.entities.map((e) => e.name)).toEqual(['Gate']);
    doc.undo();
    expect(doc.entities).toHaveLength(3);
  });

  it('a broken target is reported in the problems list', () => {
    const { doc, button, gate } = build();
    const pin = eventPinsOf(button.components).find((p) => p.label === 'On click')!;
    connectToTarget(doc, button.id, pin, gate.id, actionPinsOf(gate.components).find((p) => p.label === 'Open')!);
    expect(validateScene(doc).filter((p) => p.message.includes('no longer exists'))).toEqual([]);
    doc.removeEntities([gate.id]);
    expect(validateScene(doc).some((p) => p.message.includes('no longer exists'))).toBe(true);
  });
});
