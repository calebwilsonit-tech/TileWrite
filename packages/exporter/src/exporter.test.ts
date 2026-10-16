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
    expect(fileSafeName('The Last: Storytender?')).toBe('The Last Storytender');
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
