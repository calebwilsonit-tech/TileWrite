import type { EventDef } from '@tilewright/plugin-sdk';

/** The events this plugin announces, as the event sheet's pickers list them. */
export const events: EventDef[] = [
  { id: 'path-end', label: 'something reaches the end of its path' },
  { id: 'wave-started', label: 'a wave of enemies starts' },
  { id: 'wave-cleared', label: 'a wave of enemies is beaten' },
  { id: 'waves-done', label: 'every wave is done' },
  { id: 'produced', label: 'a producer makes something' },
  { id: 'new-day', label: 'a new day begins' },
  { id: 'night-start', label: 'night falls' },
  { id: 'day-start', label: 'the day breaks' },
  { id: 'new-season', label: 'a new season begins' },
  { id: 'activity-done', label: 'a villager finishes what it was doing' },
];
