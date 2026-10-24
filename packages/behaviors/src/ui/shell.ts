import type { GameSettings, InputMapDef, SlotInfo, Simulation, UiLayout } from '@tilewright/runtime';

/** A place the player can be sent back to or travel to: where they rested, with the scene it is in. */
export interface CheckpointRef {
  scene: string;
  id: string;
  name: string;
  x: number;
  y: number;
  h: number;
}

/** What the game's screens need from whoever is running the game (the editor's Play, or an exported game). */
export interface GameUiHost {
  sim: Simulation;
  settings: GameSettings;
  bindings(): InputMapDef;
  /** Names of the actions for the Controls screen (the game's own actions included); default: the built-in ones. */
  actionLabels?(): Record<string, string>;
  changeSettings(patch: Partial<GameSettings>): void;
  rebind(action: string, binding: string): void;
  resetBindings(): void;
  /** Resolves with the next key or button the player presses (null on timeout). */
  captureNext(): Promise<string | null>;
  /** Start the current scene again from the beginning. */
  restart(): void;
  saveTo(slot: string): Promise<string>;
  loadFrom(slot: string): Promise<string>;
  slots(): Promise<SlotInfo[]>;
  travelTo(post: CheckpointRef): void;
  /** Go to a scene (and a spawn point in it: an object's name or "x,y"; '' = its player start). */
  travelToScene(scene: string, spawn: string): void;
  quit?(): void;
  /** Full screen on and off; only a game running in its own window can offer it. */
  fullscreen?: { get(): boolean; set(on: boolean): void };
  /** A sprite's first picture as an image address, for image widgets. */
  spriteUrl?(name: string): string | null;
  /** Does the pause button open Pause by itself? False when the project has its own rule for it. Default: yes. */
  pauseKeyOpensPause?(): boolean;
}

/** What the game's name and the line under it say on the title screen. */
export interface TitleInfo {
  text: string;
  subtitle: string;
}

/** The screens and heads-up display of a running game, as the host drives them. */
export interface GameUiLike {
  /** True while a menu is open (the game does not read the mouse for the world then). */
  readonly menuOpen: boolean;
  setLayout(layout: UiLayout): void;
  openStart(): void;
  openTitle(info: TitleInfo): void;
  /** Read the save slots again (the list of saves in a screen). */
  refreshSaves?(): void;
  /** A line of text that fades by itself. */
  toast?(text: string): void;
  /** Once per game tick. */
  tick(): void;
  /** Once per frame. */
  update(): void;
  dispose(): void;
}

/** Makes the screens for a game; a plugin provides it under the name "gameUi". */
export type GameUiFactory = (parent: HTMLElement, host: GameUiHost) => GameUiLike;

/** What a host shows when no plugin draws screens: nothing. */
export const noScreens: GameUiFactory = () => ({
  menuOpen: false,
  setLayout: () => undefined,
  openStart: () => undefined,
  openTitle: () => undefined,
  tick: () => undefined,
  update: () => undefined,
  dispose: () => undefined,
});
