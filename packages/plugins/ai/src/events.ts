import type { EventDef } from '@tilewright/plugin-sdk';

/** The events this plugin announces, as the event sheet's pickers list them. */
export const events: EventDef[] = [
  { id: 'noticed', label: 'a guard notices something', entityLabel: 'notices something' },
  { id: 'lost', label: 'a guard loses track' },
  { id: 'state-changed', label: 'a character changes state (State Machine)', text: 'a character changes state', entityLabel: 'changes state' },
  { id: 'boss-phase', label: 'a boss enters a new phase' },
  { id: 'boss-defeated', label: 'a boss is defeated', entityLabel: 'is defeated (boss)', entityText: 'is defeated' },
];
