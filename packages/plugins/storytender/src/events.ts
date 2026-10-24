import type { EventDef } from '@tilewright/plugin-sdk';

/** The events this plugin announces, as the event sheet's pickers list them. */
export const events: EventDef[] = [
  { id: 'echo-made', label: 'an echo is recorded' },
  { id: 'sentence-changed', label: 'a sentence stone changes its word' },
  { id: 'text-formatted', label: 'a text block is reformatted' },
  { id: 'lantern-lit', label: 'a lantern is lit' },
  { id: 'rested', label: 'the player rests at a lantern' },
];
