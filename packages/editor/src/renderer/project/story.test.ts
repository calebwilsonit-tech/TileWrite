import { beforeAll, describe, expect, it } from 'vitest';
import '../../bundled';
import { dataKinds, setActivePacks } from '@tilewright/behaviors';
import { newCutscene, newDialogue, newSkin } from '@tilewright/runtime';
import type { AssetFs } from '../studio/assets';
import { deleteCutscene, deleteDialogue, loadCutscenes, loadData, loadDialogues, loadSkins, saveAllData, saveCutscene, saveData, saveDialogue, saveSkins, skinProblems, storyNameProblem } from './story';

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
  describe('the data the plugins keep', () => {
    beforeAll(() => setActivePacks(['inventory', 'story']));
    const items = (): ReturnType<typeof dataKinds>[number] => dataKinds().find((d) => d.id === 'items')!;
    const key = { id: 'key', name: 'Key', description: '', color: 0xffcc00, max: 0 };

    it('records round-trip, and an empty or missing file is simply none', async () => {
      const fs = memoryFs();
      expect(await loadData(fs, '/p')).toEqual({ data: { items: [], minigames: [] }, problems: [] });
      await saveData(fs, '/p', items(), [key]);
      const r = await loadData(fs, '/p');
      expect(r.problems).toEqual([]);
      expect(r.data.items).toEqual([key]);
    });

    it('refuses two records with the same name and reports a damaged file instead of crashing', async () => {
      const fs = memoryFs();
      await expect(saveData(fs, '/p', items(), [key, key])).rejects.toThrow(/share the id "key"/);
      fs.files.set('/p/assets/items.json', '{ nope');
      const r = await loadData(fs, '/p');
      expect(r.data.items).toEqual([]);
      expect(r.problems[0]).toMatch(/could not be read/);
      fs.files.set('/p/assets/items.json', JSON.stringify({ items: [{ id: 'bad id', name: 'x' }] }));
      expect((await loadData(fs, '/p')).problems[0]).toMatch(/not valid/);
    });

    it('writes the file of a kind that always has one, and of the ones that have something in them', async () => {
      const fs = memoryFs();
      await saveAllData(fs, '/p', {});
      expect([...fs.files.keys()]).toEqual(['/p/assets/items.json']); // the minigames file waits until there is a minigame
      await saveAllData(fs, '/p', { minigames: [{ name: 'Duel', kind: 'timing' }] });
      expect(fs.files.has('/p/assets/minigames.json')).toBe(true);
    });

    it('leaves the file of a plugin that is off alone', async () => {
      const fs = memoryFs();
      fs.files.set('/p/assets/items.json', JSON.stringify({ items: [key] }));
      setActivePacks(['story']);
      try {
        const r = await loadData(fs, '/p');
        expect(Object.keys(r.data)).toEqual(['minigames']);
        await saveAllData(fs, '/p', r.data);
        expect(JSON.parse(fs.files.get('/p/assets/items.json')!).items).toHaveLength(1); // untouched, not lost
      } finally {
        setActivePacks(['inventory', 'story']);
      }
    });
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
