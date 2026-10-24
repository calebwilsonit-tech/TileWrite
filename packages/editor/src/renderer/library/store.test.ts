import { describe, expect, it } from 'vitest';
import { Library, allTags, folderProblem, searchItems, type LibraryFs } from './store';
import { PACK_FORMAT, PACK_VERSION, type Pack } from './pack';

function memFs(): LibraryFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: async (f) => {
      if (!files.has(f)) throw new Error('missing');
      return files.get(f)!;
    },
    write: async (f, t) => void files.set(f, t),
    remove: async (f) => void files.delete(f),
    exists: async (f) => files.has(f),
  };
}

const pack = (name: string, over: Partial<Pack> = {}): Pack => ({ format: PACK_FORMAT, formatVersion: PACK_VERSION, name, kind: 'tile', description: '', author: '', licence: 'CC0-1.0', tags: [], createdAt: '', files: [], tiles: [], autotile: [], uiPrefabs: [], uiScreens: [], code: false, ...over });

describe('the personal library', () => {
  it('saves items, keeps every version, and restores an older one', async () => {
    const fs = memFs();
    const lib = new Library(fs, 'L', () => '2026-01-01T00:00:00Z');
    const a = await lib.save(pack('Meadow'), { tags: ['grass'] });
    expect(a).toMatchObject({ id: 'meadow', current: 1, tags: ['grass'] });
    const b = await lib.save(pack('Meadow', { description: 'second' }), { id: 'meadow', note: 'Greener' });
    expect(b.current).toBe(2);
    expect(b.versions.map((v) => v.note)).toEqual(['First saved', 'Greener']);
    expect((await lib.readPack('meadow')).description).toBe('second');
    await lib.restore('meadow', 1);
    expect((await lib.readPack('meadow')).description).toBe('');
    expect((await lib.readPack('meadow', 2)).description).toBe('second');
    await expect(lib.readPack('meadow', 9)).rejects.toThrow('Version 9');
    // a second library on the same folder sees the same list
    const other = new Library(fs, 'L');
    await other.load();
    expect(other.index.items.map((i) => [i.id, i.current])).toEqual([['meadow', 1]]);
  });

  it('gives items with the same name different ids; folders, tags, search and removal', async () => {
    const lib = new Library(memFs(), 'L');
    const a = await lib.save(pack('Oak', { kind: 'prop' }), { folder: 'Trees', tags: ['tree', 'green'] });
    const b = await lib.save(pack('Oak', { kind: 'prop' }));
    expect(a.id).not.toBe(b.id);
    await lib.save(pack('Stone', { kind: 'tileset', description: 'grey bricks' }), { tags: ['wall'] });
    expect(lib.index.folders).toEqual(['Trees']);
    expect(searchItems(lib.index.items, { text: 'oak' })).toHaveLength(2);
    expect(searchItems(lib.index.items, { text: 'grey' }).map((i) => i.name)).toEqual(['Stone']);
    expect(searchItems(lib.index.items, { kind: 'prop', folder: 'Trees' }).map((i) => i.id)).toEqual([a.id]);
    expect(searchItems(lib.index.items, { tag: 'WALL' }).map((i) => i.name)).toEqual(['Stone']);
    expect(allTags(lib.index.items)).toEqual(['green', 'tree', 'wall']);
    await lib.update(b.id, { name: 'Birch', tags: ['tree', ' tree ', ''], folder: 'Trees' });
    expect(lib.item(b.id)).toMatchObject({ name: 'Birch', tags: ['tree'], folder: 'Trees' });
    await lib.removeFolder('Trees');
    expect(lib.item(a.id)!.folder).toBe('');
    await lib.remove(a.id);
    expect(lib.index.items.map((i) => i.id)).not.toContain(a.id);
    await expect(lib.readPack(a.id)).rejects.toThrow('no longer exists');
  });

  it('checks folder names and reports a damaged list plainly', async () => {
    expect(folderProblem('', [])).toContain('Give');
    expect(folderProblem('a/b:c', [])).toContain('cannot contain');
    expect(folderProblem('trees', ['Trees'])).toContain('already exists');
    expect(folderProblem('Trees', [])).toBeNull();
    const fs = memFs();
    fs.files.set('L/index.json', '{nope');
    await expect(new Library(fs, 'L').load()).rejects.toThrow('damaged');
  });
});
