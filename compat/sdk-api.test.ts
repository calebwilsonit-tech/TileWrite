/**
 * The plugin SDK only grows (Rule A.4, for plugins): every name a plugin could import from `@tilewright/plugin-sdk`, every method of
 * the api a plugin is given and every table of things a plugin can add keeps its name. Plugins other people wrote must keep loading
 * until a new major version of the plugin platform (`ENGINE_VERSION`).
 *
 *   npm run compat                  compare with the baseline
 *   COMPAT_UPDATE=1 npm run compat  add the new names to the baseline (it never drops one)
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as sdk from '@tilewright/plugin-sdk';
import * as legacy from '@tilewright/plugin-sdk/legacy';
import { ENGINE_VERSION, PluginHost, definePlugin } from '@tilewright/plugin-sdk';
import { COMPAT } from './harness/corpus';

const update = process.env.COMPAT_UPDATE === '1';

/** What a plugin can reach: the SDK's exports, the api's methods and the extension tables. */
function surface(): { exports: string[]; api: string[]; tables: string[] } {
  const host = new PluginHost();
  let api: string[] = [];
  host.register(
    definePlugin(
      { id: 'probe', name: 'Probe', version: '1.0.0', engine: '^1.0.0' },
      {
        install(a) {
          api = Object.keys(a);
        },
      },
    ),
  );
  host.install('probe');
  // (the SDK is a list now; every name it ever had is still reachable, from the list or from the deprecated legacy entry)
  return { exports: [...new Set([...Object.keys(sdk), ...Object.keys(legacy)])].sort(), api: api.sort(), tables: Object.keys(host.ext).sort() };
}

describe(`the plugin SDK only grows (platform version ${ENGINE_VERSION})`, () => {
  it('keeps every name it has ever had', () => {
    const file = path.join(COMPAT, 'baselines', 'sdk-api.json');
    const now = surface();
    const had = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string[]>) : {};
    if (update || !fs.existsSync(file)) {
      const merged = Object.fromEntries(Object.entries(now).map(([k, v]) => [k, [...new Set([...(had[k] ?? []), ...v])].sort()]));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
      return;
    }
    for (const kind of ['exports', 'api', 'tables'] as const) {
      const missing = (had[kind] ?? []).filter((n) => !now[kind].includes(n));
      expect(missing, `These ${kind} of the plugin SDK were removed or renamed. Keep the old name as an alias, or bump the plugin platform's major version.`).toEqual([]);
    }
  });
});
