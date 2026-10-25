import type { Container, Renderer } from 'pixi.js';
import type { IsoConfig } from '../iso/math';

/**
 * A layer drawn over the finished world picture (darkness and light, weather, a colour grade...). The renderer knows nothing about
 * what a layer shows: it hands each one the frame (the renderer, where the world sits on screen) and the data the game
 * keeps for it, and the layer draws or hides itself. Plugins add them (`api.screenLayer`).
 */
export interface ScreenLayerFrame {
  renderer: Renderer;
  iso: IsoConfig;
  /** Where the world sits on screen: the position of the world container and its zoom. */
  view: { x: number; y: number; zoom: number };
  width: number;
  height: number;
  /** What the game keeps for this layer this tick (`runtime.plugin[id]`); it may be anything the plugin put there. */
  data: unknown;
}

export interface ScreenLayer {
  /** What it puts on the stage, bottom first. */
  objects: Container[];
  update(frame: ScreenLayerFrame): void;
  /** Nothing to draw this frame (the game keeps no data for it). */
  hide(): void;
  /** A few words about what it drew, for the profiler line ("3 lights"). */
  stat?(): string;
  destroy?(): void;
}

export interface ScreenLayerFactory {
  id: string;
  create(): ScreenLayer;
}
