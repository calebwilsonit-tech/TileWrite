import { describe, expect, it } from 'vitest';
import { PLUGIN_PACK_DIR, pluginBundleOf, pluginPack } from './hub-plugins';
import { parsePack } from '../library/pack';

const FILES = { 'plugin.json': JSON.stringify({ id: 'farming', name: 'Farming', version: '1.2.0' }), 'plugin.cjs': 'module.exports.default = {};', 'CHANGELOG.md': '# Changes' };

describe('plugins shared on the hub', () => {
  it('go up as a pack of kind plugin, marked as code, and come back as the bundle the installer reads', () => {
    const pack = pluginPack(FILES, { name: 'Farming', description: 'Crops.', author: 'A. Friend', licence: 'CC0-1.0' });
    expect(pack.kind).toBe('plugin');
    expect(pack.code).toBe(true);
    expect(pack.files.map((f) => f.path)).toEqual([PLUGIN_PACK_DIR + 'plugin.json', PLUGIN_PACK_DIR + 'plugin.cjs', PLUGIN_PACK_DIR + 'CHANGELOG.md']);
    // through the same check the hub's download gets
    const parsed = parsePack(JSON.parse(JSON.stringify(pack)));
    expect(parsed.ok).toBe(true);
    const bundle = JSON.parse(pluginBundleOf(pack)) as { files: Record<string, string> };
    expect(bundle.files).toEqual(FILES);
  });

  it('refuses a pack that is not a plugin, or has no plugin.json', () => {
    const asset = { ...pluginPack(FILES, { name: 'Grass', description: '', author: '', licence: 'CC0-1.0' }), kind: 'tile' as const };
    expect(() => pluginBundleOf(asset)).toThrow(/not a plugin/);
    const empty = pluginPack({ 'plugin.cjs': 'x' }, { name: 'Broken', description: '', author: '', licence: 'CC0-1.0' });
    expect(() => pluginBundleOf(empty)).toThrow(/no plugin.json/);
  });
});
