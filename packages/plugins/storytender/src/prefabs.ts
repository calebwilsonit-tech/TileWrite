import { thing, type PrefabDef } from '@tilewright/plugin-sdk';

/** What this plugin adds to the editor's Place tool. */
export const prefabs: PrefabDef[] = [
  {
      id: 'lanternpost',
      label: 'Lantern post (checkpoint)',
      group: 'Story',
      hint: 'The player lights it and rests with Interact. Defeat returns them to the last post they rested at, and lit posts are in the Travel menu.',
      make: (x, y, h) => thing('Lantern post', ['lantern-post'], { color: 0x6b6f7a, w: 0.4, d: 0.4, height: 1.4 }, x, y, h, ['checkpoint']),
    },
  {
      id: 'stone',
      label: 'Sentence stone',
      group: 'Story puzzles',
      hint: 'A stone with a sentence and one swappable word ("The bridge [ HOLDS ]"). The player swaps the word with Interact; wire each word to what it should change.',
      make: (x, y, h) => thing('Sentence stone', ['stone'], { color: 0x9ea7c4, w: 0.7, d: 0.7, height: 1 }, x, y, h, ['sentenceStone']),
    },
  {
      id: 'text',
      label: 'Text block',
      group: 'Story puzzles',
      hint: 'A block of text. Underlined it becomes a bridge, bold a wall, italic it slides. The player (or a wire) changes the formatting.',
      make: (x, y, h) => thing('Text block', ['text'], { color: 0xb9b4c9, w: 2, d: 1, height: 0.1 }, x, y, h, ['textBlock']),
    },
  {
      id: 'lightsensor',
      label: 'Light sensor',
      group: 'Light',
      hint: 'Sends a signal while the spot it stands on is lit (or dark). Wire it to a gate.',
      make: (x, y, h) => thing('Light sensor', ['sensor'], { shape: 'diamond', color: 0xffe9a8, w: 0.9, d: 0.9, height: 0.05 }, x, y, h, ['lightSensor']),
    },
  {
      id: 'dough',
      label: 'Rising dough',
      group: 'Light',
      hint: 'Grows taller over time, faster near light. It becomes a taller solid block, so it can turn into a platform or wall.',
      make: (x, y, h) => thing('Rising dough', ['dough'], { color: 0xf3dfb1, w: 0.9, d: 0.9, height: 0.2 }, x, y, h, ['growing']),
    },
];
