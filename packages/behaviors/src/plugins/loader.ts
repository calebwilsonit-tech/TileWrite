import { PluginError, type PluginApi, type PluginDefinition } from './host';
import type { TemplateDef } from './extensions';
import { parseManifest, type PluginManifest } from './manifest';
import { defaultImporter, type Importer } from '../scripting/loader';

/**
 * Plugins other people wrote. A plugin is a folder:
 *
 *   plugin.json     what it is, what it needs, what it wants to be allowed to do (see manifest.ts)
 *   <runtime>.cjs   the game part: one file (a CommonJS bundle) that exports the plugin; it runs in the editor and in the game
 *   <editor>.cjs    the editor part (optional): never exported with a game; it runs apart from the editor, see isolation.ts
 *   CHANGELOG.md    what changed (optional; shown when the plugin is updated)
 *
 * The runtime file is JavaScript with full access to the game while it runs, so it is only ever run after the person has
 * approved exactly that code (`PluginTrust`): change one byte and it must be approved again.
 */

/** The little the loader needs from a file system (the editor's, a test's). Paths are relative to the plugin's folder. */
export interface PluginFs {
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export interface PluginPackage {
  manifest: PluginManifest;
  /** The game part's code, or null for a plugin that only has an editor part (or none at all). */
  runtimeCode: string | null;
  editorCode: string | null;
  changelog: string;
  /** Identifies this exact code (and manifest): approval is given to this and nothing else. */
  hash: string;
}

export type PackageResult = { ok: true; pkg: PluginPackage } | { ok: false; problems: string[] };

/** A hash of the text, in hex (SHA-256 where the platform has it). */
export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // a platform without it: a simple hash, still different for different code
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, '0');
}

/** Read a plugin folder: its manifest, its code and what changed. Problems come back in plain words. */
export async function readPluginPackage(fs: PluginFs): Promise<PackageResult> {
  if (!(await fs.exists('plugin.json'))) return { ok: false, problems: ['There is no plugin.json in this folder, so it is not a plugin.'] };
  let json: unknown;
  const manifestText = await fs.readText('plugin.json');
  try {
    json = JSON.parse(manifestText);
  } catch (e) {
    return { ok: false, problems: [`plugin.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const m = parseManifest(json);
  if (!m.ok) return { ok: false, problems: m.problems.map((p) => `plugin.json: ${p}`) };
  const problems: string[] = [];
  const part = async (name: string | undefined, what: string): Promise<string | null> => {
    if (!name) return null;
    if (!(await fs.exists(name))) {
      problems.push(`plugin.json names the ${what} file "${name}", which is not in the folder.`);
      return null;
    }
    return fs.readText(name);
  };
  const runtimeCode = await part(m.manifest.entry.runtime, 'game part');
  const editorCode = await part(m.manifest.entry.editor, 'editor part');
  if (problems.length > 0) return { ok: false, problems };
  const changelog = m.manifest.changelog && (await fs.exists(m.manifest.changelog)) ? await fs.readText(m.manifest.changelog) : '';
  const hash = await hashText(`${manifestText}\n--runtime--\n${runtimeCode ?? ''}\n--editor--\n${editorCode ?? ''}`);
  return { ok: true, pkg: { manifest: m.manifest, runtimeCode, editorCode, changelog, hash } };
}

/** Which code the person has approved: plugin id -> the hash they approved. */
export class PluginTrust {
  private readonly approved = new Map<string, string>();

  approve(id: string, hash: string): void {
    this.approved.set(id, hash);
  }

  revoke(id: string): void {
    this.approved.delete(id);
  }

  isApproved(id: string, hash: string): boolean {
    return this.approved.get(id) === hash;
  }

  /** For keeping between runs of the editor. */
  toJSON(): Record<string, string> {
    return Object.fromEntries(this.approved);
  }

  static from(saved: unknown): PluginTrust {
    const t = new PluginTrust();
    if (saved && typeof saved === 'object') for (const [id, h] of Object.entries(saved as Record<string, unknown>)) if (typeof h === 'string') t.approve(id, h);
    return t;
  }
}

/** What a plugin's code may export. */
interface Exported {
  install?: (api: PluginApi) => void;
  templates?: TemplateDef[];
}

/**
 * Run the code of a plugin's game part and take the plugin out of it. The code is a CommonJS module; the only thing it can
 * `require` is the plugin SDK (`@tilewright/plugin-sdk`). It exports the plugin as `module.exports.default` or `module.exports`.
 * (It is imported as a module from a blob, because the editor's security policy does not allow `eval`.)
 */
export async function evaluatePlugin(pkg: PluginPackage, sdk: unknown, importer: Importer = defaultImporter()): Promise<PluginDefinition> {
  const id = pkg.manifest.id;
  if (pkg.runtimeCode === null) return { manifest: pkg.manifest, install: () => undefined };
  const slot = globalThis as { __tilewrightRequire?: (name: string) => unknown };
  const before = slot.__tilewrightRequire;
  slot.__tilewrightRequire = (name: string): unknown => {
    if (name === '@tilewright/plugin-sdk') return sdk;
    throw new PluginError(`The plugin "${pkg.manifest.name}" asked for "${name}", but a plugin can only use the plugin SDK (@tilewright/plugin-sdk). Bundle everything else into the plugin's file.`);
  };
  let exported: Exported;
  try {
    const text = `const module = { exports: {} }; const exports = module.exports; const require = (n) => globalThis.__tilewrightRequire(n);\n${pkg.runtimeCode}\n;export default module.exports;`;
    const loaded = await importer(text);
    const all = (loaded.default ?? {}) as Record<string, unknown>;
    exported = ((all.default as Exported | undefined) ?? (all as Exported)) as Exported;
  } catch (e) {
    if (e instanceof PluginError) throw e;
    throw new PluginError(`The plugin "${pkg.manifest.name}" could not start: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  } finally {
    slot.__tilewrightRequire = before;
  }
  if (typeof exported.install !== 'function') {
    throw new PluginError(`The plugin "${id}" does not export an install function. Its file should end with: module.exports.default = sdk.definePlugin(manifest, { install(api) { ... } });`);
  }
  return { manifest: pkg.manifest, install: exported.install, ...(exported.templates ? { templates: exported.templates } : {}) };
}

export type LoadOutcome = { state: 'loaded'; definition: PluginDefinition } | { state: 'needs-approval'; pkg: PluginPackage } | { state: 'refused'; problems: string[] };

/** Turn a package into a plugin the host can register: only when its exact code has been approved. */
export async function loadPackage(pkg: PluginPackage, trust: PluginTrust, sdk: unknown, opts: { builtin?: boolean; importer?: Importer } = {}): Promise<LoadOutcome> {
  const builtin = opts.builtin === true;
  if (!builtin && pkg.manifest.builtin) return { state: 'refused', problems: [`The plugin "${pkg.manifest.id}" says it ships with Tilewright, but it does not. Only the editor's own plugins can say that.`] };
  if (!builtin && pkg.runtimeCode !== null && !trust.isApproved(pkg.manifest.id, pkg.hash)) return { state: 'needs-approval', pkg };
  try {
    return { state: 'loaded', definition: await evaluatePlugin(pkg, sdk, opts.importer) };
  } catch (e) {
    return { state: 'refused', problems: [e instanceof Error ? e.message : String(e)] };
  }
}
