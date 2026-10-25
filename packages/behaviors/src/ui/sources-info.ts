import { host } from '../plugins/host';

/**
 * What the UI designer offers for "Repeats for", and which names a repeat can read: the engine's own sources, then the ones
 * plugins added (`api.listSource`). One list, so the picker, the checks and the docs agree.
 */

export interface SourceInfo {
  /** What goes in the widget's source field. */
  value: string;
  label: string;
  /** The names a repeat can read: `{item.name}`, with what each is. */
  variables: [string, string][];
}

const BUILTIN: SourceInfo[] = [
  { value: 'saves', label: 'the save slots (the autosave and three of your own)', variables: [['save.slot', 'Slot id'], ['save.name', 'Autosave, Slot 1...'], ['save.detail', 'Where and when, or "empty"'], ['save.exists', 'Is there a save (1 or 0)'], ['save.damaged', 'Is it damaged (1 or 0)'], ['save.manual', 'Is it one the player saves to (1 or 0)']] },
  { value: 'controls', label: 'the controls the player can change', variables: [['control.action', 'Action id'], ['control.label', 'Its name'], ['control.binding', 'The keys now']] },
  { value: 'places', label: 'the places on the world map the player can travel to', variables: [['place.id', 'Place id'], ['place.name', 'Its name'], ['place.here', 'Is the player there (1 or 0)'], ['place.hint', '"you are here" or nothing'], ['place.scene', 'Its scene']] },
  { value: 'menu:pause', label: 'the entries plugins add to the Pause menu', variables: [['entry.id', 'Entry id'], ['entry.label', 'Its words'], ['entry.detail', 'The second words'], ['entry.opens', 'The screen it opens']] },
  { value: 'turns', label: 'the units in the turn order', variables: [['unit.name', 'Unit name'], ['unit.team', 'Unit team'], ['unit.hp', 'Unit health'], ['unit.active', 'Is it this unit\u2019s turn (1 or 0)']] },
  { value: 'slots:12', label: '12 empty slots', variables: [['slot', 'Slot number']] },
];

/** The sources a widget can repeat for, besides the tables. */
export function listSourceChoices(): SourceInfo[] {
  return [
    ...BUILTIN,
    ...[...host.ext.listSources.values()].map((s) => ({ value: s.id, label: s.label, variables: Object.entries(s.fields ?? {}) })),
  ];
}

/** The names a repeat over this source can read (empty when it is not one the engine or a plugin knows). */
export function rowVariables(source: string): [string, string][] {
  const name = source.includes(':') && !source.startsWith('menu:') && !source.startsWith('slots:') && !source.startsWith('table:') && !source.startsWith('var:') ? source.slice(0, source.indexOf(':')) : source;
  const hit = listSourceChoices().find((s) => s.value === name || (name.startsWith('slots:') && s.value === 'slots:12') || (name.startsWith('menu:') && s.value === 'menu:pause'));
  return hit?.variables ?? [];
}

/** Values every screen can read about the game and the host, for the binding picker. */
export const HOST_VALUES: [string, string][] = [
  ['game.title', 'The game\u2019s name (while the title screen is up)'],
  ['game.subtitle', 'The line under it'],
  ['map.title', 'The title of the world map'],
  ['host.quit', 'Can the game quit (1 or 0)'],
  ['host.fullscreen', 'Can it go full screen (1 or 0)'],
  ['host.hasSave', 'Is there a save to continue from (1 or 0)'],
  ['host.latestSave', 'Where and when the latest save was made'],
  ['host.skins', 'How many looks the player can choose between'],
  ['host.languages', 'How many languages the game has'],
];
