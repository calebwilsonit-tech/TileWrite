import type { Simulation, UiLayout, EventRow, MapNode, RegionData, TileMap, VariableValue, WireData, EntityData, ProjectData, SceneData, SimContext, UiScreen, UiNode, System, SystemMode, Entity } from '@tilewright/runtime';
import type { BehaviorDef } from '../framework';
import type { ActionDef, ConditionDef } from '../events/sheet';

/**
 * The shapes of everything a plugin can add. One definition each, in one place, so the plugin SDK, the host that keeps them
 * and the parts of the editor, the game and the assistant that read them agree.
 */

// ---------- the game (runtime parts) ----------

/** Where in a tick a plugin's system runs: before everything ('first'), right after the player moves ('after-player'), after the behaviours have run ('after-behaviors'), or with the other plugins' systems ('default'). */
export type SystemStage = 'first' | 'after-player' | 'after-behaviors' | 'default';

export interface InputActionDef {
  label: string;
  bindings: string[];
}

/** A data component with a name and defaults, for plugins that keep their own state on objects. */
export interface ComponentDef {
  id: string;
  name: string;
  description?: string;
  defaults: Record<string, unknown>;
}

/** An event a plugin announces, so Quick Actions and scripts can list it ("a wave is beaten"). */
export interface EventDef {
  id: string;
  /** In the "something happens in the game" picker: "something is hurt". */
  label: string;
  /** How a row reads, when it differs from the label. */
  text?: string;
  /** In the "something happens to an object" picker: "is hurt". Left out when the event is not about one object. */
  entityLabel?: string;
  /** How a row about one object reads, when it differs from the entity label. */
  entityText?: string;
  /** What the event carries, as a short note for the picker. */
  carries?: string;
  /** The game saves by itself when this happens (a checkpoint was reached). */
  autosave?: boolean;
}

/** Something that changes how every body moves, before the step (wind, ice, a conveyor belt, a tide). */
export interface PhysicsModifierDef {
  id: string;
  /** Lower runs first. */
  order?: number;
  /** Called for every body each tick. Change `body.vx`, `body.vy` or `body.vz` (the velocities), or leave it alone. */
  apply(ctx: SimContext, entity: Entity, body: Record<string, unknown>): void;
}

/** A layer for collisions (what bodies and colliders belong to, and which they meet). */
export interface CollisionLayerDef {
  name: string;
  /** Which bit of the layer number it is (0 to 15). Saved files keep the number, so a layer keeps its bit forever. */
  bit: number;
  label?: string;
  /** True for layers of ghosts (recorded copies, spirits): a gate set to let ghosts pass lets these through. */
  ghost?: boolean;
}

/** A group of objects that plates and zones can react to ("crates", "helpers"). */
export interface WhoFilterDef {
  id: string;
  label: string;
  match(entity: Entity): boolean;
}

/** A method scripts can call on an object or on the game (me.damage, game.startDialogue...), implemented by a plugin. */
export interface ScriptMethodDef {
  /** The name scripts call. */
  id: string;
  /** Runs with the game's context and the object the script is on; returns whatever the method returns. */
  run(ctx: SimContext, self: Entity, args: unknown[]): unknown;
  /** What a script gets when the plugin is off. */
  fallback?: unknown;
}

/** A tile that is a kind of block with its own rules (ice, a trampoline, a conveyor). */
export interface BlockTypeDef {
  id: string;
  name: string;
  /** Colours of the top and the two sides (0xRRGGBB). */
  top: number;
  left: number;
  right: number;
  solid?: boolean;
  /** What the game's rules read: any facts ("friction": 0.1). */
  custom?: Record<string, string | number | boolean>;
  tags?: string[];
}

/** A way a place on the world map can unlock, brought by a plugin ("a checkpoint is lit there"). */
export interface UnlockRuleDef {
  /** The name saved in the map file. */
  id: string;
  /** In the map editor's list of ways to unlock a place. */
  label: string;
  /** Is the place unlocked? */
  met(vars: Record<string, VariableValue>, node: MapNode): boolean;
  /** Where the player appears when they travel to the place by this rule (a place in a scene), when it is not the scene's start. */
  arrival?(vars: Record<string, VariableValue>, node: MapNode): { id: string; scene: string; x: number; y: number; h: number; name: string } | null;
}

// ---------- the interface framework ----------

/** A new kind of widget for the UI designer. The game draws it with `render`, the designer shows it in the palette. */
export interface WidgetDef {
  id: string;
  label: string;
  /** Starting values of a new one (size, text, anything a UiNode has). */
  defaults?: Partial<UiNode>;
  /** Style rules for the elements `render` makes. Added once to the page while the widget is in use. */
  css?: string;
  /**
   * Fill in the element for this widget on every frame; return a function to clean up. Plain DOM. `ctx` is what the game
   * lets a widget see (the running game) and ask for (`request` announces an event, like a button's action would).
   */
  render(el: HTMLElement, node: UiNode, values: Record<string, string | number | boolean>, ctx?: WidgetContext): void | (() => void);
}

export interface WidgetContext {
  sim: Simulation;
  /** Ask the game for something: "travel-place-request", "save-request"... (the events the screens' actions announce). */
  request(event: string, data?: Record<string, unknown>): void;
}

/** A screen a plugin brings with it (a title, a pause menu, a settings page). The project can Customize it into its own copy. */
export interface ScreenDef {
  /** Stable id inside the plugin. A project copy remembers it, to offer updates. */
  id: string;
  /** The screen itself (widgets, bindings, actions). */
  screen: UiScreen;
  /**
   * For a screen that depends on the project (the heads-up display follows the project's interface layout): the screen to use
   * for this project. When it is there, it is used instead of `screen`; `screen` is what the plugin offers for a new copy.
   */
  build?(project: { layout: UiLayout | null }): UiScreen;
  /** The role it plays unless the project says otherwise ("title", "pause", "settings", ...). */
  role?: string;
  /** Bump this when the screen changes, so projects that customized an older one can compare. */
  revision: number;
  /** When several plugins offer a screen for the same role, the one with the highest number plays it (default 0): a plugin that re-skins the game's screens gives its own a higher one. */
  priority?: number;
}

/**
 * Where the rows of a list, grid or hand in a screen can come from, besides the engine's own sources (a table, the carried items,
 * the save slots...). A screen names it as `source: "name"` or `"name:argument"`; every row says what `{row.x}` means inside it.
 */
export interface ListSourceDef {
  /** The name a screen writes in `source`. */
  id: string;
  label: string;
  /** The rows now. `id` is unique among them; `scope` is what the row's widgets can read (`{place.name}`...). */
  rows(sim: Simulation, argument: string): { id: string; scope: Record<string, VariableValue> }[];
  /** What each name in a row's scope is, in plain words, for the designer's picker (`{"pet.name": "The pet's name"}`). */
  fields?: Record<string, string>;
}

/**
 * An entry a plugin adds to a menu another plugin's screen lists: the Pause menu has a list called "menu:pause", and an entry
 * with `menu: 'pause'` becomes a row in it that opens a screen. (The screen decides how the rows look.)
 */
export interface MenuEntryDef {
  id: string;
  /** Which list: "pause" for the Pause menu. */
  menu: string;
  label: string;
  /** Opens the screen that plays this role ("map", "travel"...). */
  opens: string;
  /** Second text on the right of the row ("3 lit"). */
  detail?(sim: Simulation): string;
  /** Only while this is true. Default: always. */
  show?(sim: Simulation): boolean;
  /** Smaller numbers come first. Default 50. */
  order?: number;
}

/** What a screen can be used as ("Title", "Pause", ...), so Back, the pause key and Continue know which one to open. */
export interface ScreenRoleDef {
  id: string;
  label: string;
  help?: string;
}

// ---------- the editor ----------

export interface InspectorDef {
  /** The component (or behaviour) it draws the settings of. */
  component: string;
  /** Draw into `el`; call `change(next)` when the person edits. Plain DOM. */
  render(el: HTMLElement, value: Record<string, unknown>, change: (next: Record<string, unknown>) => void): void | (() => void);
}

export interface ExporterDef {
  id: string;
  label: string;
  /** The file extension it makes, with the dot. */
  extension: string;
  /** Turn a file of the project into the other format. */
  export(name: string, text: string): Promise<Uint8Array | string> | Uint8Array | string;
  /** The project file type it takes ('.tilestudio', '.scene.json'...). */
  from: string;
}

export interface ExportTargetDef {
  id: string;
  label: string;
  /** Where it works: the platform names the exporter knows ('win32', 'linux'). */
  platforms?: string[];
  /** Check the project and say what is missing, in plain words; empty means ready. */
  check?(project: ProjectData): string[];
  /** Describe what it will make (shown in the Export dialog). */
  describe(): string;
  /** Runs after the game has been exported: pack it further, send it somewhere. Say what it did, in a line. */
  finish?(result: { folder: string; exe: string; zip: string | null; name: string }, host: import('./host').EditorHost): Promise<string> | string;
}

export interface PrefabDef {
  id: string;
  label: string;
  hint: string;
  group: string;
  make(x: number, y: number, h: number): Omit<EntityData, 'id'>;
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  build(projectName: string): { project: ProjectData; scene: SceneData; files?: Record<string, string> };
  /** Other plugins the template needs on (their ids). */
  plugins?: string[];
}

export interface ProblemDef {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  entity?: string;
  x?: number;
  y?: number;
}

/** What a check can look at: the open scene's objects, its map, regions, wires and event rows. */
export interface ValidationScene {
  entities: readonly EntityData[];
  map: TileMap;
  regions: readonly RegionData[];
  wires: readonly WireData[];
  events: readonly EventRow[];
  getEntity(id: string): EntityData | undefined;
}

/** Looks at a scene and says what is wrong with it. Runs with the editor's Problems panel and before export. */
export interface ValidatorDef {
  id: string;
  check(scene: ValidationScene): ProblemDef[];
}

/** What a playbot strategy or move can see of the open scene. */
export interface PlaybotScene {
  entities: readonly EntityData[];
}

/** What the playbot reports when it has tried something. */
export interface PlaybotReportLike {
  ok: boolean;
  message: string;
}

/** Something the Playbot panel can try: a button that plays the open scene a certain way ("Fight the guard", "Hold the plates"). */
export interface PlaybotStrategyDef {
  id: string;
  label: string;
  /** The words shown beside the button. */
  help?: string;
  /** Why it cannot be tried in this scene (said to the person), or null when it can. */
  unavailable?(scene: PlaybotScene): string | null;
  /** Play with the playbot's buttons. \`bot\` is the playbot's Bot (see the SDK's definePlaybotStrategy for it typed). */
  play(bot: unknown, scene: PlaybotScene): PlaybotReportLike;
}

/**
 * One kind of step the puzzle solver can combine with the others ("record a copy of yourself onto a plate"). The solver
 * asks every move what it can do with each object of the scene, tries plans of these steps and keeps the first that works.
 */
export interface PlaybotMoveDef {
  id: string;
  /** Steps this move can take with \`entity\` (the player is \`player\`), by reference and in words. */
  offer(entity: EntityData, player: EntityData | undefined): { ref: string; label: string }[];
  /** Carry out one step with the player's buttons; \`memory\` is shared by the steps of one try. Returns whether it worked. */
  perform(bot: unknown, game: unknown, ref: string, memory: Record<string, unknown>): boolean;
}

/** Cells that can be walked over a pit or water because of something a plugin brings (a bridge made of a block of text). */
export interface BridgeSourceDef {
  id: string;
  /** Cells that could become a bridge, for the checks that ask whether the way can be opened at all. */
  possible(entities: readonly { id: string; components: Record<string, unknown> }[], wires: readonly { to: { entity: string; input: string } }[]): Set<string>;
  /** Cells that are a bridge right now in a running game. */
  live?(world: { query(...keys: string[]): Iterable<Entity> }): Set<string>;
  /** Objects that are not fixed scenery for the checks, because the puzzle changes them. */
  movable?(entity: { components: Record<string, unknown> }): boolean;
}

// ---------- the assistant ----------

export interface FileReaderDef {
  id: string;
  label: string;
  /** Lower-case extensions with the dot. */
  extensions: string[];
  /** Turn the file into something Claude can read: text, and pictures (PNG bytes) when it has them. */
  read(name: string, bytes: Uint8Array): Promise<{ text: string; images?: { name: string; png: Uint8Array }[] }> | { text: string; images?: { name: string; png: Uint8Array }[] };
}

export interface AssistantToolDef {
  id: string;
  /** What Claude is told it does. */
  description: string;
  /** A JSON-schema-like description of the inputs (object with properties). */
  input: Record<string, unknown>;
  /** `read` runs at once; `change` is shown to the person as a card to approve, like every other change. */
  kind: 'read' | 'change';
  /** What the change would do, in a line, before it is approved. */
  preview?(input: Record<string, unknown>): string;
  run(input: Record<string, unknown>): Promise<string> | string;
}

/** A line the assistant is told about what a plugin adds. */
export interface AssistantNoteDef {
  id: string;
  text: string;
}

export interface ImageProviderDef {
  id: string;
  label: string;
  /** Needs the person's own key for this service (stored by the editor, never in the project). */
  needsKey: boolean;
  /** Make a picture from words (and optionally a picture to start from); PNG bytes back. */
  generate(request: { prompt: string; width: number; height: number; reference?: Uint8Array; key?: string }): Promise<Uint8Array>;
}

// ---------- what the host keeps ----------

export interface OwnedBy {
  /** The plugin that added it. */
  plugin: string;
}

export interface Extensions {
  components: Map<string, ComponentDef & OwnedBy>;
  events: Map<string, EventDef & OwnedBy>;
  physicsModifiers: Map<string, PhysicsModifierDef & OwnedBy>;
  collisionLayers: Map<string, CollisionLayerDef & OwnedBy>;
  whoFilters: Map<string, WhoFilterDef & OwnedBy>;
  unlockRules: Map<string, UnlockRuleDef & OwnedBy>;
  scriptMethods: Map<string, ScriptMethodDef & OwnedBy>;
  blockTypes: Map<string, BlockTypeDef & OwnedBy>;
  widgets: Map<string, WidgetDef & OwnedBy>;
  screens: Map<string, ScreenDef & OwnedBy>;
  screenRoles: Map<string, ScreenRoleDef & OwnedBy>;
  listSources: Map<string, ListSourceDef & OwnedBy>;
  menuEntries: Map<string, MenuEntryDef & OwnedBy>;
  inspectors: Map<string, InspectorDef & OwnedBy>;
  exporters: Map<string, ExporterDef & OwnedBy>;
  exportTargets: Map<string, ExportTargetDef & OwnedBy>;
  prefabs: Map<string, PrefabDef & OwnedBy>;
  templates: Map<string, TemplateDef & OwnedBy>;
  validators: Map<string, ValidatorDef & OwnedBy>;
  playbotStrategies: Map<string, PlaybotStrategyDef & OwnedBy>;
  playbotMoves: Map<string, PlaybotMoveDef & OwnedBy>;
  bridgeSources: Map<string, BridgeSourceDef & OwnedBy>;
  fileReaders: Map<string, FileReaderDef & OwnedBy>;
  assistantTools: Map<string, AssistantToolDef & OwnedBy>;
  imageProviders: Map<string, ImageProviderDef & OwnedBy>;
  assistantNotes: Map<string, AssistantNoteDef & OwnedBy>;
}

export type ExtensionKind = keyof Extensions;

export type { BehaviorDef, ActionDef, ConditionDef, System, SystemMode };
