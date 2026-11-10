import type { Chapter } from '../build';

/** Chapter four: braziers (a light you push), sunken beds (a bloom there rises level with the path) and ponds. */
export const CH4: Chapter = {
  id: 'ch4',
  name: 'The Brazier Court',
  line: 'Here the light has wheels. A brazier warms the eight beds round it, wherever you leave it. Mind the sunken beds and the pond.',
  rooms: [
    {
      id: 'r401',
      name: 'Warm hands',
      hint: 'A brazier lights the eight beds round it.',
      rows: [
        '.@ .z .  .  _  _',
        '_  _  .  .d .  .E',
      ],
    },
    {
      id: 'r402',
      name: 'Sunken bed',
      hint: 'A bloom in a sunken bed rises level with the path.',
      rows: [
        '_  _  .l _  _  _',
        '.@ .  .  ~b .  .E',
        '_  _  _  ~  _  _',
      ],
    },
    {
      id: 'r403',
      name: 'Cellar lamp',
      hint: 'Down in a sunken bed you can only reach what is down there with you.',
      rows: [
        '.@ .  ~  ~l _  _',
        '_  _  ~  ~b .  .E',
        '_  _  ~* ~  _  _',
      ],
    },
    {
      id: 'r404',
      name: 'Fire walk',
      hint: 'Push the light to where it is wanted.',
      rows: [
        '_  .  .  .  .  _  _',
        '.@ .z .  .  .  .  _',
        '_  _  ~b _  ~b .  .E',
        '_  _  .  .* .  _  _',
      ],
    },
    {
      id: 'r405',
      name: 'Lily pond',
      hint: 'Light crosses water. Feet do not.',
      rows: [
        '.@ .z .  w  .  _',
        '_  .  .  ~b .  .E',
        '_  _  .  w  .* _',
      ],
    },
    {
      id: 'r406',
      name: 'Not too near',
      hint: 'What the fire wakes on one side it may wake on the other.',
      rows: [
        '.@ .z .  .  .  _',
        '.  .  .b .d .  .E',
        '_  _  .* _  _  _',
      ],
    },
  ],
};
