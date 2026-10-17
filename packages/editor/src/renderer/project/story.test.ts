import { describe, expect, it } from 'vitest';
import { ItemSchema, newCutscene, newDialogue, newSkin } from '@tilewright/runtime';
import type { AssetFs } from '../studio/assets';
import { deleteCutscene, deleteDialogue, loadCutscenes, loadDialogues, loadItems, loadSkins, saveCutscene, saveDialogue, saveItems, saveSkins, skinProblems, storyNameProblem } from './story';

function memoryFs(): AssetFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(f) {
      const v = files.get(f);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    async write(f, t) {
      files.set(f, t);
    },
    async writeBinary() {},
    async readBinary() {
      return new Uint8Array();
    },
    async exists(f) {
      return files.has(f);
    },
    async remove(f) {
      files.delete(f);
    },
    async list(dir) {
      return [...files.keys()].filter((k) => k.startsWith(dir + '/')).map((k) => ({ name: k.slice(dir.length + 1), dir: false }));
    },
  };
}

describe('story files', () => {
  it('items round-trip, and an empty or missing file is simply no items', async () => {
    const fs = memoryFs();
    expect(await loadItems(fs, '/p')).toEqual({ items: [], problems: [] });
    const key = ItemSchema.parse({ id: 'key', name: 'Key', color: 0xffcc00 });
    await saveItems(fs, '/p', [key]);
    const r = await loadItems(fs, '/p');
    expect(r.problems).toEqual([]);
    expect(r.items).toEqual([key]);
  });

  it('refuses two items with the same id and reports a damaged file instead of crashing', async () => {
    const fs = memoryFs();
    const a = ItemSchema.parse({ id: 'a', name: 'A' });
    await expect(saveItems(fs, '/p', [a, a])).rejects.toThrow(/share the id "a"/);
    fs.files.set('/p/assets/items.json', '{ nope');
    const r = await loadItems(fs, '/p');
    expect(r.items).toEqual([]);
    expect(r.problems[0]).toMatch(/could not be read/);
    fs.files.set('/p/assets/items.json', JSON.stringify({ items: [{ id: 'bad id', name: 'x' }] }));
    expect((await loadItems(fs, '/p')).problems[0]).toMatch(/not valid/);
  });

  it('saves, lists, loads and deletes dialogues and cutscenes', async () => {
    const fs = memoryFs();
    await saveDialogue(fs, '/p', newDialogue('Keeper'));
    await saveCutscene(fs, '/p', newCutscene('Intro'));
    expect([...(await loadDialogues(fs, '/p')).items.keys()]).toEqual(['Keeper']);
    expect([...(await loadCutscenes(fs, '/p')).items.keys()]).toEqual(['Intro']);
    await deleteDialogue(fs, '/p', 'Keeper');
    await deleteCutscene(fs, '/p', 'Intro');
    expect((await loadDialogues(fs, '/p')).items.size).toBe(0);
    expect((await loadCutscenes(fs, '/p')).items.size).toBe(0);
  });

  it('reports a damaged dialogue file and keeps the good ones', async () => {
    const fs = memoryFs();
    await saveDialogue(fs, '/p', newDialogue('Good'));
    fs.files.set('/p/assets/dialogues/Bad.dialogue.json', '{ broken');
    const r = await loadDialogues(fs, '/p');
    expect([...r.items.keys()]).toEqual(['Good']);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/dialogue "Bad"/);
  });

  it('checks names in plain English', () => {
    expect(storyNameProblem('', [], 'dialogue')).toMatch(/Give the dialogue a name/);
    expect(storyNameProblem('a/b', [], 'cutscene')).toMatch(/letters, numbers/);
    expect(storyNameProblem('Keeper', ['keeper'], 'dialogue')).toMatch(/already exists/);
    expect(storyNameProblem('Old Keeper')).toBeNull();
  });

  it('skins round-trip and are checked in plain English', async () => {
    const fs = memoryFs();
    expect(await loadSkins(fs, '/p')).toEqual({ skins: [], problems: [] });
    const red = { ...newSkin('red', 'Red'), color: 0xff0000 };
    await saveSkins(fs, '/p', [red]);
    expect((await loadSkins(fs, '/p')).skins).toEqual([red]);
    await expect(saveSkins(fs, '/p', [red, red])).rejects.toThrow(/share the id "red"/);
    fs.files.set('/p/assets/skins.json', '{ nope');
    expect((await loadSkins(fs, '/p')).problems[0]).toMatch(/could not be read/);
    const known = { sprites: new Set(['hero']), items: new Set(['key']) };
    expect(skinProblems([newSkin('a', 'Plain')], known)[0]).toMatch(/looks exactly like the original/);
    expect(skinProblems([{ ...red, sprite: 'ghost' }], known)[0]).toMatch(/sprite "ghost"/);
    expect(skinProblems([{ ...red, unlock: { kind: 'item', item: 'nope' } }], known)[0]).toMatch(/item "nope"/);
    expect(skinProblems([{ ...red, unlock: { kind: 'variable', name: '', atLeast: 1 } }], known)[0]).toMatch(/none is named/);
    expect(skinProblems([red], known)).toEqual([]);
  });
});
