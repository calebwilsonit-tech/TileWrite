import { C, readPointer, type Entity, type EventAction, type EventCondition, type SimContext, type Sprite, type TransformIso } from '@tilewright/runtime';
import { defineBehavior, stateOf } from '../framework';
import { describeAction, describeCondition, noteFired, runActionList, testConditionList } from '../events/sheet';
import { input, setOutput } from '../signals';

/**
 * Event and Action nodes: the way wires reach everything the event sheet can see and do. An Event node watches any
 * condition and sends a signal; an Action node does a list of actions when a signal arrives. Wire them with plates, gates,
 * logic gates and buttons, or let the Inspector make them for you ("Quick actions").
 */

const sceneIdOf = (e: Entity): string => e.get<{ sceneId?: string }>('meta')?.sceneId ?? String(e.id);

export interface EventNode {
  conditions: EventCondition[];
  mode: 'all' | 'any';
  breakpoint: boolean;
}

export const eventNode = defineBehavior<EventNode>({
  id: 'eventNode',
  name: 'Event Node',
  category: 'Logic',
  description: 'Watches for anything the event sheet can see (a variable reaching a number, the player coming near, a button being pressed, something happening in the game) and sends a signal. "Is true" stays on while the conditions hold; "Happened" is a short pulse the moment they become true. Wire it to gates, logic gates or action nodes.',
  phase: 'source',
  dataOnly: true,
  defaults: { conditions: [{ type: 'always', params: {}, negate: false }], mode: 'all', breakpoint: false },
  fields: [
    {
      key: 'mode',
      label: 'It is true when',
      type: 'select',
      options: [{ value: 'all', label: 'all of the conditions hold' }, { value: 'any', label: 'any of the conditions holds' }],
    },
    { key: 'breakpoint', label: 'Stop the game here when it happens (debugging)', type: 'boolean' },
  ],
  inputs: [],
  outputs: [
    { name: 'on', label: 'Is true' },
    { name: 'happened', label: 'Happened (one tick)' },
  ],
  editor: 'eventNode',
  requires: {},
  summary: (s) => `Sends a signal when ${s.conditions.map((c) => describeCondition(c)).join(s.mode === 'any' ? ' or ' : ' and ') || 'always'}.`,
  update() {
    // evaluated by eventNodeSystem, after the event sheet, so it sees everything that happened this tick
  },
});

/** Event nodes look at the world once the tick's events have happened; their signals reach the wires on the next tick. */
export function eventNodeSystem(ctx: SimContext): void {
  for (const e of ctx.world.query('eventNode')) {
    const s = { conditions: [], mode: 'all', breakpoint: false, ...e.get<Partial<EventNode>>('eventNode') } as EventNode;
    const sp = e.get<Sprite>(C.Sprite);
    if (sp) sp.visible = false;
    const st = stateOf(e, 'eventNode', () => ({ prev: false }));
    const truth = testConditionList(ctx, s.conditions, s.mode, e);
    const rising = truth && !st.prev;
    st.prev = truth;
    setOutput(e, 'on', truth);
    setOutput(e, 'happened', rising);
    if (rising) noteFired(ctx, `e:${sceneIdOf(e)}`, s.breakpoint, `the event node "${e.name}": ${s.conditions.map((c) => describeCondition(c)).join(s.mode === 'any' ? ' or ' : ' and ')}`);
  }
}

export interface ActionNode {
  actions: EventAction[];
  /** Do the actions on every tick while the signal is on, not only when it turns on. */
  whileOn: boolean;
  breakpoint: boolean;
}

export const actionNode = defineBehavior<ActionNode>({
  id: 'actionNode',
  name: 'Action Node',
  category: 'Logic',
  description: 'Does a list of actions (anything the event sheet can do: change a variable, open a gate, play a sound, go to another scene...) when its "Do it" signal turns on. "Done" pulses afterwards, so nodes can follow each other. "This object" in its actions means the node itself.',
  phase: 'logic',
  defaults: { actions: [], whileOn: false, breakpoint: false },
  fields: [
    { key: 'whileOn', label: 'Keep doing it every tick while the signal is on', type: 'boolean' },
    { key: 'breakpoint', label: 'Stop the game here when it runs (debugging)', type: 'boolean' },
  ],
  inputs: [{ name: 'do', label: 'Do it' }],
  outputs: [{ name: 'done', label: 'Done (one tick)' }],
  editor: 'actionNode',
  requires: {},
  summary: (s) => (s.actions.length === 0 ? 'Does nothing yet. Add an action.' : `${s.actions.map((a) => describeAction(a)).join(', then ')}.`),
  update(ctx, e, s) {
    // logic nodes run several times a tick while signals settle: the edge and the work happen once per tick
    const st = stateOf(e, 'actionNode', () => ({ tick: -1, prev: false, prevAtStart: false, ran: -1 }));
    if (st.tick !== ctx.tick) {
      st.tick = ctx.tick;
      st.prevAtStart = st.prev;
      setOutput(e, 'done', false);
    }
    const sp = e.get<Sprite>(C.Sprite);
    if (sp) sp.visible = false;
    const on = input(e, 'do');
    st.prev = on;
    const go = s.whileOn ? on : on && !st.prevAtStart;
    if (go && st.ran !== ctx.tick) {
      st.ran = ctx.tick;
      noteFired(ctx, `e:${sceneIdOf(e)}`, s.breakpoint, `the action node "${e.name}": ${s.actions.map((a) => describeAction(a)).join(', then ')}`);
      runActionList(ctx, s.actions, e);
      setOutput(e, 'done', true);
    }
  },
});

export interface Clickable {
  /** How many cells wide and deep the clickable area is, centred on the object. */
  size: number;
}

export const clickable = defineBehavior<Clickable>({
  id: 'clickable',
  name: 'Clickable',
  category: 'Logic',
  description: 'Reacts to the mouse (or a finger): "On click" pulses when the main button goes down over it, "On right-click" for the other button, and "While the pointer is over it" stays on while it hovers. Wire the pulses to anything, or use Quick actions in the Inspector.',
  phase: 'source',
  defaults: { size: 1 },
  fields: [{ key: 'size', label: 'Area (cells wide and deep)', type: 'number', min: 0.5, max: 20, step: 0.5 }],
  inputs: [],
  outputs: [
    { name: 'clicked', label: 'Clicked' },
    { name: 'rightClicked', label: 'Right-clicked' },
    { name: 'hovered', label: 'Pointer is over it' },
  ],
  requires: {},
  update(ctx, e, s) {
    const p = readPointer(ctx.input);
    const t = e.require<TransformIso>(C.Transform);
    const half = Math.max(0.25, s.size) / 2;
    const over = !!p.cell && Math.abs(p.cell.x + 0.5 - t.x) <= half && Math.abs(p.cell.y + 0.5 - t.y) <= half;
    setOutput(e, 'hovered', over);
    setOutput(e, 'clicked', over && p.primary.pressed);
    setOutput(e, 'rightClicked', over && p.secondary.pressed);
    if (over && p.primary.pressed) ctx.events.emit('clicked', { entity: e.id });
  },
});
