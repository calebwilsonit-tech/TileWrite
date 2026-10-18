import { baseInput, type System, type SystemMode } from '@tilewright/runtime';
import { behaviorList, getBehavior, defineBehavior, undefineBehavior, reshelveBehavior, type BehaviorDef } from './framework';
import { registerAction, registerCondition, shelvedAction, shelvedCondition, unregisterAction, unregisterCondition, type ActionDef, type ConditionDef } from './events/sheet';

/**
 * Packs: groups of behaviours, event blocks, systems, input actions and editor additions that a project turns on
 * and off. The engine's own optional parts (combat, inventory, story, AI, lighting) and the reference game's
 * mechanics (the "Storytender" pack) are packs, and so is anything a programmer writes against `PluginApi`: they all
 * load the same way. A project lists the packs it uses; an empty project lists none.
 */

// ---------- what a pack can add in the editor ----------

/** What a plugin sees of the editor. Filled in by the editor when it starts; every member is safe to call before that. */
export interface EditorHost {
  notify(kind: 'info' | 'warn' | 'error', text: string): void;
  /** The open project's name and folder, or null on the project screen. */
  project(): { name: string; dir: string } | null;
  /** The open scene's objects (read only). */
  entities(): { id: string; name: string; tags: string[]; components: Record<string, unknown> }[];
  /** Write a text file inside the project folder (relative path). */
  writeFile(path: string, text: string): Promise<void>;
  readFile(path: string): Promise<string>;
}

/** A panel a pack adds to the editor. Plain DOM, so a plugin needs no UI framework. */
export interface EditorPanelDef {
  id: string;
  title: string;
  /** Draw into `container`; return a function that cleans up. Called again whenever the panel is shown. */
  mount(container: HTMLElement, host: EditorHost): (() => void) | void;
}

/** A tool a pack adds to the Tools panel. */
export interface EditorToolDef {
  id: string;
  label: string;
  group?: string;
  help?: string;
  /** Called with the cell under the mouse when the tool is used. */
  onCell(cell: { x: number; y: number }, host: EditorHost, event: { kind: 'down' | 'drag' | 'up'; shift: boolean; alt: boolean }): void;
}

/** A file type a pack can bring into the project. */
export interface ImporterDef {
  id: string;
  label: string;
  /** Lower-case, with the dot: ".tmx". */
  extensions: string[];
  /** Turn the file into project files; return a sentence saying what was made. */
  import(name: string, bytes: Uint8Array, host: EditorHost): Promise<string> | string;
}

export interface EditorExtensions {
  panels: Map<string, EditorPanelDef & { pack: string }>;
  tools: Map<string, EditorToolDef & { pack: string }>;
  importers: Map<string, ImporterDef & { pack: string }>;
}

const extensions: EditorExtensions = { panels: new Map(), tools: new Map(), importers: new Map() };
const listeners = new Set<() => void>();

/** What packs added to the editor so far (the editor draws from this). */
export function editorExtensions(): EditorExtensions {
  return extensions;
}

/** Called whenever packs are installed or removed. Returns a function that stops listening. */
export function onPacksChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const changed = (): void => listeners.forEach((f) => f());

// ---------- the plugin API ----------

export interface InputActionDef {
  label: string;
  bindings: string[];
}

export interface PluginApi {
  /** The id of the pack being installed. */
  readonly packId: string;
  /** Add a behaviour; it shows up in the Inspector's Add menu like a built-in one. */
  behavior<S extends object>(def: BehaviorDef<S>): BehaviorDef<S>;
  /** Add a condition or an action to the event sheet's pickers. */
  condition(def: ConditionDef): void;
  action(def: ActionDef): void;
  /** Run a function once per tick (a simulation system). */
  system(name: string, fn: System, mode?: SystemMode): void;
  /** A button the game listens for, with the keys a new player starts with ("key:KeyF", "pad:button0", "mouse:0"). */
  inputAction(id: string, def: InputActionDef): void;
  /** Add to the editor. */
  panel(def: EditorPanelDef): void;
  tool(def: EditorToolDef): void;
  importer(def: ImporterDef): void;
  /** Take behaviours and event blocks the engine already defines into this pack (the engine's own modules use this). */
  adopt(members: { behaviors?: readonly string[]; conditions?: readonly string[]; actions?: readonly string[]; inputs?: Record<string, InputActionDef> }): void;
}

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
}

interface Installed {
  pack: Pack;
  behaviors: string[];
  conditions: string[];
  actions: string[];
  systems: { name: string; fn: System; mode: SystemMode }[];
  inputs: Record<string, InputActionDef>;
  panels: string[];
  tools: string[];
  importers: string[];
}

const known = new Map<string, Pack>();
const installed = new Map<string, Installed>();

/** Make a pack known (it is not on until it is installed). Registering again replaces the older version. */
export function registerPack(pack: Pack): void {
  if (installed.has(pack.id)) uninstallPack(pack.id);
  known.set(pack.id, pack);
}

export function installPack(id: string): void {
  if (installed.has(id)) return;
  const pack = known.get(id);
  if (!pack) throw new Error(`There is no pack called "${id}".`);
  for (const dep of pack.requires ?? []) installPack(dep);
  const rec: Installed = { pack, behaviors: [], conditions: [], actions: [], systems: [], inputs: {}, panels: [], tools: [], importers: [] };
  installed.set(id, rec);
  for (const [b, p] of offPackBehaviors) if (p === id) offPackBehaviors.delete(b);
  const api: PluginApi = {
    packId: id,
    behavior(def) {
      defineBehavior(def);
      rec.behaviors.push(def.id);
      return def;
    },
    condition(def) {
      registerCondition(def);
      rec.conditions.push(def.id);
    },
    action(def) {
      registerAction(def);
      rec.actions.push(def.id);
    },
    system(name, fn, mode = 'gameplay') {
      rec.systems.push({ name: `${id}:${name}`, fn, mode });
    },
    inputAction(actionId, def) {
      rec.inputs[actionId] = def;
    },
    panel(def) {
      extensions.panels.set(def.id, { ...def, pack: id });
      rec.panels.push(def.id);
    },
    tool(def) {
      extensions.tools.set(def.id, { ...def, pack: id });
      rec.tools.push(def.id);
    },
    importer(def) {
      extensions.importers.set(def.id, { ...def, pack: id });
      rec.importers.push(def.id);
    },
    adopt(m) {
      for (const b of m.behaviors ?? []) {
        if (!getBehavior(b) && !reshelveBehavior(b)) continue;
        rec.behaviors.push(b);
      }
      for (const c of m.conditions ?? []) {
        const def = shelvedCondition(c);
        if (def) {
          registerCondition(def);
          rec.conditions.push(c);
        }
      }
      for (const a of m.actions ?? []) {
        const def = shelvedAction(a);
        if (def) {
          registerAction(def);
          rec.actions.push(a);
        }
      }
      Object.assign(rec.inputs, m.inputs ?? {});
    },
  };
  try {
    pack.install(api);
  } catch (e) {
    uninstallPack(id);
    throw new Error(`The pack "${pack.name}" could not be installed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  changed();
}

export function uninstallPack(id: string): void {
  const rec = installed.get(id);
  if (!rec) return;
  for (const [other, o] of installed) if (other !== id && (o.pack.requires ?? []).includes(id)) uninstallPack(other);
  for (const b of rec.behaviors) {
    undefineBehavior(b);
    offPackBehaviors.set(b, id);
  }
  for (const c of rec.conditions) unregisterCondition(c);
  for (const a of rec.actions) unregisterAction(a);
  for (const p of rec.panels) extensions.panels.delete(p);
  for (const t of rec.tools) extensions.tools.delete(t);
  for (const i of rec.importers) extensions.importers.delete(i);
  installed.delete(id);
  changed();
}

export function isPackInstalled(id: string): boolean {
  return installed.has(id);
}

export function activePackIds(): string[] {
  return [...installed.keys()];
}

/**
 * Turn exactly these packs on (and everything else off). `undefined` means "all the engine's own packs", which is what a project made
 * before packs existed gets, so it plays as it always did.
 */
export function setActivePacks(ids: readonly string[] | undefined): void {
  const want = new Set(ids ?? [...known.values()].filter((p) => p.builtin).map((p) => p.id));
  for (const id of [...installed.keys()]) if (!want.has(id)) uninstallPack(id);
  for (const id of want) if (known.has(id)) installPack(id);
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
  return [...known.values()].map((p) => ({ id: p.id, name: p.name, version: p.version, description: p.description, builtin: p.builtin === true, active: installed.has(p.id), requires: [...(p.requires ?? [])] }));
}

/** What a pack added, in words (for the pack's page in the settings). */
export function packContents(id: string): { behaviors: string[]; conditions: string[]; actions: string[]; inputs: string[]; panels: string[]; tools: string[]; importers: string[] } | null {
  const r = installed.get(id);
  if (!r) return null;
  return { behaviors: [...r.behaviors], conditions: [...r.conditions], actions: [...r.actions], inputs: Object.keys(r.inputs), panels: [...r.panels], tools: [...r.tools], importers: [...r.importers] };
}

/** Systems the installed packs want run each tick. */
export function packSystems(): { name: string; fn: System; mode: SystemMode }[] {
  return [...installed.values()].flatMap((r) => r.systems);
}

/** Buttons the installed packs added, by id. */
export function packInputActions(): Record<string, InputActionDef> {
  const out: Record<string, InputActionDef> = {};
  for (const r of installed.values()) Object.assign(out, r.inputs);
  return out;
}

/** The buttons this game has: the core ones plus what the packs that are on added, with their starting keys and names. */
export function activeInput(): ReturnType<typeof baseInput> {
  return baseInput(packInputActions());
}

/** Which pack owns a behaviour (for the Inspector's labels and the checker), or undefined for the core. */
export function packOfBehavior(id: string): string | undefined {
  for (const [pid, r] of installed) if (r.behaviors.includes(id)) return pid;
  return undefined;
}

/** All behaviours a *turned-off* pack would add are gone; this lists ids known to belong to some pack (turned on or off). */
export function knownPackOfBehavior(id: string): string | undefined {
  return packOfBehavior(id) ?? offPackBehaviors.get(id);
}

/** Behaviours of packs that are off, by id, so the checker can say "turn on the Combat pack". */
const offPackBehaviors = new Map<string, string>();

/** Behaviours that are on right now, by id (the Inspector's Add menu reads `behaviorList`; this is for tests and tools). */
export function installedBehaviorIds(): string[] {
  return behaviorList().map((b) => b.id);
}
