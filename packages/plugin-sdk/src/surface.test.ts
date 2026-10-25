import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as sdk from './index';
import * as legacy from './legacy';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('the plugin SDK is a list, not the engine', () => {
  it('is a small part of what the engine exports, and every name of it is also in the legacy entry', () => {
    const names = Object.keys(sdk);
    const old = new Set(Object.keys(legacy));
    expect(names.filter((n) => !old.has(n))).toEqual([]);
    expect(names.length).toBeLessThan(250);
    expect(old.size).toBeGreaterThan(700);
  });

  it('is what every plugin that ships with Tilewright (and every example) is written against: none uses the legacy entry', () => {
    const bad: string[] = [];
    for (const dir of ['packages/plugins', 'packages/plugin-examples', 'packages/bundled-plugins', 'packages/create-tilewright-plugin']) {
      for (const f of sources(path.join(root, dir))) {
        if (fs.readFileSync(f, 'utf8').includes("'@tilewright/plugin-sdk/legacy'")) bad.push(path.relative(root, f));
      }
    }
    expect(bad).toEqual([]);
  });
});
