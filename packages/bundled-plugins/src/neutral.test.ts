import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The core is neutral: the engine does not revolve around any one game. The packages below are the core (the kernel, the editor,
 * the exporter, the playbot, the assistant); everything about a particular kind of game lives in a plugin. Two rules keep it so:
 * the core never imports a plugin, and the core never mentions the words of the reference game.
 *
 * Every text file of a core package counts (code, tests, data, pages, scripts), not only the code.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = ['runtime', 'behaviors', 'editor', 'exporter', 'playbot', 'assistant', 'hub-server', 'plugin-sdk'];

/**
 * Where a core package may name the bundled plugins: the files that make them known to the host, and the SDK's list of names that moved
 * out of the engine into the plugin that owns them (each must exist, or the entry goes).
 */
const COMPOSITION_ROOTS = ['packages/editor/src/bundled.ts', 'packages/editor/src/bundled-editor.ts', 'packages/plugin-sdk/src/legacy.ts'];

/** Words that belong to one game and so to its plugin (a word at the start of a word, or inside a camelCase name). */
const FORBIDDEN = ['storytender', 'echo', 'lantern', 'sentence', 'dough', 'quill', 'mnemosynth', 'critic', 'spoiler', 'rested', 'parchment'];
/** Short ordinary words that only count as a whole word ("fuel" for a lantern): they are inside many other words. */
const WHOLE_WORDS = ['fuel'];
/** The game's "post" (a lantern post you light, a travel request to one) is told from an HTTP POST or postMessage by its shape: "travel-post-request", litPost, "posts" of a name. */
const POST_FORMS = /(?:travel-post|lit-post|litPost|LitPost|travelPost|TravelPost|\blit posts?\b|\bposts? you light)/;

/** A word of the reference game. Plain words that merely contain the letters (Choices, position, postMessage) do not count. */
function findGameWord(line: string): string | null {
  const lower = FORBIDDEN.join('|');
  const upper = FORBIDDEN.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('|');
  const caps = FORBIDDEN.map((w) => w.toUpperCase()).join('|');
  const start = new RegExp('\\b(?:' + lower + ')', 'i').exec(line);
  const camel = new RegExp('(?<=[a-z0-9_])(?:' + upper + '|' + caps + ')').exec(line);
  const whole = new RegExp('(?<![A-Za-z0-9])(?:' + WHOLE_WORDS.join('|') + ')(?![A-Za-z0-9])', 'i').exec(line);
  return start?.[0] ?? camel?.[0] ?? whole?.[0] ?? POST_FORMS.exec(line)?.[0] ?? null;
}

const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|html|css|svg|txt|yml|yaml)$/i;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'release', 'build', 'coverage', 'test-results']);

function textFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) textFiles(p, out);
    else if (TEXT.test(e.name) && e.name !== 'package-lock.json') out.push(p);
  }
  return out;
}

const rel = (f: string): string => path.relative(root, f).split(path.sep).join('/');
const coreFiles = CORE.flatMap((pkg) => textFiles(path.join(root, 'packages', pkg))).map(rel);

/** Where an import written in `file` leads, as a path from the repository root (null for a package name). */
function importTarget(file: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
}

describe('the core is neutral', () => {
  it('sees the core packages, every kind of text file in them, and their tests', () => {
    expect(coreFiles.filter((f) => /\.(ts|tsx)$/.test(f)).length).toBeGreaterThan(100);
    expect(coreFiles.some((f) => f.endsWith('.json'))).toBe(true);
    expect(coreFiles.some((f) => /\.test\.(ts|tsx)$/.test(f))).toBe(true);
  });

  it('names only composition roots that exist', () => {
    expect(COMPOSITION_ROOTS.filter((f) => !fs.existsSync(path.join(root, f)))).toEqual([]);
  });

  it('never imports a plugin by name (only the composition roots name the bundled ones)', () => {
    const bad: string[] = [];
    for (const f of coreFiles) {
      if (!/\.(ts|tsx|mjs|js|cjs)$/.test(f) || COMPOSITION_ROOTS.includes(f)) continue;
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      for (const m of text.matchAll(/(?:from|import|require)\s*\(?\s*['"](@tilewright\/(?:plugin-[a-z-]+|bundled-plugins)(?:\/[^'"]*)?)['"]/g)) {
        if (m[1] === '@tilewright/plugin-sdk' || m[1]!.startsWith('@tilewright/plugin-sdk/')) continue;
        bad.push(`${f} imports ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never reaches into a plugin by a relative path either', () => {
    const bad: string[] = [];
    for (const f of coreFiles) {
      if (!/\.(ts|tsx|mjs|js|cjs)$/.test(f) || COMPOSITION_ROOTS.includes(f)) continue;
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      for (const m of text.matchAll(/(?:from|import|require)\s*\(?\s*['"](\.[^'"]*)['"]/g)) {
        const target = importTarget(f, m[1]!);
        if (target && /^packages\/(plugins|bundled-plugins|plugin-examples)(\/|$)/.test(target)) bad.push(`${f} imports ${m[1]} (${target})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never mentions the words of the reference game, in code, tests, data or pages', () => {
    const bad: string[] = [];
    for (const f of coreFiles) {
      // (this file and the plugin guide's list of the words are the only places the words may be written down)
      if (f === 'packages/bundled-plugins/src/neutral.test.ts') continue;
      const lines = fs.readFileSync(path.join(root, f), 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        const m = findGameWord(line);
        if (m) bad.push(`${f}:${i + 1} ${m}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
