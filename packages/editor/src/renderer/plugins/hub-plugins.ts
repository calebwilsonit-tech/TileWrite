import { api } from '../project/api';
import { DEFAULT_HUB, HubClient } from '../library/hub';
import { PACK_FORMAT, PACK_VERSION, decodeFile, encodeFile, type Pack } from '../library/pack';

/**
 * Plugins on the asset hub. A plugin is shared as a pack of kind "plugin" whose files sit in assets/plugin/ (plugin.json, plugin.cjs,
 * editor.cjs, CHANGELOG.md). It has code, so the hub holds it for a moderator, and the editor installs it like any plugin from an
 * address: the person reads what it wants and says yes before it runs.
 */

export const PLUGIN_PACK_DIR = 'assets/plugin/';
const PLUGIN_FILES = ['plugin.json', 'plugin.cjs', 'editor.cjs', 'CHANGELOG.md'];

/** The pack to share a plugin with: its files, marked as code. */
export function pluginPack(files: Record<string, string>, info: { name: string; description: string; author: string; licence: string; tags?: string[] }): Pack {
  return {
    format: PACK_FORMAT,
    formatVersion: PACK_VERSION,
    name: info.name,
    kind: 'plugin',
    description: info.description,
    author: info.author,
    licence: info.licence,
    tags: info.tags ?? ['plugin'],
    createdAt: new Date().toISOString(),
    files: PLUGIN_FILES.filter((f) => typeof files[f] === 'string').map((f) => encodeFile(PLUGIN_PACK_DIR + f, files[f]!)),
    tiles: [],
    autotile: [],
    uiPrefabs: [],
    uiScreens: [],
    code: true,
  };
}

/** The plugin bundle (what "install from an address" reads) inside a pack from the hub. Throws with a plain message when it is not a plugin. */
export function pluginBundleOf(pack: Pack): string {
  if (pack.kind !== 'plugin') throw new Error(`"${pack.name}" is not a plugin; it is a ${pack.kind} asset pack. Add it to your library instead.`);
  const files: Record<string, string> = {};
  for (const f of pack.files) {
    if (!f.path.startsWith(PLUGIN_PACK_DIR)) continue;
    const name = f.path.slice(PLUGIN_PACK_DIR.length);
    const text = decodeFile(f);
    if (PLUGIN_FILES.includes(name) && typeof text === 'string') files[name] = text;
  }
  if (typeof files['plugin.json'] !== 'string') throw new Error(`The plugin "${pack.name}" on the hub has no plugin.json, so it cannot be installed.`);
  return JSON.stringify({ files });
}

function read(key: string, fallback = ''): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** The hub the person uses (the same address and sign-in as the Asset Hub panel). */
export function hubClient(address = read('tilewright.hub', DEFAULT_HUB)): HubClient {
  const client = new HubClient(address, (r) => api().hubRequest(r));
  client.token = read(`tilewright.hub.token.${address}`);
  return client;
}
