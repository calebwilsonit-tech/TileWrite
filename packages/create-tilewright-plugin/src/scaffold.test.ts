import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '@tilewright/plugin-sdk';
import { pluginFromFiles, usePlugin } from '@tilewright/plugin-sdk/testing';
import { scaffold, templateFiles } from './scaffold';

describe('npm create tilewright-plugin', () => {
  it('makes a folder with a valid manifest, a game part, an editor part, a test and a build', () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tw-scaffold-')), 'My Cool Plugin');
    const made = scaffold(dir);
    expect(made.id).toBe('my-cool-plugin');
    expect(made.files).toEqual(expect.arrayContaining(['plugin.json', 'src/index.ts', 'src/editor.ts', 'tests/plugin.test.ts', 'build.mjs', 'CHANGELOG.md', 'README.md']));
    const m = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8')));
    expect(m.ok).toBe(true);
    expect(() => scaffold(dir)).toThrow(/not empty/);
  });

  it('points the new plugin at the SDK where you say it is', () => {
    expect(JSON.parse(templateFiles('x', { sdk: '../tilewright/packages/plugin-sdk' })['package.json']!).dependencies['@tilewright/plugin-sdk']).toBe('file:../tilewright/packages/plugin-sdk');
  });

  it('makes a plugin that builds, loads the way a person would install it, and works', async () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tw-scaffold-')), 'wobbler');
    scaffold(dir);
    // the same two builds as build.mjs, with the SDK resolved from this repository
    const out = (name: string): string => path.join(dir, name);
    await build({ entryPoints: [out('src/index.ts')], outfile: out('plugin.cjs'), bundle: true, format: 'cjs', platform: 'neutral', target: 'es2022', external: ['@tilewright/plugin-sdk'], logLevel: 'silent', absWorkingDir: dir });
    await build({ entryPoints: [out('src/editor.ts')], outfile: out('editor.cjs'), bundle: true, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent', absWorkingDir: dir });
    const files = Object.fromEntries(['plugin.json', 'plugin.cjs', 'editor.cjs'].map((f) => [f, fs.readFileSync(out(f), 'utf8')]));
    const plugin = await pluginFromFiles(files);
    const t = usePlugin(plugin);
    expect(t.contents().behaviors).toEqual(['wobblerPulse']);
    t.off();
    expect(files['editor.cjs']).toContain('Tilewright.editor.panel');
  });
});
