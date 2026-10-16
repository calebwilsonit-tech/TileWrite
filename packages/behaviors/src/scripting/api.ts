/**
 * The Tilewright scripting API, as TypeScript declarations.
 *
 * This file is shown to the code editor (Monaco) so every function has autocompletion and inline help, and the
 * script runtime implements exactly these shapes. Positions are in grid cells (the middle of a cell is x.5);
 * heights are in levels; time is in seconds.
 */

/** A number, true/false, or text. */
export type ScriptValue = number | boolean | string;

/** One setting shown in the Inspector. Use a plain value for the shorthand: `{ speed: 90 }`. */
export interface ScriptSettingSpec {
  /** The starting value. Its type (number, true/false or text) decides what the Inspector shows. */
  value: ScriptValue;
  /** The name shown beside it. */
  label?: string;
  /** Small help text. */
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Turns the setting into a drop-down. */
  options?: string[];
}

/** An object in the scene, as a script sees it. */
export interface ScriptEntity {
  /** Unique number while the game runs. */
  readonly id: number;
  /** The name you gave it in the editor. */
  name: string;
  /** Tags (like "enemy" or "player"). */
  readonly tags: Set<string>;
  /** Still in the game? (False after `destroy()`.) */
  readonly alive: boolean;
  /** Position in cells. Assigning moves it (use `moveTo` to also settle it on the ground). */
  x: number;
  y: number;
  /** Height above the ground floor, in levels. */
  h: number;
  /** Which way it faces: 0 east, 1 south-east, 2 south, 3 south-west, 4 west, 5 north-west, 6 north, 7 north-east. */
  facing: number;
  /** Is it drawn? */
  visible: boolean;
  /** 0 (invisible) to 1 (solid). */
  alpha: number;
  /** Colour as a number like 0xff0000, for shapes without a drawing. */
  color: number;
  /** This script's settings, as set in the Inspector. */
  readonly settings: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Anything this script wants to remember (it lives as long as the object does). */
  state: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  hasTag(tag: string): boolean;
  /** Read a part of the object by name ("sprite", "collider", "health", ...), or undefined. */
  get<T = any>(component: string): T | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Replace a part of the object. */
  set(component: string, data: unknown): void;
  /** Remove the object from the game. */
  destroy(): void;
  /** Put it somewhere (it settles onto the ground there). */
  moveTo(x: number, y: number, h?: number): void;
  /** Walk towards a point using the game's pathfinding (around walls, pits and objects). Returns true when it has arrived. Call it every update. */
  walkTo(x: number, y: number, speed: number): boolean;
  /** Distance in cells to a point or another object. */
  distanceTo(target: ScriptEntity | { x: number; y: number }): number;
  /** Turn to face a point or another object. */
  lookAt(target: ScriptEntity | { x: number; y: number }): void;
  /** Is its signal input on? (Signals come from wires.) */
  input(name: string): boolean;
  /** Turn one of its signal outputs on or off (wire it to other objects). */
  output(name: string, on: boolean): void;
  /** Is a signal output of this object on? */
  isOutputOn(name: string): boolean;
}

/** The game, as a script sees it. */
export interface ScriptGame {
  /** Seconds since the game started. */
  readonly time: number;
  /** Seconds per update (always 1/60). */
  readonly dt: number;
  /** Number of updates since the game started. */
  readonly tick: number;
  /** The player, or undefined. */
  readonly player: ScriptEntity | undefined;
  /** Flags, counters and text of the game (the same variables event rows use). */
  readonly vars: Record<string, ScriptValue>;
  /** A random number from 0 up to (not including) 1. The same every run, so replays stay identical. */
  random(): number;
  /** A random whole number from `min` to `max` (both included). */
  randomInt(min: number, max: number): number;
  /** The first object matching a reference: "player", "tag:enemy", "name:Keeper", "id:e3". ("picked" means picked, for code made from event rows.) */
  find(ref: string, picked?: ScriptEntity): ScriptEntity | undefined;
  /** Every object matching a reference. */
  findAll(ref: string, picked?: ScriptEntity): ScriptEntity[];
  /** Create a copy of a prefab. Returns undefined (and reports a problem) if there is no such prefab. */
  spawn(prefab: string, x: number, y: number, h?: number): ScriptEntity | undefined;
  /** Show a message on screen. */
  say(text: string): void;
  /** Write to the editor's Console. */
  log(...values: unknown[]): void;
  /** Hurt an object that has Health. Returns true if it took the damage. */
  damage(target: ScriptEntity, amount: number): boolean;
  /** Heal an object that has Health. */
  heal(target: ScriptEntity, amount: number): void;
  /** How many of an item the player carries. */
  itemCount(item: string): number;
  /** Give the player an item (use a negative number to take some). Returns how many were really added. */
  giveItem(item: string, amount?: number): number;
  /** Start a conversation (a dialogue from the Story panel). */
  startDialogue(name: string): boolean;
  /** Play a cutscene (from the Story panel). */
  playCutscene(name: string): boolean;
  /** Go to another scene, appearing at a named object or a point "x,y". */
  travel(scene: string, spawn?: string): void;
  /** Is a spot lit (inside a light, or in a region that is not dark)? */
  isLit(x: number, y: number): boolean;
  /** Can the player's size walk from one point to another, and how? Returns the cells to walk through, or null. */
  findPath(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number }[] | null;
  /** The player's buttons. Names like "interact", "attack", "move_left" (see the Controls screen). */
  readonly input: {
    pressed(action: string): boolean;
    down(action: string): boolean;
    released(action: string): boolean;
  };
  /** Announce something that other scripts and event rows can react to ("Something happens in the game"). */
  emit(type: string, data?: Record<string, unknown>): void;
  /** Things of one type that happened during this update (like "damaged", "died", "pickup"). */
  eventsOf(type: string): Record<string, unknown>[];
  /** Do anything an event row can do ("setVariable", "giveItem", "playCutscene"...), by its id. */
  do(action: string, params?: Record<string, unknown>, picked?: ScriptEntity): void;
  /** Check anything an event row can check ("variable", "near", "hasItem"...), by its id. */
  test(condition: string, params?: Record<string, unknown>, picked?: ScriptEntity): boolean;
}

/** A script: a behaviour you write in code. Export one with `export default defineScript({ ... })`. */
export interface ScriptDef {
  /** Shown in the Add menu. Defaults to the file's name. */
  name?: string;
  /** One sentence about what it does. */
  description?: string;
  /** Settings shown in the Inspector. `{ speed: 90 }` is a number setting called "speed" starting at 90. */
  settings?: Record<string, ScriptValue | ScriptSettingSpec>;
  /** Signals this object can receive over wires. */
  inputs?: string[];
  /** Signals this object can send over wires. */
  outputs?: string[];
  /** When in each update it runs: "control" (default, with movement), "source" (makes signals), "actuator" (reacts to them). */
  phase?: 'control' | 'source' | 'actuator';
  /** Runs once, on the first update after the object appears. */
  start?(me: ScriptEntity, game: ScriptGame): void;
  /** Runs every update (60 times a second). */
  update?(me: ScriptEntity, game: ScriptGame): void;
  /** Runs when something happens in the game (an event type like "damaged"), for events anywhere. */
  onEvent?(type: string, data: Record<string, unknown>, me: ScriptEntity, game: ScriptGame): void;
}
