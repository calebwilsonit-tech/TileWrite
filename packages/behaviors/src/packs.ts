import { host, PluginError, type EditorExtensions, type PluginApi, type PluginDefinition } from './plugins/host';
import type { InputActionDef } from './plugins/extensions';
import { behaviorList } from './framework';
import { PluginManifestSchema } from './plugins/manifest';
import { setProjectLayers } from './plugins/layers';
import type { ProjectLayerData } from '@tilewright/runtime';

/**
 * Packs, the first name for plugins. A "pack" here is a plugin written as a plain object (id, name, version, `install`); the
 * project file's `plugins` list (called `packs` in project format 1) names the plugins a project uses, and a project made before
 * plugins had manifests keeps working because the same ids are the engine's own plugins. Everything is kept by the plugin host
 * (`plugins/host.ts`); these functions are the older, smaller doorway to it.
 *
 * The names that plugin authors used are deprecated in favour of `definePlugin` (see docs/plugins/README.md). They stay for as
 * long as the SDK does: the script API only grows, so a plugin written against them keeps loading.
 */

export type { EditorHost, EditorPanelDef, EditorToolDef, ImporterDef, EditorExtensions, PluginApi } from './plugins/host';
export type { InputActionDef } from './plugins/extensions';

/** @deprecated Write a plugin with `definePlugin` and a manifest instead; a `Pack` is the same thing without one. */
export interface Pack {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Other packs that must be on for this one to work. */
  requires?: readonly string[];
  /** True for packs that ship with the engine. */
  builtin?: boolean;
  install(api: PluginApi): void;
  /** The editor part, installed only in the editor. */
  installEditor?(api: PluginApi): void;
}

/** What the host's editor tables hold (panels, tools and importers a plugin added). */
export function editorExtensions(): EditorExtensions {
  return host.editor;
}

/** Called whenever plugins are installed or removed. Returns a function that stops listening. */
export function onPacksChanged(fn: () => void): () => void {
  return host.onChange((c) => {
    if (c.kind === 'installed' || c.kind === 'removed') fn();
  });
}

/** The manifest a pack written as a plain object stands for. */
export function manifestOfPack(pack: Pack): PluginDefinition['manifest'] {
  return PluginManifestSchema.parse({
    id: pack.id,
    name: pack.name,
    version: pack.version,
    description: pack.description,
    dependencies: Object.fromEntries((pack.requires ?? []).map((r) => [r, '*'])),
    builtin: pack.builtin === true,
  });
}

/**
 * Make a pack known (it is not on until it is installed). Registering again replaces the older version.
 * @deprecated Use `host.register` with a plugin definition (`definePlugin`).
 */
export function registerPack(pack: Pack): void {
  host.register({ manifest: manifestOfPack(pack), install: pack.install.bind(pack), ...(pack.installEditor ? { installEditor: pack.installEditor.bind(pack) } : {}) });
}

/** @deprecated Use `host.install`. */
export function installPack(id: string): void {
  host.install(id);
}

/** @deprecated Use `host.uninstall`. */
export function uninstallPack(id: string): void {
  host.uninstall(id);
}

/** @deprecated Use `host.isInstalled`. */
export function isPackInstalled(id: string): boolean {
  return host.isInstalled(id);
}

export function activePackIds(): string[] {
  return host.active();
}

let legacy: readonly string[] = [];

/** Say which plugins a project file with no list of plugins uses (a project from before plugins existed). The set that ships with the editor does this. */
export function setLegacyPacks(ids: readonly string[]): void {
  legacy = [...ids];
}

/** The plugins a project made before plugins existed plays with. */
export const legacyPacks = (): readonly string[] => legacy;

/** The packs a project file asks for (a file with no list is a project from before plugins existed). */
export const packsOfProject = (project: { plugins?: readonly string[] | undefined }): readonly string[] => project.plugins ?? legacy;

/** Use a project's plugins and the collision layers it names (what opening a project and playing it start with). */
export function useProject(project: { plugins?: readonly string[] | undefined; collisionLayers?: readonly ProjectLayerData[] | undefined }): void {
  setActivePacks(packsOfProject(project));
  setProjectLayers(project.collisionLayers);
}

/**
 * Turn exactly these packs on (and everything else off). `undefined` means "all the engine's own packs", which is what a project made
 * before packs existed gets, so it plays as it always did. A name nobody knows is skipped (the project check says so).
 */
export function setActivePacks(ids: readonly string[] | undefined): void {
  const want = new Set(ids ?? [...host.known.values()].filter((p) => p.manifest.builtin).map((p) => p.manifest.id));
  for (const p of host.known.values()) if (p.manifest.essential) want.add(p.manifest.id);
  for (const id of host.active()) if (!want.has(id)) host.uninstall(id);
  for (const id of want) {
    if (!host.known.has(id)) continue;
    try {
      host.install(id);
    } catch (e) {
      // a plugin that cannot start does not stop the others (the failure is on the Problems panel)
      if (!(e instanceof PluginError)) throw e;
    }
  }
}

export interface PackInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  builtin: boolean;
  active: boolean;
  requires: string[];
}

/** Every pack the engine knows about, for the Project settings dialog. */
export function listPacks(): PackInfo[] {
  return [...host.known.values()].map((p) => ({
    id: p.manifest.id,
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description,
    builtin: p.manifest.builtin,
    active: host.isInstalled(p.manifest.id),
    requires: Object.keys(p.manifest.dependencies),
  }));
}

/** What a pack added, in words (for the pack's page in the settings). */
export function packContents(id: string): { behaviors: string[]; conditions: string[]; actions: string[]; inputs: string[]; panels: string[]; tools: string[]; importers: string[] } | null {
  const c = host.contentsOf(id);
  if (!c) return null;
  const of = (kind: string): string[] => c.extensions.filter((e) => e.kind === kind).map((e) => e.id);
  return { behaviors: c.behaviors, conditions: c.conditions, actions: c.actions, inputs: c.inputs, panels: of('panels'), tools: of('tools'), importers: of('importers') };
}

/** Systems the installed packs want run each tick. */
export function packSystems(): ReturnType<typeof host.systems> {
  return host.systems();
}

/** Buttons the installed packs added, by id. */
export function packInputActions(): Record<string, InputActionDef> {
  return host.inputActions();
}

/** The buttons this game has: the core ones plus what the packs that are on added, with their starting keys and names. */
export function activeInput(): ReturnType<typeof host.activeInput> {
  return host.activeInput();
}

/** Which pack owns a behaviour (for the Inspector's labels and the checker), or undefined for the core. */
export function packOfBehavior(id: string): string | undefined {
  return host.ownerOfBehavior(id);
}

/** Which pack owns a behaviour, turned on or off. */
export function knownPackOfBehavior(id: string): string | undefined {
  return host.knownOwnerOfBehavior(id);
}

/** Behaviours that are on right now, by id (the Inspector's Add menu reads `behaviorList`; this is for tests and tools). */
export function installedBehaviorIds(): string[] {
  return behaviorList().map((b) => b.id);
}

/** The starter projects the plugins offer (for the New project list). */
export const allPluginTemplates = (): ReturnType<typeof host.allTemplates> => host.allTemplates();
