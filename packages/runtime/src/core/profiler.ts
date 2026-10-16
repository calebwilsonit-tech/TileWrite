/**
 * Measures where the time goes: each system, and (inside the behaviour phases) each kind of behaviour.
 * Off by default (reading the clock is not free); the editor's profiler overlay switches it on.
 * Timings never feed back into the simulation, so it stays deterministic.
 */
export interface ProfileStat {
  name: string;
  /** Milliseconds per tick, averaged over the window. */
  avgMs: number;
  /** The slowest single call in the window. */
  maxMs: number;
  /** Calls per tick (objects processed, for behaviours). */
  calls: number;
}

interface Acc {
  total: number;
  max: number;
  calls: number;
}

export class Profiler {
  enabled = false;
  private systems = new Map<string, Acc>();
  private behaviours = new Map<string, Acc>();
  private ticks = 0;
  /** Time of the whole tick, summed over the window. */
  private tickTotal = 0;
  private tickMax = 0;
  private tickStart = 0;

  private static now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  beginTick(): void {
    if (this.enabled) this.tickStart = Profiler.now();
  }

  endTick(): void {
    if (!this.enabled) return;
    const dt = Profiler.now() - this.tickStart;
    this.tickTotal += dt;
    this.tickMax = Math.max(this.tickMax, dt);
    this.ticks++;
  }

  private add(map: Map<string, Acc>, name: string, ms: number): void {
    const a = map.get(name);
    if (a) {
      a.total += ms;
      a.max = Math.max(a.max, ms);
      a.calls++;
    } else map.set(name, { total: ms, max: ms, calls: 1 });
  }

  /** Run `fn` and charge its time to a system. */
  system<T>(name: string, fn: () => T): T {
    if (!this.enabled) return fn();
    const t0 = Profiler.now();
    try {
      return fn();
    } finally {
      this.add(this.systems, name, Profiler.now() - t0);
    }
  }

  /** Run `fn` and charge its time to a kind of behaviour. */
  behaviour<T>(name: string, fn: () => T): T {
    if (!this.enabled) return fn();
    const t0 = Profiler.now();
    try {
      return fn();
    } finally {
      this.add(this.behaviours, name, Profiler.now() - t0);
    }
  }

  private stats(map: Map<string, Acc>): ProfileStat[] {
    const n = Math.max(1, this.ticks);
    return [...map.entries()].map(([name, a]) => ({ name, avgMs: a.total / n, maxMs: a.max, calls: a.calls / n })).sort((a, b) => b.avgMs - a.avgMs);
  }

  snapshot(): { ticks: number; avgTickMs: number; maxTickMs: number; systems: ProfileStat[]; behaviours: ProfileStat[] } {
    return { ticks: this.ticks, avgTickMs: this.ticks ? this.tickTotal / this.ticks : 0, maxTickMs: this.tickMax, systems: this.stats(this.systems), behaviours: this.stats(this.behaviours) };
  }

  /** Start a new measuring window (the overlay does this every second or so). */
  reset(): void {
    this.systems.clear();
    this.behaviours.clear();
    this.ticks = 0;
    this.tickTotal = 0;
    this.tickMax = 0;
  }
}

/** A system threw: says which, and keeps the object it was working on if it knew. */
export class SystemError extends Error {
  constructor(
    readonly system: string,
    readonly original: unknown,
    readonly entityId?: number,
    message?: string,
  ) {
    super(message ?? `The "${system}" step of the game failed: ${original instanceof Error ? original.message : String(original)}`);
    this.name = 'SystemError';
    if (original instanceof Error && original.stack) this.stack = `${this.message}\n--- caused by ---\n${original.stack}`;
  }
}
