import type { EventDef } from '@tilewright/plugin-sdk';

/** The events this plugin announces, as the event sheet's pickers list them. */
export const events: EventDef[] = [
  { id: 'dialogue-started', label: 'a conversation starts' },
  { id: 'dialogue-ended', label: 'a conversation ends' },
  { id: 'minigame-started', label: 'a minigame starts' },
  { id: 'minigame-ended', label: 'a minigame ends' },
  { id: 'cutscene-started', label: 'a cutscene starts' },
  { id: 'cutscene-ended', label: 'a cutscene ends' },
];
