import type { EventDef } from '@tilewright/plugin-sdk';

/** The events this plugin announces, as the event sheet's pickers list them. */
export const events: EventDef[] = [
  { id: 'building-placed', label: 'a building is placed' },
  { id: 'orders-given', label: 'units are given an order' },
  { id: 'click-move', label: 'the player clicks to walk somewhere' },
  { id: 'hotspot-used', label: 'a hotspot is used', entityLabel: 'is used (hotspot)', entityText: 'is used' },
];
