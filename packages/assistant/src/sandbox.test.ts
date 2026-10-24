import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PathProblem, cleanRelative, isInside, resolveInsideAny, resolveInsideProject } from './sandbox';

const bad = (rel: string): string => {
  try {
    cleanRelative(rel);
  } catch (e) {
    if (e instanceof PathProblem) return e.message;
    throw e;
  }
  return '';
};

describe('names inside a project', () => {
  it('are tidied: slashes forward, "." parts and doubled slashes gone', () => {
    expect(cleanRelative('assets/screens.json')).toBe('assets/screens.json');
    expect(cleanRelative('assets\\sprites\\hero.sprite.json')).toBe('assets/sprites/hero.sprite.json');
    expect(cleanRelative('./assets//screens.json')).toBe('assets/screens.json');
    expect(cleanRelative('scenes/main.scene.json/')).toBe('scenes/main.scene.json');
  });

  it.each([
    ['going up', '../secrets.txt'],
    ['going up in the middle', 'assets/../../secrets.txt'],
    ['going up with backslashes', '..\\secrets.txt'],
    ['going up and in again', 'assets/./../../x'],
    ['an absolute path', '/etc/passwd'],
    ['a Windows absolute path', 'C:\\Windows\\win.ini'],
    ['a drive-relative path', 'C:win.ini'],
    ['a network path', '\\\\server\\share\\file'],
    ['a long Windows path', '\\\\?\\C:\\Windows'],
    ['a home folder', '~/secrets'],
    ['an alternate data stream', 'project.json:secret'],
    ['an empty name', ''],
    ['only spaces', '   '],
    ['the folder itself', '.'],
    ['a NUL byte', 'assets/x.json\u0000.png'],
    ['a control character', 'assets/x\u0007.json'],
    ['a name that ends with a dot', 'assets/x.json.'],
    ['a name that ends with a space', 'assets/x.json '],
    ['a device name', 'assets/CON'],
    ['a device name with an extension', 'assets/nul.txt'],
    ['a numbered device name', 'LPT1'],
    ['a character Windows forbids', 'assets/a<b.json'],
    ['an encoded dot', 'assets/%2e%2e/x'],
    ['an encoded slash', 'assets%2f..%2fx'],
    ['a short Windows name', 'PROGRA~1/x'],
  ])('refuse %s', (_what, rel) => {
    expect(bad(rel), JSON.stringify(rel)).not.toBe('');
  });

  it('say why in words the assistant can act on', () => {
    expect(bad('../x')).toContain('inside the project');
    expect(bad('/etc/passwd')).toContain('from the project folder');
  });
});

describe('inside a folder, by name', () => {
  it('knows a folder from its sibling with the same start, in both path flavours', () => {
    expect(isInside('/p/game', '/p/game/assets/a.json', path.posix)).toBe(true);
    expect(isInside('/p/game', '/p/game', path.posix)).toBe(true);
    expect(isInside('/p/game', '/p/game-2/assets', path.posix)).toBe(false);
    expect(isInside('/p/game', '/p/game/../x', path.posix)).toBe(false);
    expect(isInside('C:\\p\\game', 'C:\\p\\game\\assets', path.win32)).toBe(true);
    expect(isInside('C:\\p\\game', 'C:\\p\\Game2', path.win32)).toBe(false);
    expect(isInside('C:\\p\\game', 'D:\\p\\game\\assets', path.win32)).toBe(false);
  });

  it('ignores capital letters on Windows only', () => {
    expect(isInside('C:\\Projects\\Game', 'c:\\projects\\game\\assets', path.win32)).toBe(true);
    expect(isInside('/Projects/Game', '/projects/game/assets', path.posix)).toBe(false);
  });

  it('resolves a project name to a place below the folder', () => {
    expect(resolveInsideProject('/p/game', 'assets/a.json', { lib: path.posix })).toBe('/p/game/assets/a.json');
    expect(() => resolveInsideProject('/p/game', '../game-2/a.json', { lib: path.posix })).toThrow(PathProblem);
    expect(resolveInsideProject('C:\\p\\game', 'assets\\a.json', { lib: path.win32 })).toBe('C:\\p\\game\\assets\\a.json');
  });
});

describe('absolute paths the window asks for', () => {
  it('must be inside a folder the person chose', () => {
    const roots = ['/p/game', '/p/other'];
    expect(resolveInsideAny(roots, '/p/other/assets/a.json', { lib: path.posix })).toBe('/p/other/assets/a.json');
    expect(() => resolveInsideAny(roots, '/p/third/a.json', { lib: path.posix })).toThrow(/outside/);
    expect(() => resolveInsideAny(roots, '/p/game/../third/a.json', { lib: path.posix })).toThrow(/outside/);
    expect(() => resolveInsideAny(roots, '/p/game/assets/a.json\u0000.png', { lib: path.posix })).toThrow(PathProblem);
    expect(() => resolveInsideAny(roots, '', { lib: path.posix })).toThrow(PathProblem);
  });

  it('may not name a stream or a drive-relative place on Windows', () => {
    expect(() => resolveInsideAny(['C:\\p\\game'], 'C:\\p\\game\\project.json:evil', { lib: path.win32 })).toThrow(/outside/);
  });
});

describe('links', () => {
  let tmp: string;
  let project: string;
  let outside: string;
  let linkMade = false;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-sandbox-'));
    project = path.join(tmp, 'project');
    outside = path.join(tmp, 'outside');
    fs.mkdirSync(path.join(project, 'assets'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(project, 'assets', 'ok.json'), '{}');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    try {
      // a junction needs no special rights on Windows; on other systems it is an ordinary link
      fs.symlinkSync(outside, path.join(project, 'assets', 'escape'), 'junction');
      linkMade = true;
    } catch {
      linkMade = false;
    }
  });

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('a real file in the project is fine, and so is a new one in a folder that does not exist yet', () => {
    expect(resolveInsideProject(project, 'assets/ok.json', { fs })).toBe(path.join(project, 'assets', 'ok.json'));
    expect(resolveInsideProject(project, 'assets/new/deeper/file.json', { fs })).toBe(path.join(project, 'assets', 'new', 'deeper', 'file.json'));
    expect(resolveInsideAny([project], path.join(project, 'assets', 'ok.json'), { fs })).toBe(path.join(project, 'assets', 'ok.json'));
  });

  it('a folder inside the project that is really a link to somewhere else is refused', (ctx) => {
    if (!linkMade) return ctx.skip();
    expect(() => resolveInsideProject(project, 'assets/escape/secret.txt', { fs })).toThrow(/link that leads outside/);
    expect(() => resolveInsideProject(project, 'assets/escape', { fs })).toThrow(/link that leads outside/);
    expect(() => resolveInsideProject(project, 'assets/escape/new-file.txt', { fs })).toThrow(/link that leads outside/);
    expect(() => resolveInsideAny([project], path.join(project, 'assets', 'escape', 'secret.txt'), { fs })).toThrow(/link that leads outside/);
  });

  it('without the link check the same path passes by name (which is why the check exists)', (ctx) => {
    if (!linkMade) return ctx.skip();
    expect(resolveInsideProject(project, 'assets/escape/secret.txt')).toBe(path.join(project, 'assets', 'escape', 'secret.txt'));
  });
});
