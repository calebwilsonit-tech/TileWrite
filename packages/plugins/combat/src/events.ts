import type { EventDef } from '@tilewright/plugin-sdk';

/** The events this plugin announces, as the event sheet's pickers list them. */
export const events: EventDef[] = [
  { id: 'projectile-hit', label: 'a projectile hits', text: 'a projectile hits something' },
  { id: 'damaged', label: 'something is hurt', entityLabel: 'is hurt' },
  { id: 'died', label: 'something is defeated', entityLabel: 'is defeated' },
  { id: 'attack', label: 'the player swings the quill' },
  { id: 'dodge', label: 'the player dodges' },
];
