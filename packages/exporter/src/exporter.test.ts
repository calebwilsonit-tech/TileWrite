import { describe, expect, it } from 'vitest';
import { GameManifestSchema, ScriptsBundleSchema, buildManifest, defaultSettings, exeFileName, exportFolderName, fileSafeName, listGameFiles, parseSettings, settingsProblems, shouldInclude } from './index';

describe('export settings', () => {
  it('start from the project name', () => {
    expect(defaultSettings('  Cave Quest ')).toMatchObject({ gameName: 'Cave Quest', version: '1.0.0', windowWidth: 1280, windowHeight: 720, fullscreen: false });
    expect(defaultSettings('').gameName).toBe('My Game');
  });

  it('are read from a saved file, and a damaged file falls back to the defaults with a note', () => {
    const ok = parseSettings(JSON.stringify({ gameName: 'Zed', version: '2.1', fullscreen: true }), 'P');
    expect(ok.settings).toMatchObject({ gameName: 'Zed', version: '2.1', fullscreen: true, windowWidth: 1280 });
    expect(ok.problem).toBeUndefined();
    expect(parseSettings(null, 'P').settings.gameName).toBe('P');
    expect(parseSettings('{oops', 'P')).toMatchObject({ settings: { gameName: 'P' }, problem: expect.stringContaining('damaged') });
    expect(parseSettings(JSON.stringify({ windowWidth: 3 }), 'P').problem).toMatch(/could not be read/);
  });

  it('explain what is wrong in plain English', () => {
    expect(settingsProblems(defaultSettings('Fine'))).toEqual([]);
    expect(settingsProblems({ ...defaultSettings('x'), gameName: '  ' })).toContain('Give the game a name.');
    expect(settingsProblems({ ...defaultSettings('x'), version: 'one' })).toEqual(['The version should look like 1.0 or 1.2.3.']);
    expect(settingsProblems({ ...defaultSettings('x'), windowWidth: 100 })).toEqual(['The window must be at least 480 wide.']);
  });
});

describe('names', () => {
  it('make safe file names', () => {
    expect(fileSafeName('The Great: Journey?')).toBe('The Great Journey');
    expect(fileSafeName('  ..a/b\\c.. ')).toBe('abc');
    expect(fileSafeName('CON')).toBe('CON_');
    expect(fileSafeName('???')).toBe('Game');
    expect(fileSafeName('x'.repeat(80))).toHaveLength(50);
  });

  it('name the folder and the program per platform', () => {
    const s = { ...defaultSettings('Cave Quest'), version: '1.2' };
    expect(exportFolderName(s, 'win32')).toBe('Cave Quest-1.2-windows');
    expect(exportFolderName(s, 'linux')).toBe('Cave Quest-1.2-linux');
    expect(exeFileName(s, 'win32')).toBe('Cave Quest.exe');
    expect(exeFileName(s, 'linux')).toBe('Cave Quest');
  });
});

describe('what ships', () => {
  it('leaves out editor files, saves, recordings, notes and script sources', () => {
    for (const keep of ['project.json', 'scenes/main.scene.json', 'assets/sprites/hero.sprite.json', 'assets/prefabs/Crate.prefab.json', 'assets/story/items.json', 'assets/icon.png']) expect(shouldInclude(keep), keep).toBe(true);
    for (const drop of ['.tilewright/autosave/main.json', 'saves/slot1.json', 'playthroughs/a.playthrough.json', 'project-notes.md', 'export-settings.json', 'assets/scripts/Spinner.script.ts', 'scenes/main.scene.json.bak', 'scenes/x.tmp', '.git/config', 'node_modules/a/b.js']) expect(shouldInclude(drop), drop).toBe(false);
  });

  it('lists a folder tree with the same rules', async () => {
    const tree: Record<string, { name: string; dir: boolean }[]> = {
      '/p': [
        { name: 'project.json', dir: false },
        { name: 'scenes', dir: true },
        { name: 'saves', dir: true },
        { name: '.tilewright', dir: true },
        { name: 'assets', dir: true },
        { name: 'project-notes.md', dir: false },
      ],
      '/p/scenes': [
        { name: 'main.scene.json', dir: false },
        { name: 'main.scene.json.bak', dir: false },
      ],
      '/p/saves': [{ name: 'slot1.json', dir: false }],
      '/p/.tilewright': [{ name: 'x', dir: false }],
      '/p/assets': [
        { name: 'scripts', dir: true },
        { name: 'sprites', dir: true },
      ],
      '/p/assets/scripts': [{ name: 'A.script.ts', dir: false }],
      '/p/assets/sprites': [{ name: 'hero.sprite.json', dir: false }],
    };
    const files = await listGameFiles({ list: async (d) => tree[d] ?? [] }, '/p', (...parts) => parts.join('/'));
    expect(new Set(files)).toEqual(new Set(['project.json', 'assets/sprites/hero.sprite.json', 'scenes/main.scene.json']));
    expect(files).toHaveLength(3);
  });
});

describe('manifest', () => {
  it('describes how the game starts, and survives a round trip', () => {
    const m = buildManifest({ ...defaultSettings('Cave'), fullscreen: true, splashText: 'Hello' }, 'scenes/main.scene.json', ['Spinner'], '0.0.1');
    expect(GameManifestSchema.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
    expect(m.window).toEqual({ width: 1280, height: 720, fullscreen: true });
    expect(m.builtWith).toBe('Tilewright 0.0.1');
    expect(ScriptsBundleSchema.safeParse({ format: 1, scripts: { A: { js: 'export default {}' } } }).success).toBe(true);
    expect(ScriptsBundleSchema.safeParse({ format: 2, scripts: {} }).success).toBe(false);
  });
});

import { buildCredits, creditProblems, creditsOf } from './credits';

describe('credits for a game', () => {
  const links = JSON.stringify({
    links: [
      { itemId: 'oak', name: 'Oak tree', mode: 'link', version: 2, author: 'Ada', licence: 'CC-BY-4.0', source: 'http://hub.example/oak-1' },
      { itemId: 'rock', name: 'Rock', mode: 'copy', version: 1, author: 'Bob', licence: 'CC-BY-NC-4.0' },
      { itemId: 'mine', name: 'My own tile', mode: 'copy', version: 1 },
    ],
  });

  it('lists the items that have an author, with their licences and where they came from', () => {
    const credits = creditsOf(links);
    expect(credits.map((c) => c.name)).toEqual(['Oak tree', 'Rock']);
    const text = buildCredits('Little Game', credits)!;
    expect(text).toContain('"Oak tree" by Ada - CC BY 4.0 (from http://hub.example/oak-1)');
    expect(text).toContain('"Rock" by Bob - CC BY-NC 4.0');
    expect(text).toContain('https://creativecommons.org/licenses/by-nc/4.0/');
    expect(text).not.toContain('My own tile');
  });

  it('writes nothing when there is nothing to credit, and says when a licence stops a game from being sold', () => {
    expect(buildCredits('G', creditsOf(null))).toBeNull();
    expect(buildCredits('G', creditsOf('{broken'))).toBeNull();
    expect(creditProblems(creditsOf(links))[0]!.text).toContain('may not be used in a game that is sold');
    expect(creditProblems([{ name: 'X', author: 'Y', licence: '', source: '' }])[0]!.text).toContain('no licence');
    expect(creditProblems(creditsOf(JSON.stringify({ links: [{ name: 'A', author: 'B', licence: 'CC0-1.0' }] })))).toEqual([]);
  });
});
