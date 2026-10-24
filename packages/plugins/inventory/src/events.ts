import type { EventDef } from '@tilewright/plugin-sdk';

/** The events this plugin announces, as the event sheet's pickers list them. */
export const events: EventDef[] = [
  { id: 'pickup', label: 'something is picked up', entityLabel: 'is picked up' },
  { id: 'item-given', label: 'the player receives an item' },
];
