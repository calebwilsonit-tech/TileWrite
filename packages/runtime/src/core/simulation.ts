import { Tweens } from '../anim/tween';
import { InputState, type ActionSnapshot } from '../input/input';
import { World } from '../scene/world';
import type { SpriteData } from '../sprites/format';
import type { TileMap } from '../tilemap/tilemap';
import { EventBus } from './events';
import { Rng } from './rng';
import { TICK_DT } from './timestep';

/** Game data systems may read (sprite definitions for animation, later audio and strings). */
export interface Assets {
  sprites: Map<string, SpriteData>;
}

export interface SimContext {
  world: World;
  input: InputState;
  rng: Rng;
  events: EventBus;
  tweens: Tweens;
  assets: Assets;
  /** The terrain, or null for scenes without tiles. */
  map: TileMap | null;
  /** Seconds per tick (always 1/60). */
  dt: number;
  /** Ticks completed before this one. */
  tick: number;
}

export type System = (ctx: SimContext) => void;

/**
 * The deterministic game state and its fixed-step update.
 * Same seed + same input snapshots per tick => same state, always. Systems must not read the clock,
 * Math.random or anything outside `ctx`.
 */
export class Simulation {
  readonly world = new World();
  readonly input = new InputState();
  readonly events = new EventBus();
  readonly tweens = new Tweens();
  readonly assets: Assets = { sprites: new Map() };
  readonly rng: Rng;
  /** Terrain used by physics and AI. Set it before the first step. */
  map: TileMap | null = null;
  tick = 0;
  private readonly systems: { name: string; fn: System }[] = [];

  constructor(seed = 1) {
    this.rng = new Rng(seed);
  }

  addSystem(name: string, fn: System): this {
    this.systems.push({ name, fn });
    return this;
  }

  /** Run one fixed step with the given actions held this tick. */
  step(snapshot: ActionSnapshot = {}): void {
    this.input.update(snapshot);
    this.events.beginTick();
    const ctx: SimContext = {
      world: this.world,
      input: this.input,
      rng: this.rng,
      events: this.events,
      tweens: this.tweens,
      assets: this.assets,
      map: this.map,
      dt: TICK_DT,
      tick: this.tick,
    };
    this.world.beginTick();
    try {
      this.tweens.update(TICK_DT);
      for (const s of this.systems) s.fn(ctx);
    } finally {
      this.world.endTick();
    }
    this.tick++;
  }

  /** 32-bit FNV-1a hash of the full entity state; used by determinism tests and replay checks. */
  stateHash(): number {
    const data = JSON.stringify([
      this.tick,
      this.rng.state,
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
