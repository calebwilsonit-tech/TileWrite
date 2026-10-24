import type { EntityData, ProjectData, SceneData, SimContext, UiScreen, UiNode, System, SystemMode, Entity } from '@tilewright/runtime';
import type { BehaviorDef } from '../framework';
import type { ActionDef, ConditionDef } from '../events/sheet';

/**
 * The shapes of everything a plugin can add. One definition each, in one place, so the plugin SDK, the host that keeps them
 * and the parts of the editor, the game and the assistant that read them agree.
 */

// ---------- the game (runtime parts) ----------

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
  label: string;
  /** What the event carries, as a short note for the picker. */
  carries?: string;
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

// ---------- the interface framework ----------

/** A new kind of widget for the UI designer. The game draws it with `render`, the designer shows it in the palette. */
export interface WidgetDef {
  id: string;
  label: string;
  /** Starting values of a new one (size, text, anything a UiNode has). */
  defaults?: Partial<UiNode>;
  /** Fill in the element for this widget on every frame; return a function to clean up. Plain DOM. */
  render(el: HTMLElement, node: UiNode, values: Record<string, string | number | boolean>): void | (() => void);
}

/** A screen a plugin brings with it (a title, a pause menu, a settings page). The project can Customize it into its own copy. */
export interface ScreenDef {
  /** Stable id inside the plugin. A project copy remembers it, to offer updates. */
  id: string;
  /** The screen itself (widgets, bindings, actions). */
  screen: UiScreen;
  /** The role it plays unless the project says otherwise ("title", "pause", "settings", ...). */
  role?: string;
  /** Bump this when the screen changes, so projects that customized an older one can compare. */
  revision: number;
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

/** Looks at a scene and says what is wrong with it. Runs with the editor's Problems panel and before export. */
export interface ValidatorDef {
  id: string;
  check(scene: SceneData): ProblemDef[];
}

export interface PlaybotStrategyDef {
  id: string;
  label: string;
  /** The words the Playbot panel shows next to the button. */
  help?: string;
  /** Plays toward a goal; returns a report sentence. `game` is the playbot's game, `bot` its bot. */
  play(game: unknown, bot: unknown): string;
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
  /** What the change would do, in a sentence, before it is approved. */
  preview?(input: Record<string, unknown>): string;
  run(input: Record<string, unknown>): Promise<string> | string;
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
  scriptMethods: Map<string, ScriptMethodDef & OwnedBy>;
  blockTypes: Map<string, BlockTypeDef & OwnedBy>;
  widgets: Map<string, WidgetDef & OwnedBy>;
  screens: Map<string, ScreenDef & OwnedBy>;
  screenRoles: Map<string, ScreenRoleDef & OwnedBy>;
  inspectors: Map<string, InspectorDef & OwnedBy>;
  exporters: Map<string, ExporterDef & OwnedBy>;
  exportTargets: Map<string, ExportTargetDef & OwnedBy>;
  prefabs: Map<string, PrefabDef & OwnedBy>;
  templates: Map<string, TemplateDef & OwnedBy>;
  validators: Map<string, ValidatorDef & OwnedBy>;
  playbotStrategies: Map<string, PlaybotStrategyDef & OwnedBy>;
  fileReaders: Map<string, FileReaderDef & OwnedBy>;
  assistantTools: Map<string, AssistantToolDef & OwnedBy>;
  imageProviders: Map<string, ImageProviderDef & OwnedBy>;
}

export type ExtensionKind = keyof Extensions;

export type { BehaviorDef, ActionDef, ConditionDef, System, SystemMode };
