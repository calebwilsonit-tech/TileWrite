import { describe, expect, it } from 'vitest';
import { CutsceneSchema, checkCutscene } from './cutscene';
import { LanguageSchema, StringTables, csvToStrings, languageChoices, newLanguage, parseCsv, stringsToCsv } from './strings';

function tables(): StringTables {
  const t = new StringTables();
  const fr = newLanguage('fr', 'Français');
  fr.strings = { 'Hello, {who}!': 'Bonjour, {who} !', Resume: 'Reprendre', Empty: '' };
  t.set(fr);
  return t;
}

describe('translations', () => {
  it('shows the text as written until a language is chosen, and falls back for anything untranslated', () => {
    const t = tables();
    expect(t.t('Resume')).toBe('Resume');
    t.language = 'fr';
    expect(t.t('Resume')).toBe('Reprendre');
    expect(t.t('Quit')).toBe('Quit'); // not translated yet
    expect(t.t('Empty')).toBe('Empty'); // an empty translation counts as missing
    expect(t.t('')).toBe('');
    t.language = 'xx';
    expect(t.t('Resume')).toBe('Resume'); // an unknown language is the source text
  });

  it('translates a template first and then fills in the placeholders', () => {
    const t = tables();
    expect(t.fmt('Hello, {who}!', { who: 'Ada' })).toBe('Hello, Ada!');
    t.language = 'fr';
    expect(t.fmt('Hello, {who}!', { who: 'Ada' })).toBe('Bonjour, Ada !');
    expect(t.fmt('Slot {n} of {m}', { n: 2 })).toBe('Slot 2 of {m}');
  });

  it('lists the languages with the source first', () => {
    expect(languageChoices(tables())).toEqual([
      { code: '', name: 'Default' },
      { code: 'fr', name: 'Français' },
    ]);
  });

  it('checks language files', () => {
    expect(LanguageSchema.safeParse({ code: 'pt-br', name: 'Português' }).success).toBe(true);
    expect(LanguageSchema.safeParse({ code: 'French', name: 'x' }).success).toBe(false);
    expect(LanguageSchema.parse({ code: 'de', name: 'Deutsch' }).strings).toEqual({});
  });
});

describe('cutscene sound checks', () => {
  it('say which step names a sound that is not there, or has none chosen', () => {
    const c = CutsceneSchema.parse({ name: 'C', steps: [{ id: 'a', type: 'wait' }, { id: 'b', type: 'sound', name: 'boom' }, { id: 'c', type: 'music', name: '' }, { id: 'd', type: 'sound', name: '' }] });
    const known = { dialogues: new Set<string>(), items: new Set<string>() };
    expect(checkCutscene(c, known).map((p) => p.text)).toEqual(['Step 4 (Play a sound) has no sound chosen.']);
    const text = checkCutscene(c, { ...known, sounds: new Set(['chime']) }).map((p) => p.text);
    expect(text).toEqual(['Step 2 (Play a sound) uses the sound "boom", which is not in Assets -> Sounds.', 'Step 4 (Play a sound) has no sound chosen.']);
  });
});

describe('CSV for translators', () => {
  it('round-trips commas, quotes and line breaks', () => {
    const rows: [string, string][] = [
      ['Hello, world', 'Bonjour, le monde'],
      ['She said "no"', 'Elle a dit « non »'],
      ['Two\nlines', ''],
    ];
    const text = stringsToCsv(rows);
    expect(text.startsWith('source,translation\r\n')).toBe(true);
    expect(parseCsv(text).slice(1)).toEqual([
      ['Hello, world', 'Bonjour, le monde'],
      ['She said "no"', 'Elle a dit « non »'],
      ['Two\nlines', ''],
    ]);
  });

  it('reads back only known sources, ignores empty translations and counts the rest', () => {
    const csv = '﻿source,translation\nResume,Reprendre\nQuit,\nGone,Parti\n';
    const r = csvToStrings(csv, new Set(['Resume', 'Quit']));
    expect(r.strings).toEqual({ Resume: 'Reprendre' });
    expect(r.skipped).toBe(1);
  });
});
