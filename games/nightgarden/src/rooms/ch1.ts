import type { Chapter } from '../build';

/** Chapter one: lamps, and moonblooms as walls and as lifts. */
export const CH1: Chapter = {
  id: 'ch1',
  name: 'The Potting Shed',
  line: 'The lamps are out and the moonblooms have gone to ground. Light makes them rise. Start with one.',
  rooms: [
    {
      id: 'r101',
      name: 'First light',
      hint: 'A moonbloom rises while its bed is lit.',
      rows: [
        '_  .  .  .L _  _',
        '_  .  _  .  _  _',
        '.@ .  .  .b .  .E',
      ],
    },
    {
      id: 'r102',
      name: 'Up',
      hint: 'Whoever stands on a bed rides it.',
      rows: [
        '_  _  _  .l ^  ^E',
        '.@ .  .  .b ^  ^',
      ],
    },
    {
      id: 'r103',
      name: 'Two beds',
      hint: 'A risen bloom is a wall from the ground and a floor from above.',
      rows: [
        '_  .  .L _  .l _  _',
        '.@ .  .b .  .b ^  ^E',
        '_  _  ^* _  _  _  _',
      ],
    },
    {
      id: 'r104',
      name: 'The long way down',
      hint: 'A drop is easy. The way back up is not.',
      rows: [
        '_  _  .l _  _  _  _  _',
        '^@ ^  .b ^  ^  .b ^  ^E',
        '^l ^  .  ^  ^l .  _  _',
        '_  _  .* .  .  .  _  _',
      ],
    },
    {
      id: 'r105',
      name: 'Stepping stones',
      hint: 'A lamp lights two beds every way, less the far corners.',
      rows: [
        '_  _  _  .l _  _  _',
        '.@ .  .b .b .b ^  ^',
        '_  _  .  .  ^* _  ^E',
      ],
    },
    {
      id: 'r106',
      name: 'Behind you',
      hint: 'The same lamp can open one way and close another.',
      rows: [
        '.@ .  .  _  _',
        '_  .L .  _  _',
        '_  _  .b .l _',
        '_  _  .  .b ^E',
        '_  _  .* _  _',
      ],
    },
    {
      id: 'r107',
      name: 'Either lamp',
      hint: 'A bed stays lit while any lamp reaches it. Shift turns you on the spot.',
      rows: [
        '_  .L .  .L _  _',
        '.@ .  .  .b .  .E',
        '_  _  _  ^* _  _',
      ],
    },
    {
      id: 'r108',
      name: 'The far corner',
      hint: 'A pale lamp never goes out. Its far corners stay dark.',
      rows: [
        '.@ .  .b .  .  .*',
        '.  .  .b .  .f .b',
        '.  .  .b .  .  .',
        '.  .  .b .  .  .E',
      ],
    },
  ],
};
