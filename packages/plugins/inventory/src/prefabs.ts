import { thing, type PrefabDef } from '@tilewright/plugin-sdk';

/** What this plugin adds to the editor's Place tool. */
export const prefabs: PrefabDef[] = [
  {
      id: 'coin',
      label: 'Pickup (coin)',
      group: 'World',
      hint: 'Disappears when the player touches it and adds to a counter.',
      make: (x, y, h) => thing('Coin', ['pickup'], { color: 0xffd34a, w: 0.4, d: 0.4, height: 0.4 }, x, y, h, ['pickup']),
    },
];
