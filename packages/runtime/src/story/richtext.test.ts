import { describe, expect, it } from 'vitest';
import { parseRichText, plainText, richTextProblems } from './richtext';

describe('inline text formatting', () => {
  it('leaves plain text alone, including square brackets that are not tags', () => {
    expect(parseRichText('Hello there')).toEqual([{ text: 'Hello there' }]);
    expect(parseRichText('Press [E] to talk')).toEqual([{ text: 'Press [E] to talk' }]);
    expect(parseRichText('')).toEqual([]);
  });

  it('cuts bold, italic, underline and strike into pieces', () => {
    expect(parseRichText('a [b]bold[/b] b')).toEqual([{ text: 'a ' }, { text: 'bold', bold: true }, { text: ' b' }]);
    expect(parseRichText('[i]x[/i][u]y[/u][s]z[/s]')).toEqual([{ text: 'x', italic: true }, { text: 'y', underline: true }, { text: 'z', strike: true }]);
  });

  it('nests tags and lets colours stack', () => {
    expect(parseRichText('[b]one [i]two[/i] three[/b]')).toEqual([{ text: 'one ', bold: true }, { text: 'two', bold: true, italic: true }, { text: ' three', bold: true }]);
    expect(parseRichText('[color=red]a[color=#00ff00]b[/color]c[/color]d')).toEqual([{ text: 'a', color: '#ff6b6b' }, { text: 'b', color: '#00ff00' }, { text: 'c', color: '#ff6b6b' }, { text: 'd' }]);
  });

  it('a doubled bracket is a literal bracket', () => {
    expect(parseRichText('say [[b]no[[/b]')).toEqual([{ text: 'say [b]no[/b]' }]);
    expect(plainText('[b]a[/b] [[ b')).toBe('a [ b');
  });

  it('treats unknown colours and tags with arguments as text, and never goes below zero on a stray close', () => {
    expect(parseRichText('[color=nope]x[/color]')).toEqual([{ text: '[color=nope]x' }]);
    expect(parseRichText('[b=1]x')).toEqual([{ text: '[b=1]x' }]);
    expect(parseRichText('x[/b]y')).toEqual([{ text: 'xy' }]);
    expect(parseRichText('[b]a')).toEqual([{ text: 'a', bold: true }]);
  });

  it('gives the words without the tags', () => {
    expect(plainText('The [color=gold]golden[/color] [b]key[/b]!')).toBe('The golden key!');
  });

  it('explains mistakes in plain English', () => {
    expect(richTextProblems('fine [b]text[/b]')).toEqual([]);
    expect(richTextProblems('[b]never closed')).toEqual(['[b] is never closed: add [/b].']);
    expect(richTextProblems('stray [/i] here')[0]).toMatch(/closing \[\/i\] with no \[i\]/);
    expect(richTextProblems('[color=banana]x[/color]')[0]).toMatch(/not a colour/);
    expect(richTextProblems('literal [[b] is fine')).toEqual([]);
  });
});

describe('dialogue checks for formatting', () => {
  it('reports an unclosed tag in a line and in a choice', async () => {
    const { checkDialogue } = await import('./dialogue');
    const known = { carried: new Set<string>(), variables: new Set<string>() };
    const d = {
      name: 'T',
      start: 'a',
      nodes: [
        { id: 'a', type: 'line', speaker: '', text: 'A [b]bold', next: 'c' },
        { id: 'c', type: 'choice', prompt: '', options: [{ text: '[i]yes', next: '' }] },
      ],
    } as never;
    const texts = checkDialogue(d, known).map((p) => p.text);
    expect(texts.some((t) => t.includes('[b] is never closed'))).toBe(true);
    expect(texts.some((t) => t.includes('[i] is never closed'))).toBe(true);
  });
});
