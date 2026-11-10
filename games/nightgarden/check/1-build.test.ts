import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_DIR, filesOf, freshBuild } from './helpers';

describe('the built project', () => {
  it('is there, and is exactly what the sources build (run `npm run nightgarden:build` after any change)', () => {
    expect(fs.existsSync(path.join(PROJECT_DIR, 'project.json')), 'games/nightgarden/project has not been built').toBe(true);
    const want = filesOf(freshBuild().dir);
    const have = filesOf(PROJECT_DIR);
    const stale = [...want].filter(([f, text]) => have.get(f) !== text).map(([f]) => f);
    const extra = [...have.keys()].filter((f) => !want.has(f) && !f.startsWith('playthroughs/'));
    expect(stale, 'files that differ from a fresh build').toEqual([]);
    expect(extra, 'files a fresh build does not make').toEqual([]);
  });
});
