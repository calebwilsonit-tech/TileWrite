import { afterEach, describe, expect, it } from 'vitest';
import * as sdk from './index';
import { PluginHost } from './index';
import { PluginTrust, hashText, loadPackage, readPluginPackage, type PluginFs } from '@tilewright/behaviors';

const memoryFs = (files: Record<string, string>): PluginFs => ({
  readText: async (p) => {
    if (!(p in files)) throw new Error(`no ${p}`);
    return files[p]!;
  },
  exists: async (p) => p in files,
});

const manifest = { id: 'wind', name: 'Wind', version: '1.0.0', description: 'Pushes things.', entry: { runtime: 'wind.cjs' } };
const code = `
const sdk = require('@tilewright/plugin-sdk');
module.exports.default = sdk.definePlugin(${JSON.stringify(manifest)}, {
  install(api) {
    api.condition({ id: 'windy', label: 'It is windy', category: 'World', params: [], describe: () => 'it is windy', test: () => true });
    api.inputAction('gust', { label: 'Gust', bindings: ['key:KeyG'] });
  },
});
`;
const files = { 'plugin.json': JSON.stringify(manifest), 'wind.cjs': code };

describe('reading a plugin folder', () => {
  it('reads the manifest and the code, and gives the exact code a hash', async () => {
    const r = await readPluginPackage(memoryFs(files));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pkg.manifest.id).toBe('wind');
    expect(r.pkg.runtimeCode).toContain('definePlugin');
    const changed = await readPluginPackage(memoryFs({ ...files, 'wind.cjs': code + ' ' }));
    expect(changed.ok && changed.pkg.hash).not.toBe(r.pkg.hash);
    expect(await hashText('a')).toHaveLength(64);
  });

  it('says in plain words what is wrong', async () => {
    expect(await readPluginPackage(memoryFs({}))).toEqual({ ok: false, problems: ['There is no plugin.json in this folder, so it is not a plugin.'] });
    const bad = await readPluginPackage(memoryFs({ 'plugin.json': '{nope' }));
    expect(bad.ok === false && bad.problems[0]).toMatch(/not valid JSON/);
    const noId = await readPluginPackage(memoryFs({ 'plugin.json': JSON.stringify({ name: 'x', version: '1.0.0' }) }));
    expect(noId.ok === false && noId.problems.join(' ')).toMatch(/plugin\.json: id/);
    const missing = await readPluginPackage(memoryFs({ 'plugin.json': JSON.stringify(manifest) }));
    expect(missing.ok === false && missing.problems[0]).toMatch(/names the game part file "wind.cjs", which is not in the folder/);
  });
});

describe('running a plugin other people wrote', () => {
  const host = new PluginHost();
  afterEach(() => host.forget('wind'));

  it('does not run until the person has approved exactly this code', async () => {
    const r = await readPluginPackage(memoryFs(files));
    if (!r.ok) throw new Error('read');
    const trust = new PluginTrust();
    expect((await loadPackage(r.pkg, trust, sdk)).state).toBe('needs-approval');
    trust.approve('wind', r.pkg.hash);
    const out = await loadPackage(r.pkg, trust, sdk);
    expect(out.state).toBe('loaded');
    // a later version with different code needs a new approval
    const next = await readPluginPackage(memoryFs({ ...files, 'wind.cjs': `${code}\n// version 1.0.1` }));
    if (!next.ok) throw new Error('read');
    expect((await loadPackage(next.pkg, trust, sdk)).state).toBe('needs-approval');
    expect(PluginTrust.from(trust.toJSON()).isApproved('wind', r.pkg.hash)).toBe(true);
  });

  it('is not started when the try-out beforehand says it does not finish, and built-in plugins skip the try-out', async () => {
    const r = await readPluginPackage(memoryFs(files));
    if (!r.ok) throw new Error('read');
    const trust = new PluginTrust();
    trust.approve('wind', r.pkg.hash);
    const asked: string[] = [];
    const refuse = async (pkg: { manifest: { id: string } }): Promise<string | null> => (asked.push(pkg.manifest.id), 'It never ends.');
    const out = await loadPackage(r.pkg, trust, sdk, { preflight: refuse });
    expect(out).toEqual({ state: 'refused', problems: ['It never ends.'] });
    expect((await loadPackage(r.pkg, trust, sdk, { preflight: async () => null })).state).toBe('loaded');
    asked.length = 0;
    await loadPackage(r.pkg, trust, sdk, { builtin: true, preflight: refuse });
    expect(asked).toEqual([]);
  });

  it('adds what it brings when turned on and takes it away again', async () => {
    const r = await readPluginPackage(memoryFs(files));
    if (!r.ok) throw new Error('read');
    const trust = new PluginTrust();
    trust.approve('wind', r.pkg.hash);
    const out = await loadPackage(r.pkg, trust, sdk);
    if (out.state !== 'loaded') throw new Error(out.state);
    host.register(out.definition);
    host.install('wind');
    expect(sdk.conditionDef('windy')).toBeDefined();
    expect(Object.keys(host.inputActions())).toContain('gust');
    host.uninstall('wind');
    expect(sdk.conditionDef('windy')).toBeUndefined();
  });

  it('can use the SDK and nothing else', async () => {
    const evil = { ...files, 'wind.cjs': `const fs = require('fs'); module.exports.default = { install() {} };` };
    const r = await readPluginPackage(memoryFs(evil));
    if (!r.ok) throw new Error('read');
    const trust = new PluginTrust();
    trust.approve('wind', r.pkg.hash);
    const out = await loadPackage(r.pkg, trust, sdk);
    expect(out.state).toBe('refused');
    expect(out.state === 'refused' && out.problems[0]).toMatch(/can only use the plugin SDK/);
  });

  it('is told off when its file has no install', async () => {
    const r = await readPluginPackage(memoryFs({ ...files, 'wind.cjs': 'module.exports.default = {};' }));
    if (!r.ok) throw new Error('read');
    const trust = new PluginTrust();
    trust.approve('wind', r.pkg.hash);
    const out = await loadPackage(r.pkg, trust, sdk);
    expect(out.state === 'refused' && out.problems[0]).toMatch(/does not export an install function/);
  });

  it('cannot claim to ship with the editor', async () => {
    const r = await readPluginPackage(memoryFs({ ...files, 'plugin.json': JSON.stringify({ ...manifest, builtin: true }) }));
    if (!r.ok) throw new Error('read');
    const trust = new PluginTrust();
    trust.approve('wind', r.pkg.hash);
    expect((await loadPackage(r.pkg, trust, sdk)).state).toBe('refused');
  });
});
