import type { EventAction, EventCondition } from '@tilewright/runtime';
import { actionDef, newAction, newCondition } from './events/sheet';
import { behaviorList, getBehavior } from './framework';

/**
 * What every object can say (its events) and be told to do (its actions), worked out from the behaviours on it. The
 * three levels of the logic system all read this one list: the Quick Actions in the Inspector, the strings dragged
 * between things in the viewport, and the node picker of the graph editor.
 */

/** Something an object announces: a signal it sends, or something that happens to it. */
export interface EventPin {
  id: string;
  label: string;
  help?: string;
  /** `signal`: a wire can leave this output as it is. `event`: an Event node watches the game for it. */
  kind: 'signal' | 'event';
  /** For signals: the output name. For events: the condition that watches for it. */
  signal?: string;
  condition?: (who: string) => EventCondition;
  /** The behaviour it comes from (shown in the picker). */
  from: string;
}

interface EntityEventSpec {
  id: string;
  label: string;
  /** Any one of these behaviours has to be on the object. */
  needs: string[];
  event: string;
}

const ENTITY_EVENTS: EntityEventSpec[] = [
  { id: 'died', label: 'Is defeated', needs: ['health'], event: 'died' },
  { id: 'damaged', label: 'Is hurt', needs: ['health'], event: 'damaged' },
  { id: 'pickup', label: 'Is picked up', needs: ['pickup'], event: 'pickup' },
  { id: 'turn-start', label: 'Its turn starts', needs: ['turnTaker'], event: 'turn-start' },
  { id: 'turn-end', label: 'Its turn ends', needs: ['turnTaker'], event: 'turn-end' },
  { id: 'unit-moved', label: 'Finishes walking', needs: ['gridMover'], event: 'unit-moved' },
  { id: 'noticed', label: 'Notices something', needs: ['visionCone'], event: 'noticed' },
  { id: 'state-changed', label: 'Changes state', needs: ['stateMachine'], event: 'state-changed' },
  { id: 'hotspot-used', label: 'Is used', needs: ['hotspot'], event: 'hotspot-used' },
  { id: 'boss-defeated', label: 'Is defeated (boss)', needs: ['bossPhases'], event: 'boss-defeated' },
];

/** How an output reads in plain words when the behaviour's own label is not enough ("On Click"). */
const PIN_WORDS: Record<string, string> = {
  'clickable.clicked': 'On click',
  'clickable.rightClicked': 'On right-click',
  'clickable.hovered': 'While the pointer is over it',
  'pressurePlate.active': 'While pressed',
  'triggerZone.occupied': 'While someone is inside',
  'lever.on': 'While switched on',
  'timer.done': 'When the time is up',
  'timer.running': 'While counting down',
  'eventNode.happened': 'When it happens',
  'eventNode.on': 'While it is true',
  'actionNode.done': 'When it has run',
};

export function eventPinsOf(components: Record<string, unknown>): EventPin[] {
  const out: EventPin[] = [];
  for (const b of behaviorList()) {
    if (components[b.id] === undefined) continue;
    for (const o of b.outputs) {
      out.push({ id: `${b.id}.${o.name}`, label: PIN_WORDS[`${b.id}.${o.name}`] ?? o.label, help: o.help, kind: 'signal', signal: o.name, from: b.name });
    }
  }
  for (const ev of ENTITY_EVENTS) {
    if (!ev.needs.some((n) => components[n] !== undefined)) continue;
    out.push({
      id: `event.${ev.id}`,
      label: ev.label,
      kind: 'event',
      from: 'Game events',
      condition: (who) => ({ ...newCondition('entityEvent'), params: { who, name: ev.event } }),
    });
  }
  return out;
}

/** Something an object can be told to do. `make` builds the action for a given object reference ("id:e3"). */
export interface ActionPin {
  id: string;
  label: string;
  help?: string;
  make(who: string): EventAction;
  from: string;
}

type Verb = { on: string; off?: string; toggle?: string; pulse?: boolean };

/** What turning an input on means, in words ("Gate -> Open", "Timer -> Start"). */
const INPUT_VERBS: Record<string, Verb> = {
  'gate.open': { on: 'Open', off: 'Close', toggle: 'Open or close' },
  'timer.start': { on: 'Start', pulse: true },
  'logic.set': { on: 'Set', off: 'Reset' },
  'light.switch': { on: 'Switch on', off: 'Switch off', toggle: 'Switch on or off' },
  'spawner.spawn': { on: 'Spawn one', pulse: true },
  'waveSpawner.next': { on: 'Start the next wave', pulse: true },
  'cutsceneTrigger.play': { on: 'Play', pulse: true },
  'sound.play': { on: 'Play once', pulse: true },
  'formattableText.next': { on: 'Next word', pulse: true },
  'health.heal': { on: 'Heal fully', pulse: true },
  'health.kill': { on: 'Kill', pulse: true },
};

const sendSignal = (who: string, input: string, state: string): EventAction => ({ ...newAction('sendSignal'), params: { who, name: input, state } });
const act = (type: string, params: Record<string, unknown>): EventAction => ({ ...newAction(type), params: { ...newAction(type).params, ...params } });

interface GenericAction {
  id: string;
  label: string;
  needs?: string[];
  make(who: string): EventAction;
}

const GENERIC_ACTIONS: GenericAction[] = [
  { id: 'show', label: 'Show', make: (who) => act('setVisible', { who, visible: 'shown' }) },
  { id: 'hide', label: 'Hide', make: (who) => act('setVisible', { who, visible: 'hidden' }) },
  { id: 'solid', label: 'Make solid', needs: ['collider'], make: (who) => act('setEnabled', { who, state: 'on' }) },
  { id: 'non-solid', label: 'Make non-solid', needs: ['collider'], make: (who) => act('setEnabled', { who, state: 'off' }) },
  { id: 'destroy', label: 'Remove from the game', make: (who) => act('destroy', { who }) },
  { id: 'damage', label: 'Hurt', needs: ['health'], make: (who) => act('damage', { who }) },
  { id: 'heal', label: 'Heal', needs: ['health'], make: (who) => act('heal', { who }) },
];

export function actionPinsOf(components: Record<string, unknown>): ActionPin[] {
  const out: ActionPin[] = [];
  const entityLabel = 'This object';
  for (const g of GENERIC_ACTIONS) {
    if (g.needs && !g.needs.some((n) => components[n] !== undefined)) continue;
    if (!actionDef(g.make('x').type)) continue;
    out.push({ id: g.id, label: g.label, make: g.make, from: entityLabel });
  }
  for (const b of behaviorList()) {
    if (components[b.id] === undefined) continue;
    for (const i of b.inputs) {
      const verb = INPUT_VERBS[`${b.id}.${i.name}`];
      if (verb) {
        out.push({ id: `${b.id}.${i.name}`, label: verb.on, help: i.help, make: (who) => sendSignal(who, i.name, verb.pulse ? 'pulse' : 'on'), from: b.name });
        if (verb.off) out.push({ id: `${b.id}.${i.name}.off`, label: verb.off, make: (who) => sendSignal(who, i.name, 'off'), from: b.name });
        if (verb.toggle) out.push({ id: `${b.id}.${i.name}.toggle`, label: verb.toggle, make: (who) => sendSignal(who, i.name, 'toggle'), from: b.name });
      } else {
        out.push({ id: `${b.id}.${i.name}`, label: `Turn on "${i.label}"`, help: i.help, make: (who) => sendSignal(who, i.name, 'on'), from: b.name });
        out.push({ id: `${b.id}.${i.name}.off`, label: `Turn off "${i.label}"`, make: (who) => sendSignal(who, i.name, 'off'), from: b.name });
      }
    }
  }
  return out;
}

/** Actions that need no target: the common ones menus are made of. Only the ones this project's packs provide are listed. */
export interface QuickAction {
  id: string;
  label: string;
  group: string;
  make(): EventAction;
}

const QUICK_DEFS: { id: string; label: string; group: string; action: string; params?: Record<string, unknown> }[] = [
  { id: 'go-scene', label: 'Go to a scene', group: 'Game', action: 'travel' },
  { id: 'new-game', label: 'Start a new run', group: 'Game', action: 'newRun' },
  { id: 'continue', label: 'Continue (load the saved game)', group: 'Game', action: 'loadGame' },
  { id: 'save', label: 'Save the game', group: 'Game', action: 'saveGame' },
  { id: 'load', label: 'Load a saved game', group: 'Game', action: 'loadGame' },
  { id: 'quit', label: 'Quit the game', group: 'Game', action: 'quitGame' },
  { id: 'open-screen', label: 'Open a screen', group: 'Screens', action: 'uiScreen', params: { op: 'open' } },
  { id: 'close-screen', label: 'Close a screen', group: 'Screens', action: 'uiScreen', params: { op: 'close' } },
  { id: 'back', label: 'Go back one screen', group: 'Screens', action: 'uiScreen', params: { op: 'back' } },
  { id: 'set-var', label: 'Set a variable', group: 'Variables', action: 'setVariable', params: { op: 'set' } },
  { id: 'add-var', label: 'Add to a variable', group: 'Variables', action: 'setVariable', params: { op: 'add' } },
  { id: 'flip-var', label: 'Flip a yes/no variable', group: 'Variables', action: 'setVariable', params: { op: 'toggle' } },
  { id: 'sound', label: 'Play a sound', group: 'Sound', action: 'sound' },
  { id: 'dialogue', label: 'Show a dialogue', group: 'Story', action: 'startDialogue' },
  { id: 'message', label: 'Show a message', group: 'Story', action: 'message' },
  { id: 'spawn', label: 'Create an object', group: 'World', action: 'spawn' },
  { id: 'give', label: 'Give an item', group: 'World', action: 'giveItem' },
  { id: 'pay', label: 'Pay a cost', group: 'World', action: 'spend' },
  { id: 'earn', label: 'Receive resources', group: 'World', action: 'earn' },
  { id: 'next-wave', label: 'Start the next wave', group: 'World', action: 'nextWave' },
  { id: 'end-turn', label: 'End the turn', group: 'Turns', action: 'endTurn' },
  { id: 'clock', label: 'Pause, resume or change the game speed', group: 'Turns', action: 'setClock' },
];

export function quickActions(): QuickAction[] {
  return QUICK_DEFS.filter((q) => actionDef(q.action)).map((q) => ({ id: q.id, label: q.label, group: q.group, make: () => act(q.action, q.params ?? {}) }));
}

/** The behaviour a pin id like "gate.open" belongs to, if it still exists (a pack may have been switched off). */
export const pinBehaviour = (pinId: string): string | undefined => {
  const id = pinId.split('.')[0]!;
  return getBehavior(id) ? id : undefined;
};
