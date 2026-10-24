import { afterEach, describe, expect, it } from 'vitest';
import { getBehavior } from '../framework';
import { actionDef, conditionDef } from '../events/sheet';
import { ENGINE_VERSION, describePermission, grants, parseManifest, worksWithEngine, type PluginManifest } from './manifest';
import { PluginError, host, type PluginDefinition } from './host';
import { bumpOf, compareVersionText, isRange, isVersion, maxSatisfying, parseVersion, satisfies } from './semver';

describe('versions and ranges', () => {
  it('parse and compare', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, note: '' });
    expect(parseVersion('v2.0.0-beta.1')?.note).toBe('beta.1');
    expect(parseVersion('1.2')).toBeNull();
    expect(isVersion('0.0.1')).toBe(true);
    expect(['1.10.0', '1.2.0', '1.2.0-beta', '0.9.9', '1.2.1'].sort(compareVersionText)).toEqual(['0.9.9', '1.2.0-beta', '1.2.0', '1.2.1', '1.10.0']);
  });

  it('say whether a version fits a range', () => {
    const fits: [string, string, boolean][] = [
      ['1.2.3', '1.2.3', true],
      ['1.2.4', '1.2.3', false],
      ['1.5.0', '^1.2.0', true],
      ['2.0.0', '^1.2.0', false],
      ['1.1.9', '^1.2.0', false],
      ['0.2.5', '^0.2.1', true],
      ['0.3.0', '^0.2.1', false],
      ['1.2.9', '~1.2.3', true],
      ['1.3.0', '~1.2.3', false],
      ['1.9.0', '>=1.2.0 <2.0.0', true],
      ['2.0.0', '>=1.2.0 <2.0.0', false],
      ['1.4.0', '1.x', true],
      ['2.0.0', '1.x', false],
      ['1.2.7', '1.2.x', true],
      ['3.1.4', '*', true],
      ['3.1.4', '', true],
      ['0.5.0', '^1.0.0 || ^0.5.0', true],
      ['not a version', '*', false],
    ];
    for (const [v, r, want] of fits) expect(satisfies(v, r), `${v} in ${r}`).toBe(want);
    expect(maxSatisfying(['1.0.0', '1.4.0', '2.0.0', '1.9.1'], '^1.0.0')).toBe('1.9.1');
    expect(isRange('^1.2.0')).toBe(true);
    expect(isRange('>=1.0.0 <2.0.0 || 3.x')).toBe(true);
    expect(isRange('^banana')).toBe(false);
    expect(bumpOf('1.0.0', '1.1.0')).toBe('minor');
    expect(bumpOf('1.0.0', '2.0.0')).toBe('major');
    expect(bumpOf('1.2.0', '1.1.0')).toBe('older');
  });
});

describe('the manifest', () => {
  const ok = { id: 'wind', name: 'Wind', version: '1.0.0', permissions: ['project.read', 'network:example.com'], entry: { runtime: 'runtime.js' } };

  it('reads a good one and fills in what it leaves out', () => {
    const r = parseManifest(ok);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.engine).toBe('^1.0.0');
      expect(r.manifest.dependencies).toEqual({});
      expect(r.manifest.builtin).toBe(false);
    }
  });

  it('says what is wrong in plain words', () => {
    const bad = parseManifest({ id: 'Wind!', name: '', version: '1', engine: '^banana', permissions: ['everything'], dependencies: { combat: 'zzz' } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const text = bad.problems.join(' | ');
      expect(text).toContain('id');
      expect(text).toContain('A version looks like 1.2.3');
      expect(text).toContain('A version range looks like');
      expect(text).toContain('A permission is one of');
    }
  });

  it('knows the platform version and the permissions', () => {
    expect(worksWithEngine({ engine: '^1.0.0' })).toBe(true);
    expect(worksWithEngine({ engine: '^2.0.0' })).toBe(false);
    expect(ENGINE_VERSION).toBe('1.0.0');
    expect(describePermission('programs')).toContain('Run other programs');
    expect(describePermission('network:api.example.com')).toBe('Talk to api.example.com over the internet');
    expect(grants(['network'], 'network:anything.com')).toBe(true);
    expect(grants(['network:a.com'], 'network:b.com')).toBe(false);
  });
});

const manifest = (over: Partial<PluginManifest> & { id: string }): PluginManifest => {
  const r = parseManifest({ name: over.id, version: '1.0.0', ...over });
  if (!r.ok) throw new Error(r.problems.join('; '));
  return r.manifest;
};

const made: string[] = [];
const plugin = (over: Partial<PluginManifest> & { id: string }, install: PluginDefinition['install'] = () => undefined, installEditor?: PluginDefinition['installEditor']): PluginDefinition => {
  made.push(over.id);
  return { manifest: manifest(over), install, ...(installEditor ? { installEditor } : {}) };
};

afterEach(() => {
  for (const id of made.splice(0)) host.forget(id);
  host.inEditor = false;
});

describe('the host', () => {
  it('turns a plugin on and off, and everything it added comes and goes with it', () => {
    host.register(
      plugin({ id: 't-wind' }, (api) => {
        api.behavior({ id: 't_windy', name: 'Windy', category: 'T', description: '', phase: 'control', defaults: {}, fields: [], inputs: [], outputs: [], requires: {}, update: () => undefined });
        api.condition({ id: 't_calm', label: 'Calm', category: 'T', params: [], describe: () => 'calm', test: () => true });
        api.action({ id: 't_blow', label: 'Blow', category: 'T', params: [], describe: () => 'blow', run: () => undefined });
        api.inputAction('t_gust', { label: 'Gust', bindings: ['key:KeyG'] });
        api.collisionLayer({ name: 't-wind-layer', bit: 12 });
        api.prefab({ id: 't-fan', label: 'Fan', hint: '', group: 'Wind', make: (x, y, h) => ({ name: 'Fan', tags: [], components: { transform: { x, y, h, facing: 2 } } }) });
        api.provide('strength', 3);
      }),
    );
    host.install('t-wind');
    expect(getBehavior('t_windy')).toBeDefined();
    expect(conditionDef('t_calm')).toBeDefined();
    expect(actionDef('t_blow')).toBeDefined();
    expect(host.inputActions().t_gust?.bindings).toEqual(['key:KeyG']);
    expect(host.ext.collisionLayers.get('t-wind-layer')?.bit).toBe(12);
    expect(host.ext.prefabs.get('t-fan')?.plugin).toBe('t-wind');
    expect(host.contentsOf('t-wind')?.behaviors).toEqual(['t_windy']);
    expect(host.ownerOfBehavior('t_windy')).toBe('t-wind');
    host.uninstall('t-wind');
    expect(getBehavior('t_windy')).toBeUndefined();
    expect(conditionDef('t_calm')).toBeUndefined();
    expect(actionDef('t_blow')).toBeUndefined();
    expect(host.inputActions().t_gust).toBeUndefined();
    expect(host.ext.collisionLayers.has('t-wind-layer')).toBe(false);
    expect(host.ext.prefabs.has('t-fan')).toBe(false);
    expect(host.knownOwnerOfBehavior('t_windy')).toBe('t-wind'); // so the checker can say which plugin to turn on
  });

  it('starts the plugins a plugin needs first, checks their versions, and turns off what needed a plugin that goes', () => {
    host.register(plugin({ id: 't-base', version: '1.4.0' }));
    host.register(plugin({ id: 't-user', dependencies: { 't-base': '^1.2.0' } }));
    host.install('t-user');
    expect(host.active()).toEqual(['t-base', 't-user']);
    expect(host.dependentsOf('t-base')).toEqual(['t-user']);
    host.uninstall('t-base');
    expect(host.isInstalled('t-user')).toBe(false);

    host.register(plugin({ id: 't-old', version: '1.0.0' }));
    host.register(plugin({ id: 't-picky', dependencies: { 't-old': '^2.0.0' } }));
    expect(() => host.install('t-picky')).toThrow(/needs "t-old" \^2.0.0, and 1.0.0 is installed/);
    host.register(plugin({ id: 't-lonely', dependencies: { 't-nothing': '*' } }));
    expect(() => host.install('t-lonely')).toThrow(/needs the plugin "t-nothing" .*not installed/);
    host.register(plugin({ id: 't-future', engine: '^9.0.0' }));
    expect(() => host.install('t-future')).toThrow(PluginError);
    host.register(plugin({ id: 't-a', dependencies: { 't-b': '*' } }));
    host.register(plugin({ id: 't-b', dependencies: { 't-a': '*' } }));
    expect(() => host.install('t-a')).toThrow(/need each other/);
  });

  it('keeps two plugins from taking the same collision layer or the same name', () => {
    host.register(plugin({ id: 't-l1' }, (api) => api.collisionLayer({ name: 't-layer', bit: 11 })));
    host.register(plugin({ id: 't-l2' }, (api) => api.collisionLayer({ name: 't-other', bit: 11 })));
    host.register(plugin({ id: 't-l3' }, (api) => api.collisionLayer({ name: 't-layer', bit: 10 })));
    host.install('t-l1');
    expect(() => host.install('t-l2')).toThrow(/clashes/);
    expect(() => host.install('t-l3')).toThrow(/clashes/);
    expect(host.isInstalled('t-l2')).toBe(false);
    expect(host.failures().map((f) => f.plugin)).toContain('t-l2');
  });

  it('checks permissions: the person grants them, the network only to the hosts asked for', async () => {
    host.netFetch = async () => ({ status: 200, text: async () => 'ok', bytes: async () => new Uint8Array() });
    let api!: Parameters<PluginDefinition['install']>[0];
    host.register(plugin({ id: 't-net', permissions: ['network:example.com'] }, (a) => (api = a)));
    host.install('t-net');
    await expect(api.fetch('https://example.com/x')).rejects.toThrow(/not allowed/);
    host.grant('t-net', ['network:example.com']);
    await expect(api.fetch('https://example.com/x')).resolves.toMatchObject({ status: 200 });
    await expect(api.fetch('https://evil.example.org/x')).rejects.toThrow(/network:evil.example.org/);
    expect(host.permissionsOf('t-net')).toEqual({ asked: ['network:example.com'], granted: ['network:example.com'] });
    // the engine's own plugins have what they ask
    host.register(plugin({ id: 't-own', builtin: true, permissions: ['project.read'] }));
    expect(host.permissionsOf('t-own').granted).toEqual(['project.read']);
  });

  it('turns a plugin off, with a message, when its editor parts crash; the editor is not taken down', () => {
    const told: string[] = [];
    host.editorHost = { notify: (_k, t) => told.push(t), project: () => null, entities: () => [], writeFile: async () => undefined, readFile: async () => '' };
    host.inEditor = true;
    host.register(
      plugin(
        { id: 't-crash' },
        () => undefined,
        (api) => {
          api.panel({
            id: 't-crash-panel',
            title: 'Crashy',
            mount: () => {
              throw new Error('boom');
            },
          });
        },
      ),
    );
    host.install('t-crash');
    const panel = host.editor.panels.get('t-crash-panel')!;
    expect(() => panel.mount({} as HTMLElement, host.editorHost!)).not.toThrow();
    expect(host.isInstalled('t-crash')).toBe(false);
    expect(host.failures().find((f) => f.plugin === 't-crash')?.message).toContain('boom');
    expect(told.join(' ')).toContain('turned off');
    host.editorHost = null;
  });

  it('records a crash in the game against the plugin and lets the game report it', () => {
    host.register(
      plugin({ id: 't-bad' }, (api) =>
        api.action({
          id: 't_bad_action',
          label: 'Bad',
          category: 'T',
          params: [],
          describe: () => 'bad',
          run: () => {
            throw new Error('kaboom');
          },
        }),
      ),
    );
    host.install('t-bad');
    expect(() => actionDef('t_bad_action')!.run({} as never, {}, { picked: undefined })).toThrow('kaboom');
    expect(host.failures().find((f) => f.plugin === 't-bad')?.where).toContain('the action "Bad"');
  });

  it('puts a replaced plugin back as it was on (dev mode: the new code replaces the old)', () => {
    let n = 0;
    host.register(plugin({ id: 't-dev', version: '1.0.0' }, (api) => api.provide('v', ++n)));
    host.install('t-dev');
    expect(host.installed.get('t-dev')?.provided.get('v')).toBe(1);
    host.register(plugin({ id: 't-dev', version: '1.0.1' }, (api) => api.provide('v', ++n * 10)));
    expect(host.isInstalled('t-dev')).toBe(true);
    expect(host.installed.get('t-dev')?.provided.get('v')).toBe(20);
  });

  it('lets plugins talk: one offers, another that depends on it uses (and may not use one it did not list)', () => {
    host.register(plugin({ id: 't-svc' }, (api) => api.provide('double', (n: number) => n * 2)));
    let used = 0;
    host.register(plugin({ id: 't-client', dependencies: { 't-svc': '*' } }, (api) => (used = api.use<(n: number) => number>('t-svc', 'double')!(21))));
    host.register(plugin({ id: 't-snoop' }, (api) => api.use('t-svc', 'double')));
    host.install('t-client');
    expect(used).toBe(42);
    expect(() => host.install('t-snoop')).toThrow(/without listing it under dependencies/);
  });
});
