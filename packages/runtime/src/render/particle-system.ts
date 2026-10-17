import { Rng } from '../core/rng';
import { gridToScreen, type IsoConfig } from '../iso/math';

/** One speck: position and speed are in screen pixels (at zoom 1), time in seconds. */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: number;
  /** Pixels per second squared, downwards. */
  gravity: number;
  /** Fraction of speed kept after one second. */
  drag: number;
}

interface Preset {
  label: string;
  count: number;
  speed: [number, number];
  life: [number, number];
  size: [number, number];
  gravity: number;
  drag: number;
  colors: number[];
  /** Directions in radians (screen space, 0 = right, -PI/2 = up); null = all around. */
  cone: [number, number] | null;
}

/** The effects an event row or behaviour can ask for by name. */
export const PARTICLE_PRESETS: Record<string, Preset> = {
  hit: { label: 'Hit sparks', count: 9, speed: [60, 170], life: [0.15, 0.32], size: [2, 3.5], gravity: 240, drag: 0.15, colors: [0xffffff, 0xffe28a, 0xffb347], cone: null },
  spark: { label: 'Sparks', count: 14, speed: [50, 200], life: [0.25, 0.6], size: [1.5, 3], gravity: 320, drag: 0.3, colors: [0xffd166, 0xff9f43, 0xff6b35], cone: null },
  dust: { label: 'Dust', count: 7, speed: [10, 45], life: [0.35, 0.7], size: [3, 6], gravity: -10, drag: 0.2, colors: [0xb8a98f, 0x9c8f7a, 0xcfc3ad], cone: [-Math.PI * 0.95, -Math.PI * 0.05] },
  puff: { label: 'Puff of smoke', count: 12, speed: [15, 70], life: [0.4, 0.9], size: [4, 8], gravity: -40, drag: 0.25, colors: [0xe9e4dc, 0xc8c3bb, 0xa9a6a1], cone: null },
  heal: { label: 'Healing glow', count: 10, speed: [15, 55], life: [0.5, 1], size: [2, 4], gravity: -80, drag: 0.4, colors: [0x7bed9f, 0xb8f5cf, 0xffffff], cone: [-Math.PI * 0.8, -Math.PI * 0.2] },
  magic: { label: 'Magic', count: 16, speed: [20, 90], life: [0.5, 1.1], size: [2, 4], gravity: -30, drag: 0.35, colors: [0x9b8cff, 0x6c63ff, 0xd0c8ff, 0x7ee0ff], cone: null },
  confetti: { label: 'Confetti', count: 28, speed: [80, 220], life: [0.8, 1.6], size: [3, 5], gravity: 260, drag: 0.35, colors: [0xff6b6b, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xc77dff], cone: [-Math.PI * 0.9, -Math.PI * 0.1] },
};

export const PARTICLE_PRESET_IDS = Object.keys(PARTICLE_PRESETS);
const MAX_PARTICLES = 600;

/**
 * The particles themselves: spawning and movement, with no drawing, so it can be tested without a GPU.
 * It uses its own random numbers, so showing sparks never changes the game's replayable state.
 */
export class ParticleSystem {
  readonly particles: Particle[] = [];
  private readonly rng = new Rng(7);

  constructor(private readonly iso: IsoConfig) {}

  /** Throw a burst at a grid position (and height). Unknown preset names make a few plain sparks. */
  burst(preset: string, x: number, y: number, h: number, color?: number, count?: number): void {
    const p = PARTICLE_PRESETS[preset] ?? PARTICLE_PRESETS.hit!;
    const at = gridToScreen(x, y, h + 0.5, this.iso);
    const n = Math.max(1, Math.min(80, Math.round(count ?? p.count)));
    for (let i = 0; i < n; i++) {
      const angle = p.cone ? this.rng.range(p.cone[0], p.cone[1]) : this.rng.range(0, Math.PI * 2);
      const speed = this.rng.range(p.speed[0], p.speed[1]);
      this.particles.push({
        x: at.x,
        y: at.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * (p.cone ? 1 : 0.6), // the world is squashed: sideways sparks fly further than up and down
        age: 0,
        life: this.rng.range(p.life[0], p.life[1]),
        size: this.rng.range(p.size[0], p.size[1]),
        color: color ?? this.rng.pick(p.colors),
        gravity: p.gravity,
        drag: p.drag,
      });
    }
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i]!;
      q.age += dt;
      if (q.age >= q.life) {
        this.particles.splice(i, 1);
        continue;
      }
      const keep = Math.pow(q.drag, dt);
      q.vx *= keep;
      q.vy = q.vy * keep + q.gravity * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
  }

  clear(): void {
    this.particles.length = 0;
  }
}


