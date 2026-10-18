import { actionPinsOf, describeAction, eventPinsOf, newCondition, type ActionNode, type ActionPin, type EventNode, type EventPin } from '@tilewright/behaviors';
import type { EntityData, EventAction } from '@tilewright/runtime';
import type { EditorDoc } from './doc';

/**
 * Quick actions and "make something happen" wires are made of the same two kinds of objects: an Event node (for things
 * that happen to an object rather than signals it sends) and an Action node (a list of actions). They carry a `quick`
 * mark saying whose they are and which of its events they answer, so the Inspector can show them as a short list and the
 * viewport can show them as wires, and both edit the same objects.
 */

export interface QuickMark {
  owner: string;
  pin: string;
  role: 'event' | 'actions';
}

export const quickOf = (e: EntityData): QuickMark | undefined => e.components.quick as QuickMark | undefined;

/** Every node made for an object (its event and action nodes). */
export function ownedNodes(doc: EditorDoc, ownerId: string): EntityData[] {
  return doc.entities.filter((e) => quickOf(e)?.owner === ownerId);
}

export function actionNodeFor(doc: EditorDoc, ownerId: string, pinId: string): EntityData | undefined {
  return doc.entities.find((e) => {
    const q = quickOf(e);
    return q?.owner === ownerId && q.pin === pinId && q.role === 'actions';
  });
}

export function eventNodeFor(doc: EditorDoc, ownerId: string, pinId: string): EntityData | undefined {
  return doc.entities.find((e) => {
    const q = quickOf(e);
    return q?.owner === ownerId && q.pin === pinId && q.role === 'event';
  });
}

/** The pins of an object that have something attached. */
export function usedPins(doc: EditorDoc, ownerId: string): { pin: EventPin; node: EntityData }[] {
  const owner = doc.getEntity(ownerId);
  if (!owner) return [];
  const pins = eventPinsOf(owner.components);
  const out: { pin: EventPin; node: EntityData }[] = [];
  for (const n of ownedNodes(doc, ownerId)) {
    const q = quickOf(n)!;
    if (q.role !== 'actions') continue;
    const pin = pins.find((p) => p.id === q.pin);
    if (pin) out.push({ pin, node: n });
  }
  return out;
}

const NODE_LOOK = {
  eventNode: { color: 0xf0b429, shape: 'diamond' as const },
  actionNode: { color: 0x6aa8ff, shape: 'box' as const },
};

function nodeData(kind: 'eventNode' | 'actionNode', name: string, x: number, y: number, h: number, settings: Record<string, unknown>, mark?: QuickMark): Omit<EntityData, 'id'> {
  const look = NODE_LOOK[kind];
  return {
    name,
    tags: ['logic-node'],
    components: {
      transform: { x, y, h, facing: 2 },
      sprite: { shape: look.shape, color: look.color, w: 0.45, d: 0.45, height: look.shape === 'diamond' ? 0.05 : 0.4, sortOffset: 0, visible: true },
      [kind]: settings,
      ...(mark ? { quick: mark } : {}),
    },
  };
}

/** A free-standing node, for the Place tool and the graph's "make nodes" buttons. */
export function newNode(kind: 'eventNode' | 'actionNode', x: number, y: number, h: number): Omit<EntityData, 'id'> {
  return nodeData(kind, kind === 'eventNode' ? 'Event node' : 'Action node', x, y, h, kind === 'eventNode' ? { conditions: [newCondition('always')], mode: 'all', breakpoint: false } : { actions: [], whileOn: false, breakpoint: false });
}

/** Add an action to what happens when an object's event occurs. Makes the nodes and wires the first time. Returns the action node's id. */
export function addQuickAction(doc: EditorDoc, ownerId: string, pin: EventPin, action: EventAction, targetName?: string): string | null {
  const owner = doc.getEntity(ownerId);
  if (!owner) return null;
  const t = owner.components.transform as { x: number; y: number; h: number };
  const existing = actionNodeFor(doc, ownerId, pin.id);
  if (existing) {
    doc.updateEntities([existing.id], 'Add an action', (x) => {
      const s = x.components.actionNode as ActionNode;
      s.actions = [...s.actions, structuredClone(action)];
    });
    return existing.id;
  }
  let id = '';
  doc.history.batch(`Add "${pin.label}" action`, () => {
    const slot = ownedNodes(doc, ownerId).filter((n) => quickOf(n)!.role === 'actions').length;
    const baseX = t.x + 1.4;
    const baseY = t.y + slot * 0.9;
    let source: { entity: string; output: string };
    if (pin.kind === 'signal') {
      source = { entity: ownerId, output: pin.signal! };
    } else {
      const [ev] = doc.addEntities([nodeData('eventNode', `${owner.name}: ${pin.label}`, baseX, baseY - 0.5, t.h, { conditions: [pin.condition!(`id:${ownerId}`)], mode: 'all', breakpoint: false } satisfies EventNode, { owner: ownerId, pin: pin.id, role: 'event' })], 'Add an event node');
      source = { entity: ev!.id, output: 'happened' };
    }
    const [node] = doc.addEntities(
      [nodeData('actionNode', targetName ? `${owner.name} ${pin.label}: ${targetName}` : `${owner.name}: ${pin.label}`, baseX + (pin.kind === 'event' ? 1.1 : 0), baseY, t.h, { actions: [structuredClone(action)], whileOn: false, breakpoint: false } satisfies ActionNode, { owner: ownerId, pin: pin.id, role: 'actions' })],
      'Add an action node',
    );
    id = node!.id;
    doc.addWire(source, { entity: node!.id, input: 'do' });
  });
  return id || null;
}

/** Make something happen to another object when this one's event occurs ("Button click -> Gate: Open"). */
export function connectToTarget(doc: EditorDoc, ownerId: string, pin: EventPin, targetId: string, act: ActionPin): string | null {
  const target = doc.getEntity(targetId);
  if (!target) return null;
  return addQuickAction(doc, ownerId, pin, act.make(`id:${targetId}`), `${target.name} → ${act.label}`);
}

export function removeQuickAction(doc: EditorDoc, ownerId: string, pinId: string, index: number): void {
  const node = actionNodeFor(doc, ownerId, pinId);
  if (!node) return;
  const actions = (node.components.actionNode as ActionNode).actions;
  if (actions.length <= 1) {
    const ev = eventNodeFor(doc, ownerId, pinId);
    doc.removeEntities([node.id, ...(ev ? [ev.id] : [])], 'Remove the action');
    return;
  }
  doc.updateEntities([node.id], 'Remove an action', (x) => {
    (x.components.actionNode as ActionNode).actions.splice(index, 1);
  });
}

export function moveQuickAction(doc: EditorDoc, ownerId: string, pinId: string, index: number, delta: -1 | 1): void {
  const node = actionNodeFor(doc, ownerId, pinId);
  if (!node) return;
  doc.updateEntities([node.id], 'Reorder actions', (x) => {
    const list = (x.components.actionNode as ActionNode).actions;
    const j = index + delta;
    if (j < 0 || j >= list.length) return;
    const [a] = list.splice(index, 1);
    list.splice(j, 0, a!);
  });
}

export function setQuickActions(doc: EditorDoc, nodeId: string, actions: EventAction[]): void {
  doc.updateEntities([nodeId], 'Change actions', (x) => {
    (x.components.actionNode as ActionNode).actions = structuredClone(actions);
  });
}

/** Everything the "make something happen" list can offer for a target: its action pins. */
export function targetActions(doc: EditorDoc, targetId: string): ActionPin[] {
  const t = doc.getEntity(targetId);
  return t ? actionPinsOf(t.components) : [];
}

/** The ids an action points at, so the viewport can draw a line from the node to what it changes. */
export function actionTargets(actions: readonly EventAction[]): string[] {
  const out = new Set<string>();
  for (const a of actions) {
    for (const v of Object.values(a.params)) if (typeof v === 'string' && v.startsWith('id:')) out.add(v.slice(3));
  }
  return [...out];
}

/** A plain-English line for each action, with object names. */
export function describeActions(doc: EditorDoc, actions: readonly EventAction[]): string[] {
  const names = { entity: (id: string) => doc.getEntity(id)?.name };
  return actions.map((a) => describeAction(a, names));
}
