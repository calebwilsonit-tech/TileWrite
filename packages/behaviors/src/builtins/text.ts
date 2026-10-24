import { C, makeLabel, type Collider, type Entity, type Label, type Sprite, type TransformIso } from '@tilewright/runtime';
import { behaviorDef, stateOf } from '../framework';
import { input, setOutput } from '../signals';
import { pushStep, type PushState } from './puzzle';
import { interactedBy } from './interact';

const collider = (e: Entity): Collider | undefined => e.get<Collider>(C.Collider);
const sprite = (e: Entity): Sprite | undefined => e.get<Sprite>(C.Sprite);

function setLabel(e: Entity, label: Label): void {
  const cur = e.get<Label>('label');
  if (cur && cur.text === label.text && cur.bold === label.bold && cur.italic === label.italic && cur.underline === label.underline && cur.color === label.color) return;
  e.set('label', label);
}

// ---------- sentence stone ----------

export interface SentenceStone {
  /** Words before the swappable word. */
  before: string;
  /** The swappable words, separated by commas. */
  words: string;
  after: string;
  /** Which word is showing (0 = the first). */
  selected: number;
  reach: number;
  /** Variable that holds the chosen word (optional). */
  variable: string;
}

export function sentenceWords(s: Pick<SentenceStone, 'words'>): string[] {
  return s.words
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function sentenceText(s: SentenceStone): string {
  const words = sentenceWords(s);
  const w = words.length ? words[((s.selected % words.length) + words.length) % words.length]! : '...';
  return [s.before.trim(), `[ ${w.toUpperCase()} ]`, s.after.trim()].filter(Boolean).join(' ');
}

export const sentenceStone = behaviorDef<SentenceStone>({
  id: 'sentenceStone',
  name: 'Sentence Stone',
  category: 'Story puzzles',
  description:
    'A stone showing a sentence with one swappable word, like "The bridge [ HOLDS ]". The player changes the word with the interact button. Each word has its own signal: wire "Word 1" to the thing that should happen for the first word, "Word 2" for the second, and so on.',
  phase: 'source',
  defaults: { before: 'The bridge', words: 'breaks, holds', after: '', selected: 0, reach: 1.5, variable: '' },
  fields: [
    { key: 'before', label: 'Words before', type: 'text' },
    { key: 'words', label: 'The swappable words (separated by commas)', type: 'text', help: 'Up to 8. The first four have signals you can wire.' },
    { key: 'after', label: 'Words after', type: 'text' },
    { key: 'selected', label: 'Starts on word number (0 = first)', type: 'number', min: 0, max: 7, step: 1 },
    { key: 'reach', label: 'How close the player must be (cells)', type: 'number', min: 0.5, max: 5, step: 0.1 },
    { key: 'variable', label: 'Also store the chosen word in this variable (optional)', type: 'text' },
  ],
  inputs: [{ name: 'next', label: 'Next word', help: 'A rising signal swaps to the next word.' }],
  outputs: [
    { name: 'word1', label: 'Word 1 is chosen' },
    { name: 'word2', label: 'Word 2 is chosen' },
    { name: 'word3', label: 'Word 3 is chosen' },
    { name: 'word4', label: 'Word 4 is chosen' },
  ],
  requires: { collider: { w: 0.7, d: 0.7, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } },
  summary: (s) => `Shows: ${sentenceText(s)}`,
  update(ctx, e, s) {
    const words = sentenceWords(s);
    const st = stateOf(e, 'sentenceStone', () => ({ prevNext: false }));
    const next = input(e, 'next');
    let advance = next && !st.prevNext;
    st.prevNext = next;
    if (interactedBy(ctx, e, s.reach, 'sentenceStone')) advance = true;
    if (advance && words.length > 1) {
      s.selected = (s.selected + 1) % words.length;
      ctx.events.emit('sentence-changed', { entity: e.id, word: words[s.selected] });
    }
    if (words.length > 0) s.selected = ((s.selected % words.length) + words.length) % words.length;
    for (let i = 0; i < 4; i++) setOutput(e, `word${i + 1}`, i === s.selected && i < words.length);
    if (s.variable && words.length > 0) ctx.runtime.vars[s.variable] = words[s.selected]!;
    setLabel(e, makeLabel({ text: sentenceText(s), color: 0xfff2c0, size: 14, lift: 0.3 }));
  },
});

// ---------- formattable text block ----------

export type TextFormat = 'plain' | 'underline' | 'bold' | 'italic';

export const TEXT_FORMATS: TextFormat[] = ['plain', 'underline', 'bold', 'italic'];

export interface TextBlock {
  text: string;
  /** How the text is formatted at the start. */
  format: TextFormat;
  /** Can the player change the formatting with the interact button? */
  playerCanFormat: boolean;
  reach: number;
  /** Height of the wall that bold makes. */
  wallHeight: number;
  /** Cells per second when italic text slides. */
  slideSpeed: number;
}

const FORMAT_LOOK: Record<TextFormat, { color: number; height: number; solid: boolean }> = {
  plain: { color: 0xb9b4c9, height: 0.1, solid: false },
  underline: { color: 0x6aa8ff, height: 0.12, solid: true },
  bold: { color: 0xb5524a, height: 2, solid: true },
  italic: { color: 0xf0c75e, height: 0.7, solid: true },
};

/** Which format applies: a wired signal wins over the block's own setting (bold, then underline, then italic). */
export function effectiveFormat(e: Entity, own: TextFormat): TextFormat {
  if (input(e, 'bold')) return 'bold';
  if (input(e, 'underline')) return 'underline';
  if (input(e, 'italic')) return 'italic';
  return own;
}

export const textBlock = behaviorDef<TextBlock>({
  id: 'textBlock',
  name: 'Formattable Text Block',
  category: 'Story puzzles',
  description:
    'A block of text whose formatting changes the world: plain text does nothing, underlined text becomes a flat bridge you can walk over, bold text becomes a wall, and italic text becomes slippery and slides when pushed. The player formats it with the interact button, or a wire does.',
  phase: 'control',
  defaults: { text: 'BRIDGE', format: 'plain', playerCanFormat: true, reach: 1.5, wallHeight: 2, slideSpeed: 5 },
  fields: [
    { key: 'text', label: 'The text', type: 'text' },
    {
      key: 'format',
      label: 'Starts as',
      type: 'select',
      options: [
        { value: 'plain', label: 'Plain (nothing happens)' },
        { value: 'underline', label: 'Underlined (a bridge)' },
        { value: 'bold', label: 'Bold (a wall)' },
        { value: 'italic', label: 'Italic (slides)' },
      ],
    },
    { key: 'playerCanFormat', label: 'The player can change the formatting', type: 'boolean' },
    { key: 'reach', label: 'How close the player must be (cells)', type: 'number', min: 0.5, max: 5, step: 0.1 },
    { key: 'wallHeight', label: 'Height of the bold wall (levels)', type: 'number', min: 0.5, max: 6, step: 0.1 },
    { key: 'slideSpeed', label: 'Slide speed when italic (cells per second)', type: 'number', min: 1, max: 20, step: 0.5 },
  ],
  inputs: [
    { name: 'underline', label: 'Underline', help: 'While on, the text is underlined (a bridge).' },
    { name: 'bold', label: 'Bold', help: 'While on, the text is bold (a wall).' },
    { name: 'italic', label: 'Italic', help: 'While on, the text is italic (slides).' },
  ],
  outputs: [],
  requires: { collider: { w: 2, d: 1, height: 0.1, solid: false, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } },
  summary: (s) => `Reads "${s.text}", currently ${s.format}.`,
  update(ctx, e, s) {
    if (s.playerCanFormat && interactedBy(ctx, e, s.reach, 'textBlock')) {
      s.format = TEXT_FORMATS[(TEXT_FORMATS.indexOf(s.format) + 1) % TEXT_FORMATS.length]!;
      ctx.events.emit('text-formatted', { entity: e.id, format: s.format });
    }
    const fmt = effectiveFormat(e, s.format);
    const look = FORMAT_LOOK[fmt];
    const height = fmt === 'bold' ? s.wallHeight : look.height;
    const sp = sprite(e);
    if (sp) {
      sp.color = look.color;
      sp.height = height;
    }
    const c = collider(e);
    if (c) {
      c.height = height;
      c.solid = look.solid;
      c.enabled = look.solid;
    }
    setLabel(e, makeLabel({ text: s.text, color: 0xffffff, size: 15, bold: fmt === 'bold', italic: fmt === 'italic', underline: fmt === 'underline', lift: fmt === 'bold' ? 0.3 : 0.5 }));
    const push = stateOf<PushState>(e, 'textBlock', () => ({ target: null, dx: 0, dy: 0 }));
    if (fmt === 'italic' && c) pushStep(ctx, e, push, s.slideSpeed, true);
    else push.target = null;
  },
});
