import { addPhysicsModifier, baseInput, removePhysicsModifiersOf, setExtraInputActions, type Entity, type SimContext, type System, type SystemMode } from '@tilewright/runtime';
import { behaviorList, defineBehavior, getBehavior, reshelveBehavior, undefineBehavior, type BehaviorDef } from '../framework';
import { registerAction, registerCondition, shelvedAction, shelvedCondition, unregisterAction, unregisterCondition, type ActionDef, type ConditionDef } from '../events/sheet';
import type { ComponentDef, EventDef, Extensions, ExtensionKind, InputActionDef, OwnedBy } from './extensions';
import type * as X from './extensions';
import { ENGINE_VERSION, grants, parseManifest, worksWithEngine, type PluginManifest } from './manifest';
import { satisfies } from './semver';
import { addWhoFilter, removeWhoFilter, setGhostLayer } from '../builtins/filters';
import { addEventEntry, removeEventEntry } from '../events/catalog';

/**
 * The plugin host: everything that turns a plugin into parts of the editor and the game, and takes them away again.
 *
 * A plugin is a manifest (`plugin.json`) and an `install(api)` function. The api it is given adds behaviours, event blocks,
 * systems, buttons, collision layers, physics modifiers, widgets, screens, prefabs, templates, validators, panels, tools, file
 * readers, assistant tools and more, and everything it adds is remembered against the plugin, so turning the plugin off takes
 * it all out again. What a plugin may do beyond adding things (read or write the project, use the network, the clipboard, run
 * programs) goes through the api and is checked against the permissions the person granted.
 */

export class PluginError extends Error {}

// ---------- the editor, as a plugin sees it ----------

/** What a plugin sees of the editor. Filled in by the editor when it starts; every member is safe to call before that. */
export interface EditorHost {
  notify(kind: 'info' | 'warn' | 'error', text: string): void;
  /** The open project's name and folder, or null on the project screen. */
  project(): { name: string; dir: string } | null;
  /** The open scene's objects (read only). */
  entities(): { id: string; name: string; tags: string[]; components: Record<string, unknown> }[];
  /** Write a text file inside the project folder (relative path). Needs the `project.write` permission. */
  writeFile(path: string, text: string): Promise<void>;
  /** Read a file of the project (relative path). Needs the `project.read` permission. */
  readFile(path: string): Promise<string>;
  /** The clipboard's text, and putting text on it. Needs the `clipboard` permission. */
  clipboard: { read(): Promise<string>; write(text: string): Promise<void> };
  /** Run another program on this computer (the person is asked each time). Needs the `programs` permission, which is off by default. */
  runProgram(command: string, args: string[], plugin?: string): Promise<{ code: number; stdout: string; stderr: string }>;
}

/** A panel a plugin adds to the editor. Plain DOM, so a plugin needs no UI framework. */
export interface EditorPanelDef {
  id: string;
  title: string;
  /** Draw into `container`; return a function that cleans up. Called again whenever the panel is shown. */
  mount(container: HTMLElement, host: EditorHost): (() => void) | void;
}

/** A tool a plugin adds to the Tools panel. */
export interface EditorToolDef {
  id: string;
  label: string;
  group?: string;
  help?: string;
  /** Called with the cell under the mouse when the tool is used. */
  onCell(cell: { x: number; y: number }, host: EditorHost, event: { kind: 'down' | 'drag' | 'up'; shift: boolean; alt: boolean }): void;
}

/** A file type a plugin can bring into the project. */
export interface ImporterDef {
  id: string;
  label: string;
  /** Lower-case, with the dot: ".tmx". */
  extensions: string[];
  /** Turn the file into project files; return a line saying what was made. */
  import(name: string, bytes: Uint8Array, host: EditorHost): Promise<string> | string;
}

export interface EditorExtensions {
  panels: Map<string, EditorPanelDef & OwnedBy>;
  tools: Map<string, EditorToolDef & OwnedBy>;
  importers: Map<string, ImporterDef & OwnedBy>;
}

// ---------- the api ----------

export interface PluginApi {
  /** The id of the plugin being installed, and its manifest. */
  readonly id: string;
  /** Kept for the older packs: the same as `id`. */
  readonly packId: string;
  readonly manifest: PluginManifest;
  /** Is this the editor (true) or a game (false)? Editor-only parts are only installed in the editor. */
  readonly inEditor: boolean;

  // --- the game ---
  /** Add a behaviour; it shows up in the Inspector's Add menu like a built-in one. */
  behavior<S extends object>(def: BehaviorDef<S>): BehaviorDef<S>;
  /** Add several behaviours at once. */
  behaviors(...defs: readonly BehaviorDef<any>[]): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Add several conditions / actions to the event sheet's pickers at once. */
  conditions(...defs: readonly ConditionDef[]): void;
  actions(...defs: readonly ActionDef[]): void;
  /** Add a data component (state a plugin keeps on objects, with defaults). */
  component(def: ComponentDef): void;
  /** Add a condition or an action to the event sheet's pickers (a logic node), or an event objects can announce. */
  condition(def: ConditionDef): void;
  action(def: ActionDef): void;
  event(def: EventDef): void;
  /** Run a function once per tick (a simulation system). */
  system(name: string, fn: System, mode?: SystemMode, stage?: X.SystemStage): void;
  /** A button the game listens for, with the keys a new player starts with ("key:KeyF", "pad:button0", "mouse:0"). */
  inputAction(id: string, def: InputActionDef): void;
  /** Add a collision layer with its own bit. */
  collisionLayer(def: X.CollisionLayerDef): void;
  /** Change how bodies move before each step (wind, ice, a conveyor). */
  physicsModifier(def: X.PhysicsModifierDef): void;
  /** Add a group plates and zones can react to ("crates", "helpers"). */
  whoFilter(def: X.WhoFilterDef): void;
  /** Add a way a place on the world map can unlock ("a checkpoint is lit there"). */
  unlockRule(def: X.UnlockRuleDef): void;
  /** Give scripts a method (me.damage, game.startDialogue...) that this plugin implements. */
  scriptMethod(def: X.ScriptMethodDef): void;
  /** Add a kind of block (a tile with its own colours and rules). */
  blockType(def: X.BlockTypeDef): void;

  // --- the interface framework ---
  widget(def: X.WidgetDef): void;
  screen(def: X.ScreenDef): void;
  screenRole(def: X.ScreenRoleDef): void;

  // --- the editor ---
  panel(def: EditorPanelDef): void;
  tool(def: EditorToolDef): void;
  importer(def: ImporterDef): void;
  exporter(def: X.ExporterDef): void;
  exportTarget(def: X.ExportTargetDef): void;
  inspector(def: X.InspectorDef): void;
  prefab(def: X.PrefabDef): void;
  template(def: X.TemplateDef): void;
  validator(def: X.ValidatorDef): void;
  playbotStrategy(def: X.PlaybotStrategyDef): void;
  playbotMove(def: X.PlaybotMoveDef): void;
  /** Cells that can be walked over a pit or water because of something this plugin brings. */
  bridgeSource(def: X.BridgeSourceDef): void;

  // --- the assistant ---
  fileReader(def: X.FileReaderDef): void;
  assistantTool(def: X.AssistantToolDef): void;
  imageProvider(def: X.ImageProviderDef): void;
  /** Tell the assistant, in a line or two, what this plugin adds and when to use it. */
  assistantNote(text: string): void;

  // --- between plugins, and with the person ---
  /** Offer something to other plugins that depend on this one, by name. */
  provide(name: string, value: unknown): void;
  /** Words the game shows that a translator should see (the plugin lists them; the editor puts them in the translation tables). */
  strings(list: () => string[]): void;
  /** Take what a plugin this one depends on offered (undefined when it is not on). */
  use<T = unknown>(pluginId: string, name: string): T | undefined;
  /** A line in the Console, tagged with this plugin's name. */
  log(kind: 'log' | 'warn' | 'error', text: string): void;
  /** Make a request to a host the plugin asked permission for (`network:<host>`). */
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; text(): Promise<string>; bytes(): Promise<Uint8Array> }>;

  /** Take behaviours and event blocks the engine already defines into this plugin (used while the engine's own modules move into plugins). */
  adopt(members: { behaviors?: readonly string[]; conditions?: readonly string[]; actions?: readonly string[]; inputs?: Record<string, InputActionDef> }): void;
}

/** Make a plugin from its plugin.json and its code. Throws, saying what is wrong, when the manifest is not valid. */
export function definePlugin(manifest: unknown, parts: { install(api: PluginApi): void; installEditor?(api: PluginApi): void; templates?: X.TemplateDef[] }): PluginDefinition {
  const r = parseManifest(manifest);
  if (!r.ok) throw new PluginError(`plugin.json is not valid: ${r.problems.join('; ')}`);
  return { manifest: r.manifest, ...parts };
}

export interface PluginDefinition {
  manifest: PluginManifest;
  /** The game part: runs in the editor and in the game. */
  install(api: PluginApi): void;
  /** The editor part: only the editor installs it (never exported). */
  installEditor?(api: PluginApi): void;
  /** Starter projects it offers in the New project list, whether or not it is on in the project that is open. */
  templates?: X.TemplateDef[];
}

// ---------- what the host keeps ----------

interface Installed {
  def: PluginDefinition;
  behaviors: string[];
  conditions: string[];
  actions: string[];
  systems: { name: string; fn: System; mode: SystemMode; stage: X.SystemStage }[];
  inputs: Record<string, InputActionDef>;
  provided: Map<string, unknown>;
  strings: (() => string[])[];
  /** Everything added to the extension tables, by table and id, so uninstalling removes exactly that. */
  added: { kind: ExtensionKind; id: string }[];
  physicsModifiers: string[];
}

export interface PluginFailure {
  plugin: string;
  message: string;
  /** Where it went wrong: "the behaviour Health", "the panel Hub"... */
  where: string;
  at: number;
}

const emptyExtensions = (): Extensions => ({
  components: new Map(),
  events: new Map(),
  physicsModifiers: new Map(),
  collisionLayers: new Map(),
  whoFilters: new Map(),
  unlockRules: new Map(),
  scriptMethods: new Map(),
  blockTypes: new Map(),
  widgets: new Map(),
  screens: new Map(),
  screenRoles: new Map(),
  inspectors: new Map(),
  exporters: new Map(),
  exportTargets: new Map(),
  prefabs: new Map(),
  templates: new Map(),
  validators: new Map(),
  playbotStrategies: new Map(),
  playbotMoves: new Map(),
  bridgeSources: new Map(),
  fileReaders: new Map(),
  assistantTools: new Map(),
  imageProviders: new Map(),
  assistantNotes: new Map(),
});

export type HostChange = { kind: 'installed' | 'removed' | 'failed' | 'granted' | 'extended'; plugin: string };

export class PluginHost {
  /** Plugins the host knows about (turned on or not). */
  readonly known = new Map<string, PluginDefinition>();
  readonly installed = new Map<string, Installed>();
  readonly ext: Extensions = emptyExtensions();
  /** What the editor's parts (panels, tools, importers) have added. */
  readonly editor: EditorExtensions = { panels: new Map(), tools: new Map(), importers: new Map() };
  private readonly failedPlugins = new Map<string, PluginFailure>();
  private readonly granted = new Map<string, string[]>();
  private readonly listeners = new Set<(c: HostChange) => void>();
  private readonly offBehaviors = new Map<string, string>();
  /** Set by the editor: what a plugin's editor parts can see, and how files and the network are really reached. */
  editorHost: EditorHost | null = null;
  inEditor = false;
  /** How a plugin reaches the network; the editor swaps in the real one. */
  netFetch: PluginApi['fetch'] = async () => {
    throw new PluginError('This place cannot reach the network.');
  };
  /** Where the Console lines of plugins go. */
  logSink: (plugin: string, kind: 'log' | 'warn' | 'error', text: string) => void = () => undefined;

  // --- knowing about plugins ---

  /** Make a plugin known (it is not on until it is installed). Registering again replaces the older version (dev mode and updates). */
  register(def: PluginDefinition): void {
    const wasOn = this.installed.has(def.manifest.id);
    if (wasOn) this.uninstall(def.manifest.id);
    this.known.set(def.manifest.id, def);
    this.failedPlugins.delete(def.manifest.id);
    if (wasOn) this.install(def.manifest.id);
  }

  /** Forget a plugin completely (uninstalled from the computer). */
  forget(id: string): void {
    this.uninstall(id);
    this.known.delete(id);
    this.failedPlugins.delete(id);
    this.granted.delete(id);
  }

  onChange(fn: (c: HostChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(c: HostChange): void {
    for (const l of [...this.listeners]) l(c);
  }

  // --- permissions ---

  grant(id: string, permissions: readonly string[]): void {
    this.granted.set(id, [...permissions]);
    this.emit({ kind: 'granted', plugin: id });
  }

  permissionsOf(id: string): { asked: string[]; granted: string[] } {
    const def = this.known.get(id);
    const asked = def?.manifest.permissions ?? [];
    // the engine's own plugins are trusted with what they ask; anything else has what the person granted
    const granted = def?.manifest.builtin ? [...asked] : (this.granted.get(id) ?? []);
    return { asked: [...asked], granted: [...granted] };
  }

  private allowed(id: string, wanted: string): boolean {
    return grants(this.permissionsOf(id).granted, wanted);
  }

  /**
   * The editor as one plugin sees it: the same functions, but each checks the permission the plugin was given. A plugin that did
   * not ask for `project.write` cannot write; one that asked and was refused cannot either. (The engine's own plugins have what they ask for.)
   */
  editorHostFor(id: string): EditorHost {
    const raw = (): EditorHost => {
      if (!this.editorHost) throw new PluginError('The editor is not ready yet.');
      return this.editorHost;
    };
    const name = (): string => this.known.get(id)?.manifest.name ?? id;
    return {
      notify: (kind, text) => this.editorHost?.notify(kind, `${name()}: ${text}`),
      project: () => {
        const p = this.editorHost?.project() ?? null;
        return p && this.allowed(id, 'project.read') ? p : p ? { name: p.name, dir: '' } : null;
      },
      entities: () => (this.allowed(id, 'project.read') ? (this.editorHost?.entities() ?? []) : []),
      readFile: async (path) => {
        this.need(id, 'project.read', 'read a file of the project');
        return raw().readFile(path);
      },
      writeFile: async (path, text) => {
        this.need(id, 'project.write', 'write a file of the project');
        return raw().writeFile(path, text);
      },
      clipboard: {
        read: async () => {
          this.need(id, 'clipboard', 'read the clipboard');
          return raw().clipboard.read();
        },
        write: async (text) => {
          this.need(id, 'clipboard', 'write to the clipboard');
          return raw().clipboard.write(text);
        },
      },
      runProgram: async (command, args) => {
        this.need(id, 'programs', 'run another program');
        return raw().runProgram(command, args, name());
      },
    };
  }

  private need(id: string, wanted: string, what: string): void {
    if (!this.allowed(id, wanted)) throw new PluginError(`The plugin "${this.known.get(id)?.manifest.name ?? id}" tried to ${what}, but it was not allowed to (it needs the "${wanted}" permission).`);
  }

  // --- turning plugins on and off ---

  /** Turn a plugin on, and the plugins it needs first. Throws a PluginError saying in plain words why it cannot. */
  install(id: string, trail: readonly string[] = []): void {
    if (this.installed.has(id)) return;
    const def = this.known.get(id);
    if (!def) throw new PluginError(`There is no plugin called "${id}".`);
    if (trail.includes(id)) throw new PluginError(`The plugins ${[...trail, id].join(' -> ')} need each other, so none of them can start.`);
    const m = def.manifest;
    if (!worksWithEngine(m)) throw new PluginError(`The plugin "${m.name}" is made for plugin platform version ${m.engine}, and this editor has ${ENGINE_VERSION}.`);
    for (const [dep, range] of Object.entries(m.dependencies)) {
      const d = this.known.get(dep);
      if (!d) throw new PluginError(`The plugin "${m.name}" needs the plugin "${dep}" (${range}), which is not installed.`);
      if (!satisfies(d.manifest.version, range)) throw new PluginError(`The plugin "${m.name}" needs "${dep}" ${range}, and ${d.manifest.version} is installed.`);
      this.install(dep, [...trail, id]);
    }
    const rec: Installed = { def, behaviors: [], conditions: [], actions: [], systems: [], inputs: {}, provided: new Map(), strings: [], added: [], physicsModifiers: [] };
    this.installed.set(id, rec);
    for (const [b, p] of this.offBehaviors) if (p === id) this.offBehaviors.delete(b);
    try {
      def.install(this.apiFor(id, rec));
      if (this.inEditor && def.installEditor) def.installEditor(this.apiFor(id, rec));
    } catch (e) {
      this.uninstall(id);
      const message = e instanceof Error ? e.message : String(e);
      this.fail(id, `installing it`, e);
      throw new PluginError(`The plugin "${m.name}" could not be turned on: ${message}`, { cause: e });
    }
    setExtraInputActions(this.inputActions());
    this.emit({ kind: 'installed', plugin: id });
  }

  /** A plugin added something after it was turned on (its sandboxed editor part says what it offers a moment later): tell the editor to look again. */
  touch(id: string): void {
    if (this.installed.has(id)) this.emit({ kind: 'extended', plugin: id });
  }

  /** Turn a plugin off, and the plugins that need it. Everything it added goes. */
  uninstall(id: string): void {
    const rec = this.installed.get(id);
    if (!rec) return;
    for (const [other, o] of this.installed) if (other !== id && Object.keys(o.def.manifest.dependencies).includes(id)) this.uninstall(other);
    for (const b of rec.behaviors) {
      undefineBehavior(b);
      this.offBehaviors.set(b, id);
    }
    for (const c of rec.conditions) unregisterCondition(c);
    for (const a of rec.actions) unregisterAction(a);
    removePhysicsModifiersOf(id);
    for (const { kind, id: key } of rec.added) {
      (this.ext[kind] as Map<string, unknown>).delete(key);
      if (kind === 'collisionLayers') setGhostLayer(key, null);
      if (kind === 'whoFilters') removeWhoFilter(key);
      if (kind === 'events') removeEventEntry(key);
    }
    for (const t of ['panels', 'tools', 'importers'] as const) for (const [key, v] of this.editor[t]) if (v.plugin === id) this.editor[t].delete(key);
    this.installed.delete(id);
    setExtraInputActions(this.inputActions());
    this.emit({ kind: 'removed', plugin: id });
  }

  /** Give a plugin its editor part (a function the editor installs; it is never part of an exported game). Installs it at once when the plugin is already on. */
  attachEditor(id: string, installEditor: (api: PluginApi) => void): void {
    const def = this.known.get(id);
    if (!def) throw new PluginError(`There is no plugin called "${id}".`);
    def.installEditor = installEditor;
    const rec = this.installed.get(id);
    if (this.inEditor && rec) {
      try {
        installEditor(this.apiFor(id, rec));
      } catch (e) {
        this.fail(id, 'its editor part', e);
      }
    }
  }

  /** What a plugin that is on offered by name (the editor and the game host take the screens a plugin draws this way). */
  provided<T = unknown>(pluginId: string, name: string): T | undefined {
    return this.installed.get(pluginId)?.provided.get(name) as T | undefined;
  }

  /** The starters every plugin the host knows offers. */
  allTemplates(): X.TemplateDef[] {
    return [...this.known.values()].flatMap((d) => d.templates ?? []);
  }

  /** What the plugins that are on tell the assistant. */
  assistantNotes(): string[] {
    return [...this.ext.assistantNotes.values()].map((n) => n.text);
  }

  /** Every fixed text the plugins that are on show to the player. */
  strings(): string[] {
    return [...new Set([...this.installed.values()].flatMap((r) => r.strings.flatMap((s) => s())))];
  }

  isInstalled(id: string): boolean {
    return this.installed.has(id);
  }

  /** The plugins that are on, in the order they were turned on. */
  active(): string[] {
    return [...this.installed.keys()];
  }

  // --- when a plugin goes wrong ---

  /** A plugin crashed. The failure is kept (the Problems panel shows it, tagged with the plugin's name). Editor parts are turned off at once. */
  fail(id: string, where: string, error: unknown): PluginFailure {
    const name = this.known.get(id)?.manifest.name ?? id;
    const f: PluginFailure = { plugin: id, where, message: `${name}: ${error instanceof Error ? error.message : String(error)}`, at: Date.now() };
    this.failedPlugins.set(id, f);
    this.logSink(id, 'error', f.message);
    this.emit({ kind: 'failed', plugin: id });
    return f;
  }

  failures(): PluginFailure[] {
    return [...this.failedPlugins.values()];
  }

  clearFailure(id: string): void {
    this.failedPlugins.delete(id);
  }

  /** Call something a plugin gave the editor (a panel, a tool). If it throws, the plugin is turned off and the person is told. */
  guarded<A extends unknown[], R>(id: string, where: string, fn: (...args: A) => R, fallback: R): (...args: A) => R {
    return (...args: A): R => {
      try {
        return fn(...args);
      } catch (e) {
        const f = this.fail(id, where, e);
        this.editorHost?.notify('error', `${f.message}. The plugin has been turned off; turn it back on in the Plugins window once it is fixed.`);
        this.uninstall(id);
        return fallback;
      }
    };
  }

  /** The same for a function the game runs (a behaviour, a system, an event block): the error is recorded against the plugin and passed on. */
  private watched<A extends unknown[], R>(id: string, where: string, fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      try {
        return fn(...args);
      } catch (e) {
        this.fail(id, where, e);
        throw e;
      }
    };
  }

  // --- the api a plugin is given ---

  private add<K extends ExtensionKind>(rec: Installed, plugin: string, kind: K, key: string, def: Extensions[K] extends Map<string, infer T> ? Omit<T, 'plugin'> : never): void {
    const table = this.ext[kind] as Map<string, OwnedBy>;
    const old = table.get(key);
    if (old && old.plugin !== plugin) throw new PluginError(`The ${kind} "${key}" is already added by the plugin "${old.plugin}".`);
    table.set(key, { ...(def as object), plugin } as OwnedBy);
    rec.added.push({ kind, id: key });
  }

  private apiFor(id: string, rec: Installed): PluginApi {
    // the api's methods are written as methods, so they reach the host by name
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const host = this;
    const m = rec.def.manifest;
    const api: PluginApi = {
      id,
      packId: id,
      manifest: m,
      inEditor: this.inEditor,
      behavior(def) {
        const updated = { ...def, update: host.watched(id, `the behaviour "${def.name}"`, def.update.bind(def)) } as BehaviorDef<typeof def.defaults>;
        defineBehavior(updated);
        rec.behaviors.push(def.id);
        return updated as typeof def;
      },
      behaviors(...defs) {
        for (const d of defs) api.behavior(d);
      },
      conditions(...defs) {
        for (const d of defs) api.condition(d);
      },
      actions(...defs) {
        for (const d of defs) api.action(d);
      },
      component(def) {
        host.add(rec, id, 'components', def.id, def);
      },
      condition(def) {
        registerCondition({ ...def, test: host.watched(id, `the condition "${def.label}"`, def.test.bind(def)) });
        rec.conditions.push(def.id);
      },
      action(def) {
        registerAction({ ...def, run: host.watched(id, `the action "${def.label}"`, def.run.bind(def)) });
        rec.actions.push(def.id);
      },
      event(def) {
        host.add(rec, id, 'events', def.id, def);
        addEventEntry({ id: def.id, label: def.label, ...(def.text ? { text: def.text } : {}), ...(def.entityLabel ? { entityLabel: def.entityLabel } : {}), ...(def.entityText ? { entityText: def.entityText } : {}) });
      },
      system(name, fn, mode = 'gameplay', stage = 'default') {
        rec.systems.push({ name: `${id}:${name}`, fn: host.watched(id, `the system "${name}"`, fn), mode, stage });
      },
      inputAction(actionId, def) {
        rec.inputs[actionId] = def;
      },
      collisionLayer(def) {
        if (def.bit < 0 || def.bit > 15 || !Number.isInteger(def.bit)) throw new PluginError(`The collision layer "${def.name}" needs a bit from 0 to 15.`);
        for (const [key, l] of host.ext.collisionLayers) if ((l.bit === def.bit || key === def.name) && l.plugin !== id) throw new PluginError(`The collision layer "${def.name}" (bit ${def.bit}) clashes with "${key}" (bit ${l.bit}) of the plugin "${l.plugin}".`);
        host.add(rec, id, 'collisionLayers', def.name, def);
        if (def.ghost) setGhostLayer(def.name, def.bit);
      },
      whoFilter(def) {
        host.add(rec, id, 'whoFilters', def.id, def);
        addWhoFilter(def.id, def.label, host.watched(id, `the group "${def.label}"`, def.match.bind(def)));
      },
      unlockRule(def) {
        host.add(rec, id, 'unlockRules', def.id, def);
      },
      scriptMethod(def) {
        host.add(rec, id, 'scriptMethods', def.id, { ...def, run: host.watched(id, `the script method "${def.id}"`, def.run.bind(def)) });
      },
      physicsModifier(def) {
        addPhysicsModifier({ id: `${id}:${def.id}`, plugin: id, order: def.order ?? 0, apply: host.watched(id, `the physics modifier "${def.id}"`, def.apply.bind(def)) });
        host.add(rec, id, 'physicsModifiers', def.id, def);
        rec.physicsModifiers.push(def.id);
      },
      blockType(def) {
        host.add(rec, id, 'blockTypes', def.id, def);
      },
      widget(def) {
        host.add(rec, id, 'widgets', def.id, def);
      },
      screen(def) {
        host.add(rec, id, 'screens', def.id, def);
      },
      screenRole(def) {
        host.add(rec, id, 'screenRoles', def.id, def);
      },
      panel(def) {
        const mount = host.guarded(id, `the panel "${def.title}"`, def.mount.bind(def), undefined);
        host.editor.panels.set(def.id, { ...def, mount: (el) => mount(el, host.editorHostFor(id)), plugin: id });
      },
      tool(def) {
        const onCell = host.guarded(id, `the tool "${def.label}"`, def.onCell.bind(def), undefined);
        host.editor.tools.set(def.id, { ...def, onCell: (cell, _h, ev) => onCell(cell, host.editorHostFor(id), ev), plugin: id });
      },
      importer(def) {
        const run = def.import.bind(def);
        host.editor.importers.set(def.id, { ...def, import: (name, bytes) => run(name, bytes, host.editorHostFor(id)), plugin: id });
      },
      exporter(def) {
        host.add(rec, id, 'exporters', def.id, def);
      },
      exportTarget(def) {
        host.add(rec, id, 'exportTargets', def.id, def);
      },
      inspector(def) {
        host.add(rec, id, 'inspectors', def.component, def);
      },
      prefab(def) {
        host.add(rec, id, 'prefabs', def.id, def);
      },
      template(def) {
        host.add(rec, id, 'templates', def.id, def);
      },
      validator(def) {
        host.add(rec, id, 'validators', def.id, { ...def, check: host.guarded(id, `the check "${def.id}"`, def.check.bind(def), []) });
      },
      playbotStrategy(def) {
        host.add(rec, id, 'playbotStrategies', def.id, def);
      },
      playbotMove(def) {
        host.add(rec, id, 'playbotMoves', def.id, def);
      },
      bridgeSource(def) {
        host.add(rec, id, 'bridgeSources', def.id, def);
      },
      fileReader(def) {
        host.add(rec, id, 'fileReaders', def.id, def);
      },
      assistantTool(def) {
        host.add(rec, id, 'assistantTools', def.id, def);
      },
      imageProvider(def) {
        host.add(rec, id, 'imageProviders', def.id, def);
      },
      assistantNote(text) {
        host.add(rec, id, 'assistantNotes', `${id}:${rec.added.filter((a) => a.kind === 'assistantNotes').length}`, { id: `${id}:${rec.added.length}`, text });
      },
      provide(name, value) {
        rec.provided.set(name, value);
      },
      strings(list) {
        rec.strings.push(list);
      },
      use<T>(pluginId: string, name: string): T | undefined {
        if (pluginId !== id && !Object.keys(m.dependencies).includes(pluginId)) throw new PluginError(`The plugin "${m.name}" used "${pluginId}" without listing it under dependencies in plugin.json.`);
        return host.installed.get(pluginId)?.provided.get(name) as T | undefined;
      },
      log(kind, text) {
        host.logSink(id, kind, text);
      },
      async fetch(url, init) {
        const target = new URL(url);
        host.need(id, `network:${target.hostname}`, `reach ${target.hostname}`);
        return host.netFetch(url, init);
      },
      adopt(members) {
        for (const b of members.behaviors ?? []) {
          if (!getBehavior(b) && !reshelveBehavior(b)) continue;
          rec.behaviors.push(b);
        }
        for (const c of members.conditions ?? []) {
          const def = shelvedCondition(c);
          if (def) {
            registerCondition(def);
            rec.conditions.push(c);
          }
        }
        for (const a of members.actions ?? []) {
          const def = shelvedAction(a);
          if (def) {
            registerAction(def);
            rec.actions.push(a);
          }
        }
        Object.assign(rec.inputs, members.inputs ?? {});
      },
    };
    return api;
  }

  // --- what plugins added (for the editor's pickers and the plugin manager) ---

  contentsOf(id: string): { behaviors: string[]; conditions: string[]; actions: string[]; inputs: string[]; systems: string[]; extensions: { kind: ExtensionKind | 'panels' | 'tools' | 'importers'; id: string }[] } | null {
    const r = this.installed.get(id);
    if (!r) return null;
    const editorParts = (['panels', 'tools', 'importers'] as const).flatMap((t) => [...this.editor[t]].filter(([, v]) => v.plugin === id).map(([key]) => ({ kind: t, id: key })));
    return { behaviors: [...r.behaviors], conditions: [...r.conditions], actions: [...r.actions], inputs: Object.keys(r.inputs), systems: r.systems.map((s) => s.name), extensions: [...r.added.map((a) => ({ kind: a.kind, id: a.id })), ...editorParts] };
  }

  systems(): { name: string; fn: System; mode: SystemMode; stage: X.SystemStage }[] {
    return [...this.installed.values()].flatMap((r) => r.systems);
  }

  inputActions(): Record<string, InputActionDef> {
    const out: Record<string, InputActionDef> = {};
    for (const r of this.installed.values()) Object.assign(out, r.inputs);
    return out;
  }

  activeInput(): ReturnType<typeof baseInput> {
    return baseInput(this.inputActions());
  }

  ownerOfBehavior(id: string): string | undefined {
    for (const [pid, r] of this.installed) if (r.behaviors.includes(id)) return pid;
    return undefined;
  }

  /** The plugin that owns a behaviour, whether it is on or off (so the checker can say "turn on the Combat plugin"). */
  knownOwnerOfBehavior(id: string): string | undefined {
    return this.ownerOfBehavior(id) ?? this.offBehaviors.get(id);
  }

  installedBehaviorIds(): string[] {
    return behaviorList().map((b) => b.id);
  }

  /** Plugins that need this one (so the manager can say what turning it off also turns off). */
  dependentsOf(id: string): string[] {
    return [...this.installed.entries()].filter(([other, o]) => other !== id && Object.keys(o.def.manifest.dependencies).includes(id)).map(([other]) => other);
  }
}

/** The host. There is one; tests that need a clean one call `host.reset()`. */
export const host = new PluginHost();

export type { Entity, SimContext };
