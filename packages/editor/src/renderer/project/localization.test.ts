import { describe, expect, it } from 'vitest';
import '../../bundled';
import { setActivePacks } from '@tilewright/behaviors';
import { CutsceneSchema, DialogueSchema, newLanguage, type SceneData } from '@tilewright/runtime';
import { newAction, newRow } from '@tilewright/behaviors';
import type { AssetFs } from '../studio/assets';
import { collectStrings, coverage, deleteLanguage, languageProblem, loadLanguages, makeLanguage, saveLanguage } from './localization';
import { templateById } from './templates';

function memFs(): AssetFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(f) {
      const v = files.get(f);
      if (v === undefined) throw new Error('missing');
      return v;
    },
    async write(f, t) {
      files.set(f, t);
    },
    async readBinary() {
      return new Uint8Array();
    },
    async writeBinary() {},
    async exists(f) {
      return files.has(f);
    },
    async remove(f) {
      files.delete(f);
    },
    async list(dir) {
      const p = dir.endsWith('/') ? dir : `${dir}/`;
      const names = [...files.keys()].filter((k) => k.startsWith(p)).map((k) => k.slice(p.length));
      if (names.length === 0) throw new Error('no folder');
      return names.map((name) => ({ name, dir: false }));
    },
  };
}

const dialogue = DialogueSchema.parse({
  name: 'Elder',
  start: 'a',
  nodes: [
    { id: 'a', type: 'line', speaker: 'Elder', text: 'Will you mend them, {who}?', next: 'b' },
    { id: 'b', type: 'choice', speaker: 'Elder', prompt: 'Well?', options: [{ text: 'I will.' }, { text: 'Not yet.' }] },
  ],
});

function scene(): SceneData {
  const s = templateById('empty-iso').build('T').scene;
  const row = newRow('r1');
  row.actions = [{ ...newAction('message'), params: { text: 'The seal opens.' } }];
  s.events = [row];
  s.entities.push({ id: 'p', name: 'Bread loaf', tags: [], components: { pickup: { message: 'Fresh bread!' } } });
  return s;
}

describe('finding the text to translate', () => {
  const story = {
    dialogues: new Map([['Elder', dialogue]]),
    cutscenes: new Map([['Intro', CutsceneSchema.parse({ name: 'Intro', steps: [{ id: 's', type: 'say', speaker: 'Elder', text: 'Welcome.' }, { id: 'm', type: 'message', text: 'A bell tolls.' }] })]]),
  };
  setActivePacks(['inventory']);
  const found = collectStrings(story, [{ path: 'scenes/main.scene.json', scene: scene() }], ['Resume'], { items: [{ id: 'bread', name: 'Bread', description: 'Warm.', color: 0xcccccc, max: 0, use: { heal: 1, setVariable: '', setValue: 1, consume: true, message: 'Tasty.' } }] });
  const texts = found.map((f) => f.text);

  it('collects conversations, cutscenes, items, messages and the menus, once each', () => {
    expect(texts).toEqual(['Elder', 'Will you mend them, {who}?', 'Well?', 'I will.', 'Not yet.', 'Welcome.', 'A bell tolls.', 'Bread', 'Warm.', 'Tasty.', 'The seal opens.', 'Fresh bread!', 'Resume']);
  });

  it('says where each text came from', () => {
    expect(found.find((f) => f.text === 'Elder')!.where).toBe('Dialogue Elder'); // the first place it appears
    expect(found.find((f) => f.text === 'The seal opens.')!.where).toBe('Scene main');
    expect(found.find((f) => f.text === 'Fresh bread!')!.where).toBe('Scene main: Bread loaf');
    expect(found.find((f) => f.text === 'Resume')!.where).toBe('Game menus and messages');
  });

  it('counts what a language still lacks and what it has that is no longer used', () => {
    const fr = newLanguage('fr', 'Français');
    fr.strings = { Elder: 'Ancien', 'Old text': 'Ancien texte', Welcome: '' };
    const c = coverage(fr, found);
    expect(c.done).toBe(1);
    expect(c.total).toBe(found.length);
    expect(c.missing.map((m) => m.text)).not.toContain('Elder');
    expect(c.unused).toEqual(['Old text']);
  });
});

describe('language files', () => {
  it('saves only translated text and loads it back; damaged files are reported, not fatal', async () => {
    const fs = memFs();
    const fr = makeLanguage('fr', 'Français');
    fr.strings = { Resume: 'Reprendre', Quit: '  ' };
    await saveLanguage(fs, '/p', fr);
    fs.files.set('/p/assets/localization/xx.strings.json', '{ nope');
    fs.files.set('/p/assets/localization/yy.strings.json', JSON.stringify({ code: 'NOT A CODE', name: 'x' }));
    const r = await loadLanguages(fs, '/p');
    expect(r.languages).toHaveLength(1);
    expect(r.languages[0]!.strings).toEqual({ Resume: 'Reprendre' });
    expect(r.problems).toHaveLength(2);
    await deleteLanguage(fs, '/p', 'fr');
    expect((await loadLanguages(fs, '/p')).languages).toEqual([]);
  });

  it('explains a bad language code or a duplicate', () => {
    expect(languageProblem('French', 'Français', [])).toMatch(/short lower-case/);
    expect(languageProblem('fr', 'Français', ['fr'])).toMatch(/already exists/);
    expect(languageProblem('fr', ' ', [])).toMatch(/name/);
    expect(languageProblem('pt-br', 'Português', [])).toBeNull();
  });

  it('no folder yet means no languages', async () => {
    expect(await loadLanguages(memFs(), '/p')).toEqual({ languages: [], problems: [] });
  });
});
