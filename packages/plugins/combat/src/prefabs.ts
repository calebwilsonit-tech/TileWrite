import { thing, type PrefabDef } from '@tilewright/plugin-sdk';

/** What this plugin adds to the editor's Place tool. */
export const prefabs: PrefabDef[] = [
  {
      id: 'spikes',
      label: 'Spikes',
      group: 'Enemies',
      hint: 'A trap that hurts whatever touches it.',
      make: (x, y, h) => thing('Spikes', ['trap'], { shape: 'diamond', color: 0xcfd3dc, w: 0.9, d: 0.9, height: 0.1 }, x, y, h, ['damageOnTouch']),
    },
];
