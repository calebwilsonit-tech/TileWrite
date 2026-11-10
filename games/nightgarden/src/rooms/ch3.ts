import type { Chapter } from '../build';

/** Chapter three: crates, plates and gates, and screens that cast a shadow where you push them. */
export const CH3: Chapter = {
  id: 'ch3',
  name: 'The Tool Yard',
  line: 'Crates, trellis screens, iron gates on stone plates. Everything here can be leaned on, and some of it throws a useful shadow.',
  rooms: [
    {
      id: 'r301',
      name: 'Weight',
      hint: 'A gate stays open while something rests on its plate.',
      rows: [
        '.@ .c .  .o1 _   _',
        '.  .  .  .   .g1 .E',
      ],
    },
    {
      id: 'r302',
      name: 'Doorstop',
      hint: 'A gate never shuts on what stands in its doorway.',
      rows: [
        '_  _   _  _   .* _',
        '.@ .o1 .c .g1 .  .',
        '_  .   .  _   .  .E',
      ],
    },
    {
      id: 'r303',
      name: 'Trellis',
      hint: 'A screen is tall enough to throw a shadow.',
      rows: [
        '_  _  .  .  _  _',
        '.@ .  .  .h .  _',
        '_  .  .f .  .b .E',
        '_  _  _  .  _  _',
      ],
    },
    {
      id: 'r304',
      name: 'Wired',
      hint: 'A teal lamp is lit by its plate, not by hand.',
      rows: [
        '.@ .c  .  .o1 _  _',
        '.  .   .  .   .p1 _',
        '_  _   .  .d  .  .E',
      ],
    },
    {
      id: 'r305',
      name: 'Shade for the shy',
      hint: 'A duskcap in a shadow thinks it is night.',
      rows: [
        '_  _  _  .  .  _  _  _',
        '.@ .  .  .  .h .  _  _',
        '.l .b #  .f .  .d ^  ^E',
        '_  ^  ^  ^  ^  ^  _  _',
      ],
    },
    {
      id: 'r306',
      name: 'Two doors',
      hint: 'One crate can do two jobs, one after the other.',
      rows: [
        '_  .   .   _   _   _',
        '.@ .o1 .c  .g1 .   .o2',
        '_  .   .   _   .g2 _',
        '_  _   _   _   .E  _',
      ],
    },
    {
      id: 'r307',
      name: 'Stepping crate',
      hint: 'From the top of a bloom you can step down onto a crate.',
      rows: [
        '.  .c .  .  _  .',
        '.  _  .L .d ^  .',
        '.@ .b .c _  _  .',
        '.  .L _  _  .E .',
      ],
    },
    {
      id: 'r308',
      name: 'Yard work',
      hint: 'A crate is a weight, a doorstop and a step.',
      rows: [
        '.  .  .  _  .  .E',
        '.  .c .  _  .  _',
        '.  _  .  .  .L .d',
        '.@ _  .  .b .  .',
      ],
    },
  ],
};
