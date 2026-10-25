import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '@tilewright/plugin-examples';
import { parseManifest } from '@tilewright/plugin-sdk';
import { pluginFromFiles, usePlugin } from '@tilewright/plugin-sdk/testing';
import { STARTERS, scaffold, starterNamed } from './scaffold';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('the starters', () => {
  it('are made from the examples, and are as new as them', () => {
    const run = spawnSync(process.execPath, [path.join(here, '..', 'scripts', 'make-starters.mjs'), '--check'], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  });

  it('are one for every extension point the examples show', () => {
    expect(STARTERS.map((s) => s.point)).toEqual(EXAMPLES.map((e) => e.point));
    expect(new Set(STARTERS.map((s) => s.id)).size).toBe(STARTERS.length);
    expect(starterNamed('widget').id).toBe('widget');
    expect(starterNamed('screen / screenRole').id).toBe('screen');
    expect(() => starterNamed('nonsense')).toThrow(/The starters are: behavior/);
  });

  for (const starter of STARTERS) {
    it(`"${starter.id}" makes a plugin that builds, loads the way a person would install it, and turns on and off`, async () => {
      const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tw-starter-')), `my-${starter.id}`);
      try {
        const made = scaffold(dir, { starter: starter.id });
        expect(made.files).toEqual(expect.arrayContaining(['plugin.json', 'src/index.ts', 'tests/plugin.test.ts', 'build.mjs']));
        expect(made.files).not.toContain('src/editor.ts');
        expect(parseManifest(JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'))).ok).toBe(true);
        const out = path.join(dir, 'plugin.cjs');
        await build({ entryPoints: [path.join(dir, 'src/index.ts')], outfile: out, bundle: true, format: 'cjs', platform: 'neutral', target: 'es2022', external: ['@tilewright/plugin-sdk'], logLevel: 'silent', absWorkingDir: dir, nodePaths: [path.resolve(here, '..', '..', '..', 'node_modules')] });
        const plugin = await pluginFromFiles({ 'plugin.json': fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'), 'plugin.cjs': fs.readFileSync(out, 'utf8') });
        const t = usePlugin(plugin);
        expect(t.contents()).not.toBeNull();
        t.off();
      } finally {
        fs.rmSync(path.dirname(dir), { recursive: true, force: true });
      }
    });
  }
});
