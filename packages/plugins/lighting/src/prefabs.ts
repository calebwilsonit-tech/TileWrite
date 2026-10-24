import { thing, type PrefabDef } from '@tilewright/plugin-sdk';

/** What this plugin adds to the editor's Place tool. */
export const prefabs: PrefabDef[] = [
  {
      id: 'lantern',
      label: 'Lantern (light)',
      group: 'Light',
      hint: 'Lights the area around it. Walls cast shadows. Switch it on and off with a wire if you like.',
      make: (x, y, h) => thing('Lantern', ['light'], { color: 0xffc866, w: 0.4, d: 0.4, height: 1.1 }, x, y, h, ['light']),
    },
];
