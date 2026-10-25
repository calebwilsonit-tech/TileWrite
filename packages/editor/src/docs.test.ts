import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const docs = path.join(root, 'docs');
const read = (f: string): string => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const pages = fs.readdirSync(docs).filter((f) => f.endsWith('.md'));

describe('the manual', () => {
  it('links every page from the index, and every link in the docs goes somewhere', () => {
    const index = read(path.join(docs, 'README.md'));
    for (const p of pages.filter((x) => x !== 'README.md')) expect(index, `README.md does not link ${p}`).toContain(`(${p})`);
    for (const p of pages) {
      for (const m of read(path.join(docs, p)).matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
        expect(fs.existsSync(path.join(docs, m[1]!)), `${p} links ${m[1]}, which does not exist`).toBe(true);
      }
    }
  });

  it('describes every panel in the editor window', () => {
    const shell = read(path.join(root, 'packages', 'editor', 'src', 'renderer', 'app', 'EditorShell.tsx'));
    const titles = [...shell.matchAll(/api\.addPanel\(\{[^}]*title: '([^']+)'/g)].map((m) => m[1]!);
    expect(titles.length).toBeGreaterThanOrEqual(13);
    const manual = read(path.join(docs, 'editor.md'));
    for (const t of titles) expect(manual, `docs/editor.md does not describe the ${t} panel`).toContain(`| ${t} |`);
  });

  it('has a recipe for the things people most often build', () => {
    const recipes = read(path.join(docs, 'recipes.md'));
    for (const topic of ['lever', 'crate', 'bridge', 'guard', 'boss', 'conversation', 'Checkpoints', 'dark room', 'another scene', 'prefabs', 'Check a level', 'Claude']) {
      expect(recipes.toLowerCase(), topic).toContain(topic.toLowerCase());
    }
  });
});
