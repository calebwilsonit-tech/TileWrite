import { describe, expect, it } from 'vitest';
import { emptyLinks, parseLinks, recordInstall, unlink, updatesAvailable } from './links';
import type { LibraryItem } from './store';

const item = (id: string, current: number): LibraryItem => ({ id, name: id, kind: 'tile', folder: '', tags: [], description: '', author: '', licence: '', thumb: '', current, versions: [], code: false });

describe('library links', () => {
  it('remembers installs, and a second install of the same item replaces the first', () => {
    let f = emptyLinks();
    f = recordInstall(f, { itemId: 'a', name: 'A', mode: 'link', version: 1, files: [], tiles: [], prefabs: [], installedAt: '' });
    f = recordInstall(f, { itemId: 'b', name: 'B', mode: 'copy', version: 1, files: [], tiles: [], prefabs: [], installedAt: '' });
    f = recordInstall(f, { itemId: 'a', name: 'A', mode: 'link', version: 2, files: [], tiles: [], prefabs: [], installedAt: '' });
    expect(f.links.map((l) => [l.itemId, l.version])).toEqual([['b', 1], ['a', 2]]);
  });

  it('reports updates for linked items only, and items that left the library', () => {
    const f = parseLinks(JSON.stringify({ links: [{ itemId: 'a', name: 'A', mode: 'link', version: 1 }, { itemId: 'b', name: 'B', mode: 'copy', version: 1 }, { itemId: 'gone', name: 'G', mode: 'link', version: 1 }] }));
    const u = updatesAvailable(f, [item('a', 3), item('b', 5)]);
    expect(u.map((x) => [x.link.itemId, x.current])).toEqual([['a', 3], ['gone', null]]);
    expect(updatesAvailable(f, [item('a', 1), item('b', 5), item('gone', 1)])).toEqual([]);
  });

  it('breaking a link makes the project the owner; a damaged file reads as empty', () => {
    const f = recordInstall(emptyLinks(), { itemId: 'a', name: 'A', mode: 'link', version: 1, files: [], tiles: [], prefabs: [], installedAt: '' });
    expect(updatesAvailable(unlink(f, 'a'), [item('a', 9)])).toEqual([]);
    expect(parseLinks('{nope')).toEqual(emptyLinks());
  });
});
