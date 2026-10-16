export type Easing = (t: number) => number;

const c1 = 1.70158;
const c3 = c1 + 1;

/** Easing curves: each maps 0..1 to 0..1 (some overshoot in between). */
export const EASING = {
  linear: (t) => t,
  quadIn: (t) => t * t,
  quadOut: (t) => 1 - (1 - t) * (1 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  cubicIn: (t) => t * t * t,
  cubicOut: (t) => 1 - (1 - t) ** 3,
  cubicInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  sineInOut: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  backOut: (t) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  bounceOut: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  elasticOut: (t) => (t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1),
} satisfies Record<string, Easing>;

export type EasingName = keyof typeof EASING;

export interface TweenSpec {
  from: number;
  to: number;
  /** Seconds. */
  duration: number;
  ease?: EasingName;
  /** Called every update with the current value. */
  apply: (value: number) => void;
  onDone?: () => void;
  /** Seconds to wait before starting. */
  delay?: number;
}

interface Active extends TweenSpec {
  elapsed: number;
  id: number;
}

/**
 * Time-based interpolation driven by the simulation's fixed step, so tweens replay exactly.
 * Create tweens from behaviours; the simulation calls `update` once per tick.
 */
export class Tweens {
  private active: Active[] = [];
  private nextId = 1;

  /** Start a tween; returns an id you can pass to `cancel`. */
  add(spec: TweenSpec): number {
    const t: Active = { ...spec, elapsed: -(spec.delay ?? 0), id: this.nextId++ };
    this.active.push(t);
    return t.id;
  }

  cancel(id: number): void {
    this.active = this.active.filter((t) => t.id !== id);
  }

  get count(): number {
    return this.active.length;
  }

  clear(): void {
    this.active = [];
  }

  update(dt: number): void {
    const finished: Active[] = [];
    for (const t of [...this.active]) {
      t.elapsed += dt;
      if (t.elapsed < 0) continue;
      const k = t.duration <= 0 ? 1 : Math.min(1, t.elapsed / t.duration);
      const e = EASING[t.ease ?? 'linear'](k);
      t.apply(t.from + (t.to - t.from) * e);
      if (k >= 1) finished.push(t);
    }
    if (finished.length > 0) {
      this.active = this.active.filter((t) => !finished.includes(t));
      for (const t of finished) t.onDone?.();
    }
  }
}
