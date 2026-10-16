export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;

/**
 * Turns variable frame times into a whole number of fixed simulation steps.
 * Caps catch-up so a long stall (tab in background, debugger) cannot cause a spiral of death.
 */
export class FixedTimestep {
  private acc = 0;

  constructor(
    readonly stepMs = 1000 / TICK_HZ,
    readonly maxStepsPerFrame = 5,
  ) {}

  /** Feed elapsed real time; returns how many fixed steps to run now. */
  advance(frameMs: number): number {
    this.acc += Math.max(0, frameMs);
    let steps = 0;
    // small epsilon so float error at an exact boundary cannot lose a step
    while (this.acc >= this.stepMs - 1e-9) {
      this.acc = Math.max(0, this.acc - this.stepMs);
      steps++;
    }
    if (steps > this.maxStepsPerFrame) {
      steps = this.maxStepsPerFrame;
      this.acc = 0; // drop the backlog instead of fast-forwarding forever
    }
    return steps;
  }

  /** 0..1 progress into the next step (for render interpolation). */
  get alpha(): number {
    return this.acc / this.stepMs;
  }

  reset(): void {
    this.acc = 0;
  }
}
