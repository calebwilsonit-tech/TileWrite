import { Tweens } from '../anim/tween';
import type { LightingModel } from '../lighting/lighting';
import type { EventRow, PrefabData, RegionData, VariableValue, WireData } from '../project/schema';
import { InputState, type ActionSnapshot } from '../input/input';
import { World } from '../scene/world';
import type { SpriteData } from '../sprites/format';
import type { CutsceneData, CutsceneState, ViewState } from '../story/cutscene';
import { newView } from '../story/cutscene';
import type { DialogueData, DialogueState } from '../story/dialogue';
import type { ItemData } from '../story/items';
import { StringTables } from '../story/strings';
import type { SkinData } from '../story/skins';
import type { MinigameData, MinigameState } from '../story/minigames';
import type { WorldMapData } from '../story/worldmap';
import type { TileMap } from '../tilemap/tilemap';
import { EventBus } from './events';
import { Profiler, SystemError } from './profiler';
import { Rng } from './rng';
import { TICK_DT } from './timestep';

/** Game data systems may read (sprite definitions for animation, prefabs, story data). */
export interface Assets {
  sprites: Map<string, SpriteData>;
  /** Prefabs objects can be spawned from while the game runs. */
  prefabs: Map<string, PrefabData>;
  dialogues: Map<string, DialogueData>;
  items: Map<string, ItemData>;
  cutscenes: Map<string, CutsceneData>;
  /** Translations and the language in use (see story/strings.ts). */
  strings: StringTables;
  /** Skins the player can pick from (see story/skins.ts). */
  skins: SkinData[];
  /** Small games inside the game (see story/minigames.ts). */
  minigames: Map<string, MinigameData>;
  /** The world map the player can open (null when the game has none). */
  worldMap: WorldMapData | null;
}

/** A lantern post the player lit or rested at: where death sends them. */
export interface Checkpoint {
  /** Scene file the post is in. */
  scene: string;
  x: number;
  y: number;
  h: number;
  name: string;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

/** Per-scene data that logic reads and writes: wires, the event sheet, variables. All of it is part of the replayable state. */
export interface SceneRuntime {
  wires: WireData[];
  sheet: EventRow[];
  /** Flags, counters, text, and (as `item:<id>`) the inventory. */
  vars: Record<string, VariableValue>;
  /** What each event-sheet row remembered from the last tick (was it true, timers...). */
  rowState: Record<string, { prev: boolean; timer: number }>;
  /** Scene object id (like "e3") to the id of the live entity. */
  ids: Map<string, number>;
  /** The scene's regions (darkness, ...). */
  regions: RegionData[];
  /** Rebuilt every tick by the lighting system: what is lit and what casts shadows. The renderer draws from it. */
  lighting?: LightingModel;
  /** Path of the scene being played ("" when unknown); checkpoints and saves remember it. */
  scene: string;
  /** The conversation on screen, if any. The game is frozen while it is open. */
  dialogue: DialogueState | null;
  /** The minigame on screen, if any. The game is frozen while it is open. */
  minigame: MinigameState | null;
  /** Events to announce at the start of the next tick: the tick that caused them was frozen, so its event sheet never ran. */
  announce: { type: string; data: Record<string, unknown> }[];
  /** The cutscene playing, if any. The player cannot act while it runs. */
  cutscene: CutsceneState | null;
  /** Where to come back to after dying. Survives scene changes and saves. */
  checkpoint: Checkpoint | null;
  /** A request to change scene (a portal, fast travel, a "go to" action); the game host carries it out. */
  travel: { scene: string; spawn: string; x?: number; y?: number } | null;
  /** Camera, fade and shake driven by cutscenes. */
  view: ViewState;
  /** The pause menu (or another host screen) is open: the game is frozen. */
  menuOpen: boolean;
  difficulty: Difficulty;
  /** Scene ids of the objects tagged persistent when the scene loaded (saves track which of them are gone). */
  persistentIds: string[];
  /** Ticks of "hit-stop" the game host should hold the world for after a heavy hit (the host reads it and sets it back to 0; the simulation itself ignores it). */
  hitStop: number;
  /** Pictures and sounds for the host to show (sparks, dust, a sound or music change). Never read by game logic. */
  fx: FxEvent[];
}

/** A cosmetic request from a behaviour or event row. The host (editor, exported game, or nobody in a headless run) shows it. */
export type FxEvent =
  | { kind: 'burst'; preset: string; x: number; y: number; h: number; color?: number; count?: number }
  | { kind: 'sound'; name: string; volume?: number; at?: { x: number; y: number; near: number; far: number } }
  | { kind: 'music'; name: string };

const FX_CAP = 128;

/** Queue a cosmetic effect. A headless run never drains the queue, so it is capped. */
export function emitFx(runtime: SceneRuntime, fx: FxEvent): void {
  runtime.fx.push(fx);
  if (runtime.fx.length > FX_CAP) runtime.fx.splice(0, runtime.fx.length - FX_CAP);
}

/** Hold the world still for `ticks` ticks (never shortens a longer hold). */
export function requestHitStop(runtime: SceneRuntime, ticks: number): void {
  runtime.hitStop = Math.max(runtime.hitStop, Math.min(12, Math.round(ticks)));
}

/** Add a short, fading screen shake (pixels). */
export function addImpact(runtime: SceneRuntime, pixels: number): void {
  runtime.view.impact = Math.min(14, Math.max(runtime.view.impact, pixels));
}

/**
 * How much of the game runs this tick. `freeze`: nothing that moves (a conversation or a menu is open).
 * `scripted`: a cutscene is playing, so the world moves but the player's own controls do not.
 */
export type Modal = 'none' | 'scripted' | 'freeze';

export interface SimContext {
  world: World;
  /** The player's actions (empty while a menu, conversation or cutscene has the controls). */
  input: InputState;
  /** The real buttons, always: menus, dialogue and cutscenes read these. */
  uiInput: InputState;
  rng: Rng;
  events: EventBus;
  tweens: Tweens;
  assets: Assets;
  runtime: SceneRuntime;
  /** The terrain, or null for scenes without tiles. */
  map: TileMap | null;
  modal: Modal;
  /** Seconds per tick (always 1/60). */
  dt: number;
  /** Timing of systems and behaviours (when switched on). */
  profiler?: Profiler;
  /** Ticks completed before this one. */
  tick: number;
}

export type System = (ctx: SimContext) => void;

/**
 * When a system runs: `always`, only while the world is moving (`gameplay`: skipped when frozen), or only while
 * the player is in control (`player`: skipped when frozen or in a cutscene).
 */
export type SystemMode = 'always' | 'gameplay' | 'player';

export function newSceneRuntime(): SceneRuntime {
  return {
    wires: [],
    sheet: [],
    vars: {},
    rowState: {},
    ids: new Map(),
    regions: [],
    scene: '',
    dialogue: null,
    minigame: null,
    announce: [],
    cutscene: null,
    checkpoint: null,
    travel: null,
    view: newView(),
    menuOpen: false,
    difficulty: 'normal',
    persistentIds: [],
    hitStop: 0,
    fx: [],
  };
}

/**
 * The deterministic game state and its fixed-step update.
 * Same seed + same input snapshots per tick => same state, always. Systems must not read the clock,
 * Math.random or anything outside `ctx`.
 */
export class Simulation {
  readonly world = new World();
  readonly input = new InputState();
  readonly uiInput = new InputState();
  readonly events = new EventBus();
  readonly tweens = new Tweens();
  readonly assets: Assets = { sprites: new Map(), prefabs: new Map(), dialogues: new Map(), items: new Map(), cutscenes: new Map(), strings: new StringTables(), skins: [], minigames: new Map(), worldMap: null };
  readonly runtime: SceneRuntime = newSceneRuntime();
  readonly rng: Rng;
  readonly profiler = new Profiler();
  /** Terrain used by physics and AI. Set it before the first step. */
  map: TileMap | null = null;
  tick = 0;
  private readonly systems: { name: string; fn: System; mode: SystemMode }[] = [];
  /** Buttons held down while a menu or conversation had the controls: ignored until they are let go. */
  private readonly suppressed = new Set<string>();

  constructor(seed = 1) {
    this.rng = new Rng(seed);
  }

  addSystem(name: string, fn: System, mode: SystemMode = 'always'): this {
    this.systems.push({ name, fn, mode });
    return this;
  }

  /** Which kind of tick this is, from what is on screen. */
  get modal(): Modal {
    const r = this.runtime;
    if (r.menuOpen || r.dialogue || r.minigame) return 'freeze';
    if (r.cutscene) return 'scripted';
    return 'none';
  }

  /** Run one fixed step with the given actions held this tick. */
  step(snapshot: ActionSnapshot = {}): void {
    const modal = this.modal;
    // (hit-stop is not here: the game host just stops calling `step` for a few frames, so the simulation stays the same everywhere)
    const v = this.runtime.view;
    if (v.impact > 0) v.impact = v.impact < 0.15 ? 0 : v.impact * 0.82;
    // The player's controls: nothing while something else has them, and a button held through the end of that
    // moment (the one that closed a conversation) stays ignored until it is released, so it cannot fire twice.
    let gameplay: ActionSnapshot = {};
    if (modal !== 'none') {
      for (const k of Object.keys(snapshot)) this.suppressed.add(k);
    } else {
      for (const k of [...this.suppressed]) if (!(k in snapshot)) this.suppressed.delete(k);
      gameplay = {};
      for (const [k, v] of Object.entries(snapshot)) if (!this.suppressed.has(k)) gameplay[k] = v;
    }
    this.input.update(gameplay);
    this.uiInput.update(snapshot);
    this.events.beginTick();
    const ctx: SimContext = {
      world: this.world,
      input: this.input,
      uiInput: this.uiInput,
      rng: this.rng,
      events: this.events,
      tweens: this.tweens,
      assets: this.assets,
      runtime: this.runtime,
      map: this.map,
      modal,
      dt: TICK_DT,
      tick: this.tick,
      profiler: this.profiler,
    };
    this.world.beginTick();
    this.profiler.beginTick();
    try {
      if (modal !== 'freeze') this.tweens.update(TICK_DT);
      for (const s of this.systems) {
        if (s.mode === 'gameplay' && modal === 'freeze') continue;
        if (s.mode === 'player' && modal !== 'none') continue;
        try {
          this.profiler.system(s.name, () => s.fn(ctx));
        } catch (e) {
          throw e instanceof SystemError ? e : new SystemError(s.name, e);
        }
      }
    } finally {
      this.profiler.endTick();
      this.world.endTick();
    }
    this.tick++;
  }

  /** 32-bit FNV-1a hash of the full entity state; used by determinism tests and replay checks. */
  stateHash(): number {
    const r = this.runtime;
    const data = JSON.stringify([
      this.tick,
      this.rng.state,
      r.vars,
      r.rowState,
      r.dialogue,
      r.minigame,
      r.cutscene,
      r.checkpoint,
      this.world.all().map((e) => [e.id, e.name, [...e.tags].sort(), [...e.components.entries()]]),
    ]);
    let h = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      h ^= data.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }
}
