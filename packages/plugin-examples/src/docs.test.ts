import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './index';

const root = path.resolve(__dirname, '../../..');
const read = (f: string): string => fs.readFileSync(path.join(root, f), 'utf8');

describe('the plugin docs', () => {
  it('mention every name the plugin api has had', () => {
    const baseline = JSON.parse(read('compat/baselines/sdk-api.json')) as { api: string[] };
    const text = read('docs/plugins/extension-points.md');
    const missing = baseline.api.filter((name) => !new RegExp(`api\\.${name}\\b`).test(text));
    expect(missing, 'add these to docs/plugins/extension-points.md').toEqual([]);
  });

  it('point at examples that exist', () => {
    const text = read('docs/plugins/extension-points.md');
    for (const file of new Set([...text.matchAll(/`(game|ui|editor|tools)\.ts`/g)].map((m) => m[1]))) {
      expect(fs.existsSync(path.join(root, `packages/plugin-examples/src/${file}.ts`)), file).toBe(true);
    }
    expect(EXAMPLES.length).toBeGreaterThan(20);
  });
});
