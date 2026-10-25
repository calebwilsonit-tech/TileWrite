// (a plugin from outside is handed the whole old SDK, so one written before the list was made still finds every name it used)
import * as sdk from '@tilewright/plugin-sdk/legacy';
import { PluginTrust, compareVersionText, host, loadPackage, readPluginPackage, type PluginFs, type PluginPackage } from '@tilewright/behaviors';
import { api } from '../project/api';
import { joinPath } from '../project/api';
import { installIsolatedEditorPart } from './isolated';
import { browserWorker, preflightGamePart } from './preflight';
import { hubClient, pluginBundleOf } from './hub-plugins';

/**
 * Plugins other people wrote, kept on this computer: found in the plugin store (a folder per id and version), read, approved by the
 * person, and made known to the plugin host. The editor's own plugins are not here: they are already known when the editor starts.
 */

export type PluginState =
  /** Known to the host and usable. */
  | 'ready'
  /** The person has not approved this exact code yet. */
  | 'needs-approval'
  /** Something is wrong with it (the problems say what). */
  | 'refused';

export interface InstalledPlugin {
  id: string;
  version: string;
  /** Where its files are. */
  dir: string;
  /** Opened from a folder while it is being written (changes are picked up at once). */
  dev: boolean;
  pkg: PluginPackage | null;
  state: PluginState;
  problems: string[];
}

interface Saved {
  trust: Record<string, string>;
  grants: Record<string, string[]>;
  /** A version the person chose to stay on (rolling back), by plugin id. */
  pinned: Record<string, string>;
  /** Folders opened in development mode. */
  dev: string[];
  /** Where a plugin was got from, so it can be updated from there. */
  sources: Record<string, PluginSource>;
}

/** Where an installed plugin came from. */
export type PluginSource = { via: 'address'; address: string } | { via: 'hub'; hub: string; item: string };

const fsOf = (dir: string): PluginFs => ({
  readText: (p) => api().fs.read(joinPath(dir, p)),
  exists: (p) => api().fs.exists(joinPath(dir, p)),
});

class PluginManager {
  installed: InstalledPlugin[] = [];
  private trust = new PluginTrust();
  private grants: Record<string, string[]> = {};
  private pinned: Record<string, string> = {};
  private dev = new Set<string>();
  private sources: Record<string, PluginSource> = {};
  private readonly listeners = new Set<() => void>();
  private stopWatching: (() => void) | null = null;
  version = 0;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  private async load(): Promise<void> {
    const s = ((await api().settings.get()).plugins ?? {}) as Partial<Saved>;
    this.trust = PluginTrust.from(s.trust);
    this.grants = s.grants ?? {};
    this.pinned = s.pinned ?? {};
    this.dev = new Set(s.dev ?? []);
    this.sources = s.sources ?? {};
  }

  private async save(): Promise<void> {
    const cur = await api().settings.get();
    const plugins: Saved = { trust: this.trust.toJSON(), grants: this.grants, pinned: this.pinned, dev: [...this.dev], sources: this.sources };
    await api().settings.set({ ...cur, plugins });
  }

  /** Read the store and the development folders, and make every approved plugin known to the host. Called when the editor starts. */
  async init(): Promise<void> {
    await this.load();
    await this.refresh();
    this.stopWatching ??= api().plugins.onChanged((dir) => void this.reloadDev(dir));
    for (const d of this.dev) void api().plugins.watch(d).catch(() => undefined);
  }

  /** Read everything again. */
  async refresh(): Promise<void> {
    const found = await api().plugins.list();
    const out: InstalledPlugin[] = [];
    for (const f of found) out.push(await this.read(f.dir, f.id, f.version, false));
    for (const d of this.dev) {
      try {
        const r = await readPluginPackage(fsOf(d));
        out.push(await this.finish(d, r.ok ? r.pkg : null, r.ok ? [] : r.problems, true));
      } catch (e) {
        out.push({ id: d, version: '0.0.0', dir: d, dev: true, pkg: null, state: 'refused', problems: [e instanceof Error ? e.message : String(e)] });
      }
    }
    this.installed = out;
    await this.sync();
    this.changed();
  }

  private async read(dir: string, id: string, version: string, dev: boolean): Promise<InstalledPlugin> {
    const r = await readPluginPackage(fsOf(dir));
    if (!r.ok) return { id, version, dir, dev, pkg: null, state: 'refused', problems: r.problems };
    return this.finish(dir, r.pkg, [], dev);
  }

  private async finish(dir: string, pkg: PluginPackage | null, problems: string[], dev: boolean): Promise<InstalledPlugin> {
    if (!pkg) return { id: dir, version: '0.0.0', dir, dev, pkg: null, state: 'refused', problems };
    const bundled = host.known.get(pkg.manifest.id)?.manifest.builtin === true;
    if (bundled) return { id: pkg.manifest.id, version: pkg.manifest.version, dir, dev, pkg, state: 'refused', problems: [`The id "${pkg.manifest.id}" belongs to a plugin that ships with Tilewright.`] };
    return { id: pkg.manifest.id, version: pkg.manifest.version, dir, dev, pkg, state: this.trust.isApproved(pkg.manifest.id, pkg.hash) || pkg.runtimeCode === null ? 'ready' : 'needs-approval', problems: [] };
  }

  /** The version of a plugin that is used: the one the person pinned, else the highest. */
  chosen(id: string): InstalledPlugin | undefined {
    const all = this.installed.filter((p) => p.id === id && p.pkg);
    const dev = all.find((p) => p.dev);
    if (dev) return dev;
    const pinned = this.pinned[id];
    if (pinned) {
      const p = all.find((x) => x.version === pinned);
      if (p) return p;
    }
    return [...all].sort((a, b) => compareVersionText(b.version, a.version))[0];
  }

  /** Make the chosen version of every ready plugin known to the host (a plugin that is already on is restarted). */
  private async sync(): Promise<void> {
    const ids = new Set(this.installed.map((p) => p.id));
    for (const id of ids) {
      const p = this.chosen(id);
      if (!p?.pkg || p.state !== 'ready') continue;
      const known = host.known.get(id);
      if (known && known.manifest.version === p.pkg.manifest.version && !p.dev) continue;
      const out = await loadPackage(p.pkg, this.trust, sdk, { preflight: (pkg) => preflightGamePart(pkg.manifest.name, pkg.runtimeCode ?? '', browserWorker) });
      if (out.state !== 'loaded') {
        p.state = out.state === 'needs-approval' ? 'needs-approval' : 'refused';
        p.problems = out.state === 'refused' ? out.problems : [];
        continue;
      }
      host.register(out.definition);
      if (this.grants[id]) host.grant(id, this.grants[id]!);
      const code = p.pkg.editorCode;
      if (code) host.attachEditor(id, installIsolatedEditorPart(id, code));
    }
  }

  private async reloadDev(dir: string): Promise<void> {
    if (!this.dev.has(dir)) return;
    await this.refresh();
    host.clearFailure(this.installed.find((p) => p.dir === dir)?.id ?? '');
  }

  // ---------- what the person can do ----------

  /** Copy a plugin folder into the store. */
  async installFromFolder(dir: string): Promise<InstalledPlugin> {
    const r = await api().plugins.installFolder(dir);
    await this.refresh();
    return this.installed.find((p) => p.id === r.id && p.version === r.version)!;
  }

  async installFromBundle(text: string): Promise<InstalledPlugin> {
    const r = await api().plugins.installBundle(text);
    await this.refresh();
    return this.installed.find((p) => p.id === r.id && p.version === r.version)!;
  }

  async installFromAddress(address: string): Promise<InstalledPlugin> {
    const p = await this.installFromBundle(await api().plugins.fetch(address));
    await this.remember(p.id, { via: 'address', address });
    return p;
  }

  /** Install a plugin that is shared on the asset hub (it still has to be allowed before it runs, like any plugin from outside). */
  async installFromHub(item: string, hub?: string): Promise<InstalledPlugin> {
    const client = hubClient(hub);
    const { pack } = await client.download(item);
    const p = await this.installFromBundle(pluginBundleOf(pack));
    await this.remember(p.id, { via: 'hub', hub: client.address, item });
    return p;
  }

  private async remember(id: string, source: PluginSource): Promise<void> {
    this.sources[id] = source;
    await this.save();
  }

  /** Where the plugin was got from, when it can be asked again for a newer version. */
  sourceOf(id: string): PluginSource | undefined {
    return this.sources[id];
  }

  /** Ask where the plugin came from whether there is a newer version. Nothing is installed. */
  async checkUpdate(id: string): Promise<{ current: string; latest: string; newer: boolean; text: string }> {
    const source = this.sources[id];
    if (!source) throw new Error('This plugin was not installed from an address or the hub, so there is nowhere to look for a newer version.');
    const text = source.via === 'address' ? await api().plugins.fetch(source.address) : pluginBundleOf((await hubClient(source.hub).download(source.item)).pack);
    const manifest = (JSON.parse(JSON.parse(text).files['plugin.json'] as string) as { version?: string }).version ?? '0.0.0';
    const current = this.chosen(id)?.version ?? '0.0.0';
    return { current, latest: manifest, newer: compareVersionText(manifest, current) > 0, text };
  }

  /** The person asked to update: the newer version is installed next to the old one (and needs allowing again, since its code changed). */
  async update(id: string): Promise<{ updated: boolean; message: string }> {
    const r = await this.checkUpdate(id);
    if (!r.newer) return { updated: false, message: `You have the newest version (${r.current}).` };
    await this.installFromBundle(r.text);
    if (this.pinned[id]) delete this.pinned[id];
    await this.save();
    await this.refresh();
    return { updated: true, message: `Updated ${r.current} to ${r.latest}. The new version has to be allowed before it runs.` };
  }

  /** The recent projects that list the plugin, by name (a project that cannot be read is skipped). */
  async usedBy(id: string): Promise<string[]> {
    const out: string[] = [];
    for (const r of await api().recent.list()) {
      try {
        const project = JSON.parse(await api().fs.read(joinPath(r.dir, 'project.json'))) as { plugins?: string[]; packs?: string[] };
        if ((project.plugins ?? project.packs ?? []).includes(id)) out.push(r.name);
      } catch {
        /* not there any more, or not readable */
      }
    }
    return out;
  }

  /** Open a folder as a plugin being written: it is used where it is, and changes to it are picked up at once. */
  async openDev(dir: string): Promise<void> {
    this.dev.add(dir);
    await this.save();
    await api().plugins.watch(dir);
    await this.refresh();
  }

  async closeDev(dir: string): Promise<void> {
    this.dev.delete(dir);
    await this.save();
    await api().plugins.unwatch(dir);
    await this.refresh();
  }

  /** The person has read what the plugin wants and says it may run, with these permissions. */
  async approve(id: string, version: string, permissions: string[]): Promise<void> {
    const p = this.installed.find((x) => x.id === id && x.version === version);
    if (!p?.pkg) return;
    this.trust.approve(id, p.pkg.hash);
    this.grants[id] = permissions;
    host.grant(id, permissions);
    await this.save();
    await this.refresh();
  }

  async revoke(id: string): Promise<void> {
    this.trust.revoke(id);
    delete this.grants[id];
    host.forget(id);
    await this.save();
    await this.refresh();
  }

  async remove(id: string, version?: string): Promise<void> {
    if (!version) {
      host.forget(id);
      delete this.sources[id];
    }
    await api().plugins.remove(id, version);
    if (!version || this.pinned[id] === version) delete this.pinned[id];
    await this.save();
    await this.refresh();
  }

  /** Go back to an older version of a plugin (and stay on it until updated on purpose). */
  async pin(id: string, version: string): Promise<void> {
    this.pinned[id] = version;
    host.forget(id);
    await this.save();
    await this.refresh();
  }

  async unpin(id: string): Promise<void> {
    delete this.pinned[id];
    host.forget(id);
    await this.save();
    await this.refresh();
  }

  pinnedVersion(id: string): string | undefined {
    return this.pinned[id];
  }

  grantsOf(id: string): string[] {
    return this.grants[id] ?? [];
  }

  /** The ids a project asks for that no plugin on this computer provides. */
  missing(ids: readonly string[]): string[] {
    return ids.filter((id) => !host.known.has(id));
  }
}

export const pluginManager = new PluginManager();
