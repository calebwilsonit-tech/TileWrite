import type { EventDef } from '@tilewright/plugin-sdk';

/** The events this plugin announces, as the event sheet's pickers list them. */
export const events: EventDef[] = [
  { id: 'battle-started', label: 'a turn-based battle starts' },
  { id: 'turn-start', label: 'a unit\'s turn starts', entityLabel: 'starts its turn' },
  { id: 'turn-end', label: 'a unit\'s turn ends', entityLabel: 'ends its turn' },
  { id: 'round-start', label: 'a new round of turns starts' },
  { id: 'battle-won', label: 'a battle is won' },
  { id: 'unit-moved', label: 'a unit finishes walking', entityLabel: 'finishes walking' },
  { id: 'unit-attacked', label: 'a unit attacks' },
];
