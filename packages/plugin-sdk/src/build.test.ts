import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { afterAll, describe, expect, it } from 'vitest';
import * as sdk from './index';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const out = path.join(pkg, 'dist-test');
const ts = createRequire(path.resolve(pkg, '..', '..', 'package.json'))('typescript');

afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

describe('the plugin SDK as a package', () => {
  it('builds into a folder that is the package: code, types, a manifest with real versions and nothing private', () => {
    const run = spawnSync(process.execPath, [path.join(pkg, 'scripts', 'build.mjs'), '--out', out], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(manifest.private).toBeUndefined();
    expect(manifest.name).toBe('@tilewright/plugin-sdk');
    expect(manifest.dependencies).toEqual({ 'pixi.js': expect.stringMatching(/^\^\d/), zod: expect.stringMatching(/^\^\d/) });
    expect(JSON.stringify(manifest)).not.toContain('"*"');
    expect(Object.keys(manifest.exports)).toEqual(['.', './legacy', './testing', './editor-ui']);
    for (const f of ['index.js', 'legacy.js', 'testing.js']) expect(fs.existsSync(path.join(out, f))).toBe(true);
    expect(fs.existsSync(path.join(out, 'types', 'packages', 'plugin-sdk', 'src', 'index.d.ts'))).toBe(true);
  }, 120_000);

  it('runs: its code has the same names as the list, and the legacy entry has the engine\'s old ones', async () => {
    const built = (await import(pathToFileURL(path.join(out, 'index.js')).href)) as Record<string, unknown>;
    expect(Object.keys(built).sort()).toEqual(Object.keys(sdk).sort());
    const old = (await import(pathToFileURL(path.join(out, 'legacy.js')).href)) as Record<string, unknown>;
    expect(Object.keys(old).length).toBeGreaterThan(700);
    expect(typeof built.definePlugin).toBe('function');
  }, 60_000);

  it('is understood by a program that uses it: a plugin written against the types compiles', () => {
    const consumer = path.join(out, 'consumer.ts');
    fs.writeFileSync(
      consumer,
      `import { definePlugin, behaviorDef, type PluginApi, type PluginDefinition } from './types/packages/plugin-sdk/src/index';
import { rig, flatScene } from './types/packages/plugin-sdk/src/testing';
const spin = behaviorDef<{ speed: number }>({ id: 'spin', name: 'Spin', category: 'x', description: '', phase: 'actuator', defaults: { speed: 1 }, fields: [], inputs: [], outputs: [], requires: {}, update() {} });
export const plugin: PluginDefinition = definePlugin({ id: 'x', name: 'X', version: '1.0.0', engine: '^1.0.0' }, { install(api: PluginApi) { api.behavior(spin); api.screenLayer({ id: 'x', create: () => ({ objects: [], update() {}, hide() {} }) }); } });
export const game = rig(flatScene().scene);
`,
    );
    const program = ts.createProgram([consumer], { strict: true, noEmit: true, skipLibCheck: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [] });
    const problems = ts.getPreEmitDiagnostics(program).map((d: { messageText: unknown }) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(problems).toEqual([]);
  }, 120_000);
});
