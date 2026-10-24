import { describe, expect, it } from 'vitest';
import { PluginHost, parseManifest } from '@tilewright/plugin-sdk';
import { EXAMPLES } from './index';

/** Every example turned on in a host of its own (as the editor would), and what it added. */
function install(point: string): { host: PluginHost; id: string } {
  const entry = EXAMPLES.find((e) => e.point === point);
  if (!entry) throw new Error(`no example for ${point}`);
  const host = new PluginHost();
  host.inEditor = true;
  host.register(entry.plugin);
  host.install(entry.plugin.manifest.id);
  return { host, id: entry.plugin.manifest.id };
}

describe('the example plugins', () => {
  it('have a valid manifest each, with a name that says what they show', () => {
    for (const e of EXAMPLES) {
      expect(parseManifest(e.plugin.manifest).ok, e.point).toBe(true);
      expect(e.plugin.manifest.name, e.point).toMatch(/^Example: /);
    }
    expect(new Set(EXAMPLES.map((e) => e.plugin.manifest.id)).size).toBe(EXAMPLES.length);
  });

  it('each add what they say, and take it away again when turned off', () => {
    // [example, table that gets an entry]
    const tables: [string, (h: PluginHost) => number][] = [
      ['component', (h) => h.ext.components.size],
      ['collisionLayer', (h) => h.ext.collisionLayers.size],
      ['physicsModifier', (h) => h.ext.physicsModifiers.size],
      ['blockType', (h) => h.ext.blockTypes.size],
      ['whoFilter', (h) => h.ext.whoFilters.size],
      ['scriptMethod', (h) => h.ext.scriptMethods.size],
      ['unlockRule', (h) => h.ext.unlockRules.size],
      ['bridgeSource', (h) => h.ext.bridgeSources.size],
      ['widget', (h) => h.ext.widgets.size],
      ['screen / screenRole', (h) => h.ext.screens.size + h.ext.screenRoles.size],
      ['listSource', (h) => h.ext.listSources.size],
      ['menuEntry', (h) => h.ext.menuEntries.size],
      ['panel', (h) => h.editor.panels.size],
      ['tool', (h) => h.editor.tools.size],
      ['importer', (h) => h.editor.importers.size],
      ['exporter', (h) => h.ext.exporters.size],
      ['exportTarget', (h) => h.ext.exportTargets.size],
      ['inspector', (h) => h.ext.inspectors.size],
      ['prefab', (h) => h.ext.prefabs.size],
      ['validator', (h) => h.ext.validators.size],
      ['playbotStrategy', (h) => h.ext.playbotStrategies.size],
      ['playbotMove', (h) => h.ext.playbotMoves.size],
      ['assistantNote / assistantTool / fileReader / imageProvider', (h) => h.ext.assistantNotes.size + h.ext.assistantTools.size + h.ext.fileReaders.size + h.ext.imageProviders.size],
    ];
    for (const [point, count] of tables) {
      const { host, id } = install(point);
      expect(count(host), point).toBeGreaterThan(0);
      host.uninstall(id);
      expect(count(host), `${point} after turning off`).toBe(0);
    }
  });

  it('the ones that fill other things work too', () => {
    expect(install('behavior').host.contentsOf('example-behavior')?.behaviors).toEqual(['exampleSpinner']);
    const events = install('condition / action / event').host.contentsOf('example-events');
    expect(events?.conditions).toEqual(['exampleCounterAtLeast']);
    expect(events?.actions).toEqual(['exampleCountUp']);
    expect(install('system').host.systems().map((s) => s.name)).toEqual(['example-system:count-ticks']);
    expect(install('inputAction').host.inputActions()).toHaveProperty('example_wave');
    expect(install('strings').host.strings()).toContain('Press F to wave');
    expect(install('gameUi').host.provided('example-game-ui', 'gameUi')).toBeTypeOf('function');
    const t = EXAMPLES.find((e) => e.point === 'template')!.plugin.templates!;
    expect(t[0]!.build('Arena').scene.entities.length).toBe(1);
  });
});

describe('the test harness', () => {
  it('runs a plugin in a small game and takes it away again', async () => {
    const { usePlugin, rig, flatScene, thing, pluginFromFiles, C } = await import('@tilewright/plugin-sdk/testing');
    const { behaviorExample } = await import('./index');
    const t = usePlugin(behaviorExample);
    const { scene } = flatScene();
    scene.entities.push(thing('s', 'Spinner', 5.5, 5.5, { exampleSpinner: { speed: 4 } }));
    const r = rig(scene);
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      r.run(1);
      seen.add((r.get('s').get(C.Transform) as { facing: number }).facing);
    }
    expect(seen.size).toBeGreaterThan(2); // it turns
    expect(t.contents().behaviors).toEqual(['exampleSpinner']);
    t.off();
    expect(t.host.isInstalled('example-behavior')).toBe(false);

    const loaded = await pluginFromFiles({
      'plugin.json': JSON.stringify({ id: 'packed', name: 'Packed', version: '1.0.0', entry: { runtime: 'p.cjs' } }),
      'p.cjs': "const sdk = require('@tilewright/plugin-sdk'); module.exports.default = sdk.definePlugin({ id: 'packed', name: 'Packed', version: '1.0.0' }, { install(api) { api.inputAction('packed_go', { label: 'Go', bindings: ['key:KeyG'] }); } });",
    });
    const p = usePlugin(loaded);
    expect(Object.keys(p.host.inputActions())).toContain('packed_go');
    p.off();
  });
});
