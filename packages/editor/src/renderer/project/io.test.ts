import { describe, expect, it } from 'vitest';
import { newScene, stringifyScene } from '@tilewright/runtime';
import {
  UserError,
  autosaveScene,
  clearAutosave,
  createProject,
  loadScene,
  openProject,
  readAutosave,
  safeFolderName,
  saveScene,
  scenePathFor,
  type ProjectFs,
} from './io';
import { TEMPLATES } from './templates';

function memoryFs(): ProjectFs & { files: Map<string, string> } {
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
    async exists(f) {
      return files.has(f);
    },
    async remove(f) {
      files.delete(f);
    },
  };
}

describe('project folders', () => {
  it('cleans names into safe folder names', () => {
    expect(safeFolderName('  My: Game?  ')).toBe('My Game');
    expect(safeFolderName('a/b\\c')).toBe('abc');
    expect(safeFolderName('...')).toBe('My Game');
    expect(safeFolderName('')).toBe('My Game');
  });

  it('creates a project from every template and opens it again', async () => {
    for (const t of TEMPLATES) {
      const fs = memoryFs();
      const created = await createProject(fs, 'C:\\Games', 'Test Game', t.id);
      expect(created.dir).toBe('C:\\Games\\Test Game');
      expect(created.project.scenes).toEqual(['scenes/main.scene.json']);
      const opened = await openProject(fs, created.dir);
      expect(opened.project.name).toBe('Test Game');
      const scene = await loadScene(fs, created.dir, opened.project.startScene);
      // the empty template has nothing in it at all: no player, no packs; the others start an action game
      if (t.id === 'empty') {
        expect(scene.entities).toEqual([]);
        expect(opened.project.packs).toEqual([]);
      } else expect(scene.entities.some((e) => e.tags.includes('player'))).toBe(true);
      expect(fs.files.get('C:\\Games\\Test Game\\.gitignore')).toContain('.tilewright');
    }
  });

  it('will not overwrite an existing project', async () => {
    const fs = memoryFs();
    await createProject(fs, '/g', 'A', 'empty-iso');
    await expect(createProject(fs, '/g', 'A', 'empty-iso')).rejects.toThrow(/already a Tilewright project/);
  });
});

describe('opening damaged or foreign files', () => {
  it('explains a missing project file', async () => {
    await expect(openProject(memoryFs(), '/nope')).rejects.toThrow(/could not read the project file/);
  });

  it('explains invalid JSON', async () => {
    const fs = memoryFs();
    fs.files.set('/p/project.json', '{ not json');
    const err = await openProject(fs, '/p').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UserError);
    expect((err as Error).message).toMatch(/damaged/);
  });

  it('explains a project from a newer version', async () => {
    const fs = memoryFs();
    fs.files.set('/p/project.json', JSON.stringify({ schemaVersion: 99, name: 'x', scenes: ['a'], startScene: 'a' }));
    await expect(openProject(fs, '/p')).rejects.toThrow(/newer Tilewright/);
  });

  it('explains a scene whose map layers do not match its size', async () => {
    const fs = memoryFs();
    const bad = newScene('Bad', 4, 4);
    bad.map.tiles.pop();
    fs.files.set('/p/scenes/bad.scene.json', JSON.stringify(bad));
    await expect(loadScene(fs, '/p', 'scenes/bad.scene.json')).rejects.toThrow(/tiles.*4 x 4|not valid.*tiles/);
  });
});

describe('save and autosave', () => {
  it('saves a scene and removes its autosave', async () => {
    const fs = memoryFs();
    const scene = newScene('A', 4, 4);
    await autosaveScene(fs, '/p', 'scenes/main.scene.json', scene);
    expect(await readAutosave(fs, '/p', 'scenes/main.scene.json')).not.toBeNull();
    await saveScene(fs, '/p', 'scenes/main.scene.json', scene);
    expect(await readAutosave(fs, '/p', 'scenes/main.scene.json')).toBeNull();
    expect(fs.files.get('/p/scenes/main.scene.json')).toBe(stringifyScene(scene));
  });

  it('never writes autosave over the real scene file', async () => {
    const fs = memoryFs();
    fs.files.set('/p/scenes/main.scene.json', 'ORIGINAL');
    await autosaveScene(fs, '/p', 'scenes/main.scene.json', newScene('A', 2, 2));
    expect(fs.files.get('/p/scenes/main.scene.json')).toBe('ORIGINAL');
  });

  it('ignores a damaged autosave', async () => {
    const fs = memoryFs();
    await autosaveScene(fs, '/p', 'scenes/main.scene.json', newScene('A', 2, 2));
    const key = [...fs.files.keys()].find((k) => k.includes('autosave'))!;
    fs.files.set(key, '{ broken');
    expect(await readAutosave(fs, '/p', 'scenes/main.scene.json')).toBeNull();
    await clearAutosave(fs, '/p', 'scenes/main.scene.json');
    expect(fs.files.has(key)).toBe(false);
  });
});

describe('scene paths', () => {
  it('makes unique slug paths', () => {
    expect(scenePathFor('Cave Level', [])).toBe('scenes/cave-level.scene.json');
    expect(scenePathFor('Cave Level', ['scenes/cave-level.scene.json'])).toBe('scenes/cave-level-2.scene.json');
    expect(scenePathFor('???', [])).toBe('scenes/scene.scene.json');
  });
});
