import { describeRef, entityParam, num, resolveRef, str, type ActionDef, type ConditionDef } from '@tilewright/plugin-sdk';
import { echoEntities } from './echo';
import { effectiveFormat, sentenceWords, TEXT_FORMATS, type SentenceStone, type TextBlock, type TextFormat } from './text';

export const conditions: ConditionDef[] = [
  {
    id: 'echoCount',
    label: 'Echoes exist',
    category: 'Puzzles',
    params: [{ key: 'atLeast', label: 'At least how many', type: 'number', default: 1, min: 0, step: 1 }],
    describe: (p) => `there are at least ${num(p, 'atLeast', 1)} echoes`,
    test: (ctx, p) => echoEntities(ctx).length >= num(p, 'atLeast', 1),
  },
  {
    id: 'stoneSays',
    label: 'A sentence stone shows a word',
    category: 'Puzzles',
    params: [entityParam('stone', 'Which stone', ''), { key: 'word', label: 'The word (as written in the stone)', type: 'text', default: '' }],
    describe: (p, n) => `${describeRef(str(p, 'stone'), n)} shows the word "${str(p, 'word') || '(word)'}"`,
    test: (ctx, p, row) =>
      resolveRef(ctx, str(p, 'stone'), row.picked).some((e) => {
        const s = e.get<SentenceStone>('sentenceStone');
        if (!s) return false;
        const words = sentenceWords(s);
        return words.length > 0 && words[((s.selected % words.length) + words.length) % words.length]!.toLowerCase() === str(p, 'word').trim().toLowerCase();
      }),
  },
  {
    id: 'textIs',
    label: 'A text block is formatted a certain way',
    category: 'Puzzles',
    params: [
      entityParam('block', 'Which text block', ''),
      { key: 'format', label: 'Formatting', type: 'select', default: 'underline', options: TEXT_FORMATS.map((f) => ({ value: f, label: f })) },
    ],
    describe: (p, n) => `${describeRef(str(p, 'block'), n)} is ${str(p, 'format')}`,
    test: (ctx, p, row) =>
      resolveRef(ctx, str(p, 'block'), row.picked).some((e) => {
        const s = e.get<TextBlock>('textBlock');
        return !!s && effectiveFormat(e, s.format) === str(p, 'format');
      }),
  },
];

export const actions: ActionDef[] = [
  {
    id: 'setWord',
    label: 'Change the word of a sentence stone',
    category: 'Puzzles',
    params: [entityParam('stone', 'Which stone', ''), { key: 'word', label: 'The word to show (as written in the stone)', type: 'text', default: '' }],
    describe: (p, n) => `make ${describeRef(str(p, 'stone'), n)} show "${str(p, 'word') || '(word)'}"`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'stone'), row.picked)) {
        const s = e.get<SentenceStone>('sentenceStone');
        if (!s) continue;
        const at = sentenceWords(s).findIndex((w) => w.toLowerCase() === str(p, 'word').trim().toLowerCase());
        if (at >= 0 && at !== s.selected) {
          s.selected = at;
          ctx.events.emit('sentence-changed', { entity: e.id, word: sentenceWords(s)[at] });
        }
      }
    },
  },
  {
    id: 'formatText',
    label: 'Format a text block',
    category: 'Puzzles',
    params: [
      entityParam('block', 'Which text block', ''),
      { key: 'format', label: 'Formatting', type: 'select', default: 'underline', options: TEXT_FORMATS.map((f) => ({ value: f, label: f })) },
    ],
    describe: (p, n) => `make ${describeRef(str(p, 'block'), n)} ${str(p, 'format')}`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'block'), row.picked)) {
        const s = e.get<TextBlock>('textBlock');
        if (s && s.format !== str(p, 'format')) {
          s.format = str(p, 'format') as TextFormat;
          ctx.events.emit('text-formatted', { entity: e.id, format: s.format });
        }
      }
    },
  },
  {
    id: 'clearEchoes',
    label: 'Make every echo vanish',
    category: 'Puzzles',
    params: [],
    describe: () => 'make every echo vanish',
    run: (ctx) => void echoEntities(ctx).forEach((e) => ctx.world.destroy(e)),
  },
];
