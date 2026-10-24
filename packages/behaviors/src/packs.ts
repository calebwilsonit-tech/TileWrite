import { host, PluginError, type EditorExtensions, type PluginApi, type PluginDefinition } from './plugins/host';
import type { InputActionDef } from './plugins/extensions';
import { behaviorList } from './framework';
import { PluginManifestSchema } from './plugins/manifest';

/**
 * Packs, the first name for plugins. A "pack" here is a plugin written as a plain object (id, name, version, `install`); the
 * project file's `packs` list names the plugins a project uses, and a project made before plugins had manifests keeps working
 * because the same ids are the engine's own plugins. Everything is kept by the plugin host (`plugins/host.ts`); these functions
 * are the older, smaller doorway to it.
 */

export type { EditorHost, EditorPanelDef, EditorToolDef, ImporterDef, EditorExtensions, PluginApi } from './plugins/host';
export type { InputActionDef } from './plugins/extensions';

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

/** Make a pack known (it is not on until it is installed). Registering again replaces the older version. */
export function registerPack(pack: Pack): void {
  host.register({ manifest: manifestOfPack(pack), install: pack.install.bind(pack), ...(pack.installEditor ? { installEditor: pack.installEditor.bind(pack) } : {}) });
}

export function installPack(id: string): void {
  host.install(id);
}

export function uninstallPack(id: string): void {
  host.uninstall(id);
}

export function isPackInstalled(id: string): boolean {
  return host.isInstalled(id);
}

export function activePackIds(): string[] {
  return host.active();
}

/** The packs a project made before phase 2 plays with: the action-adventure ones. Turn-based play, control schemes and simulation helpers are new and opt-in. */
export const LEGACY_PACKS: readonly string[] = ['combat', 'inventory', 'story', 'ai', 'lighting', 'storytender'];

/** The packs a project file asks for (a file with no list is a project from before packs: the action-adventure set). */
export const packsOfProject = (project: { packs?: readonly string[] | undefined }): readonly string[] => project.packs ?? LEGACY_PACKS;

/**
 * Turn exactly these packs on (and everything else off). `undefined` means "all the engine's own packs", which is what a project made
 * before packs existed gets, so it plays as it always did. A name nobody knows is skipped (the project check says so).
 */
export function setActivePacks(ids: readonly string[] | undefined): void {
  const want = new Set(ids ?? [...host.known.values()].filter((p) => p.manifest.builtin).map((p) => p.manifest.id));
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
export function packSystems(): { name: string; fn: (typeof host.systems extends () => infer R ? R : never)[number]['fn']; mode: ReturnType<typeof host.systems>[number]['mode'] }[] {
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
