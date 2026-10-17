import { Container, Graphics } from 'pixi.js';
import type { IsoConfig } from '../iso/math';
import { ParticleSystem } from './particle-system';

/** Draws a ParticleSystem into the world (one Graphics, redrawn each frame). */
export class ParticleLayer {
  readonly container = new Container();
  private readonly g = new Graphics();
  readonly system: ParticleSystem;
  /** Turned off by the reduce-motion setting. */
  enabled = true;

  constructor(iso: IsoConfig) {
    this.system = new ParticleSystem(iso);
    this.container.addChild(this.g);
    this.container.zIndex = 5e8;
  }

  burst(preset: string, x: number, y: number, h: number, color?: number, count?: number): void {
    if (this.enabled) this.system.burst(preset, x, y, h, color, count);
  }

  /** Advance by real frame time and redraw. */
  frame(dt: number): void {
    this.system.update(dt);
    const g = this.g;
    g.clear();
    for (const q of this.system.particles) {
      const a = 1 - q.age / q.life;
      const s = Math.max(1, q.size * (0.5 + 0.5 * a));
      g.rect(Math.round(q.x - s / 2), Math.round(q.y - s / 2), s, s).fill({ color: q.color, alpha: Math.min(1, a * 1.6) });
    }
  }
}

