import type { Chapter } from '../build';

/** Chapter two: duskcaps, which rise in the dark, and the shadows risen things cast. */
export const CH2: Chapter = {
  id: 'ch2',
  name: 'The Shade Walk',
  line: 'Under the old yews grow duskcaps. They stand tall in the dark and shrink from a lamp. Mind what stands between a lamp and a bed.',
  rooms: [
    {
      id: 'r201',
      name: 'Shy things',
      hint: 'A duskcap rises in the dark and sinks in light.',
      rows: [
        '_  _  .l _  _  _',
        '.@ .  .  .d .  .E',
      ],
    },
    {
      id: 'r202',
      name: 'Seesaw',
      hint: 'One lamp, two beds, never both the same.',
      rows: [
        '_  _  _  .l _  _  _',
        '.@ .  .b .  .d .  .E',
        '_  _  .* _  _  _  _',
      ],
    },
    {
      id: 'r203',
      name: 'Lights out',
      hint: 'Stand on a sunken duskcap and take the light away.',
      rows: [
        '_  _  .L ^* _  _',
        '.@ .  .d ^  ^  ^E',
        '_  _  .  _  _  _',
      ],
    },
    {
      id: 'r204',
      name: 'In its shadow',
      hint: 'A risen bloom keeps the light off what is behind it.',
      rows: [
        '.@ .  .  _  _  _',
        '_  .l .b .d ^  ^E',
      ],
    },
    {
      id: 'r205',
      name: 'The yew hedge',
      hint: 'A hedge stops light as well as feet.',
      rows: [
        '.@ .  .  .l #  .  .',
        '_  _  .  .  .d .  .E',
        '_  _  .  .l #  .* _',
      ],
    },
    {
      id: 'r206',
      name: 'Dark stair',
      hint: 'Tops are floors. Some tops need light, some need none.',
      rows: [
        '.@ .  .  .  ^  ^E',
        '_  .l .b .d .b .',
        '_  .  .  .  .  .l',
      ],
    },
    {
      id: 'r207',
      name: 'Yew walk',
      hint: 'What is up in the dark comes down in the light, and the other way about.',
      rows: [
        '.  .d .  .d ^  .',
        '^@ .  ^  .l .  .d',
        '.  .l .  .  _  .',
        '.  .d .  .L .E .',
      ],
    },
    {
      id: 'r208',
      name: 'Hide and seek',
      hint: 'A lamp on a terrace shines over the beds below.',
      rows: [
        '.  .b ^  .  .  .',
        '^  ^  ^l _  .  .',
        '^@ .  _  .l .d .',
        '.  _  .E .l .  .',
      ],
    },
  ],
};
