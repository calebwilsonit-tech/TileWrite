import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The core is neutral: the engine does not revolve around any one game. The packages below are the core (the kernel, the editor,
 * the exporter, the playbot, the assistant); everything about a particular kind of game lives in a plugin. Two rules keep it so:
 * the core never imports a plugin, and the core never mentions the words of the reference game.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = ['runtime', 'behaviors', 'editor', 'exporter', 'playbot', 'assistant', 'hub-server', 'plugin-sdk'];

/** Where a core package may name the bundled plugins: the one file that makes them known to the host. */
const COMPOSITION_ROOTS = new Set(['packages/editor/src/bundled.ts', 'packages/playbot/src/bundled.ts', 'packages/exporter/src/bundled.ts']);

/** Words that belong to one game and so to its plugin. */
const FORBIDDEN = ['storytender', 'echo', 'lantern', 'sentence', 'dough', 'quill', 'mnemosynth', 'critic', 'spoiler'];

function sources(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'out' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const coreFiles = CORE.flatMap((pkg) => sources(path.join(root, 'packages', pkg, 'src'))).map((f) => path.relative(root, f).split(path.sep).join('/'));
const isTest = (f: string): boolean => /\.test\.(ts|tsx)$/.test(f);

describe('the core is neutral', () => {
  it('sees the core packages', () => {
    expect(coreFiles.length).toBeGreaterThan(100);
  });

  it('never imports a plugin (only the composition roots name the bundled ones)', () => {
    const bad: string[] = [];
    for (const f of coreFiles) {
      if (COMPOSITION_ROOTS.has(f)) continue;
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*'(@tilewright\/(?:plugin-[a-z-]+|bundled-plugins)(?:\/[^']*)?)'/g)) {
        if (m[1] === '@tilewright/plugin-sdk' || m[1]!.startsWith('@tilewright/plugin-sdk/')) continue;
        bad.push(`${f} imports ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never mentions the words of the reference game', () => {
    const re = new RegExp(`(${FORBIDDEN.join('|')})`, 'i');
    const bad: string[] = [];
    for (const f of coreFiles) {
      if (isTest(f)) continue;
      const lines = fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        const m = re.exec(line);
        if (m) bad.push(`${f}:${i + 1} ${m[1]}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
