import { describe, expect, it } from 'vitest';
import { SearchProblem, filterFiles, findByName, formatSearch, searchText, textMatcher } from './search';

const files = [
  'scenes/hub.scene.json',
  'scenes/cave.scene.json',
  'assets/sprites/tree.sprite.json',
  'assets/sprites/tree-dead.sprite.json',
  'assets/sprites/hero.sprite.json',
  'assets/audio/tree-rustle.wav',
  'assets/screens.json',
  'scripts/tree-grow.ts',
  'project-notes.md',
].map((path) => ({ path, size: 500 }));

describe('searching by name and kind', () => {
  it('finds files whose name has the words, an exact name first, in any case', () => {
    expect(findByName(files, 'tree').map((f) => f.path)).toEqual(['assets/sprites/tree.sprite.json', 'assets/audio/tree-rustle.wav', 'assets/sprites/tree-dead.sprite.json', 'scripts/tree-grow.ts']);
    expect(findByName(files, 'HERO').map((f) => f.path)).toEqual(['assets/sprites/hero.sprite.json']);
    expect(findByName(files, 'nothing-like-this')).toEqual([]);
  });

  it('takes * and ? as wildcards, against the name, or against the path when it has a slash', () => {
    expect(findByName(files, '*.sprite.json').map((f) => f.path)).toHaveLength(3);
    expect(findByName(files, 'tree-?ead*').map((f) => f.path)).toEqual(['assets/sprites/tree-dead.sprite.json']);
    expect(findByName(files, 'scenes/*').map((f) => f.path)).toEqual(['scenes/cave.scene.json', 'scenes/hub.scene.json']);
  });

  it('keeps to a kind and a folder, and says which kinds there are when it is given a wrong one', () => {
    expect(filterFiles(files, { kind: 'sprites' })).toHaveLength(3);
    expect(filterFiles(files, { kind: 'sounds' }).map((f) => f.path)).toEqual(['assets/audio/tree-rustle.wav']);
    expect(filterFiles(files, { folder: 'assets/sprites/' })).toHaveLength(3);
    expect(filterFiles(files, { folder: 'assets', kind: 'scenes' })).toEqual([]);
    expect(() => filterFiles(files, { kind: 'spirtes' })).toThrow(/The kinds are: scenes, sprites/);
  });
});

describe('searching the text', () => {
  const text = ['{', '  "name": "Old Tree",', '  "note": "the tree drops a seed",', '}'].join('\n');

  it('finds lines with the words, with their numbers, ignoring case unless told not to', () => {
    const hits = searchText('a.json', text, textMatcher('TREE'), 10);
    expect(hits.map((h) => [h.line, h.text])).toEqual([[2, '"name": "Old Tree",'], [3, '"note": "the tree drops a seed",']]);
    expect(searchText('a.json', text, textMatcher('TREE', { caseSensitive: true }), 10)).toEqual([]);
    expect(searchText('a.json', text, textMatcher('tree', { caseSensitive: true }), 1)).toHaveLength(1);
  });

  it('can take the query as a pattern, and says when the pattern is wrong', () => {
    expect(searchText('a.json', text, textMatcher('"na.e"', { regex: true }), 10)).toHaveLength(1);
    expect(() => textMatcher('(', { regex: true })).toThrow(SearchProblem);
    expect(() => textMatcher('')).toThrow(/something to look for/);
  });

  it('shows only the part of a very long line around the match', () => {
    const long = `${'x'.repeat(400)} NEEDLE ${'y'.repeat(400)}`;
    const [hit] = searchText('big.json', long, textMatcher('needle'), 5);
    expect(hit!.text.length).toBeLessThan(220);
    expect(hit!.text).toContain('NEEDLE');
    expect(hit!.text.startsWith('...')).toBe(true);
  });
});

describe('the answer', () => {
  it('lists names and lines grouped by file, and says when it stopped early or skipped files', () => {
    const out = formatSearch(
      { query: 'tree', names: findByName(files, 'tree'), hits: [{ path: 'scenes/hub.scene.json', line: 12, text: '"sprite": "tree"' }, { path: 'scenes/hub.scene.json', line: 40, text: '"sprite": "tree-dead"' }], searched: 9, skipped: 1, cut: true },
      { names: 2, hits: 40 },
    );
    expect(out).toContain('Files named like "tree": 4');
    expect(out).toContain('and 2 more');
    expect(out).toContain('2 or more lines in 1 file (9 searched)');
    expect(out.match(/scenes\/hub\.scene\.json/g)).toHaveLength(1);
    expect(out).toContain('    12: "sprite": "tree"');
    expect(out).toContain('stopped at its limit');
    expect(out).toContain('1 text file was too big');
  });

  it('says plainly that nothing was found', () => {
    const out = formatSearch({ query: 'zzz', names: [], hits: [], searched: 5, skipped: 0, cut: false }, { names: 40, hits: 40 });
    expect(out).toContain('No file has a name like "zzz"');
    expect(out).toContain('No text contains "zzz" (5 files searched)');
  });
});
