import { FixedTimestep, TICK_DT } from './core/timestep';
import type { Simulation } from './core/simulation';
import { gridToScreen } from './iso/math';
import { InputMap, InputRecorder, type ActionSnapshot, type RawInput } from './input/input';
import { IsoRenderer } from './render/iso-renderer';
import { C, type TransformIso } from './scene/components';
import type { EntityId } from './scene/world';

export interface RunnerOptions {
  sim: Simulation;
  renderer: IsoRenderer;
  inputMap: InputMap;
  /** Returns current raw device state (see DomInputSource). */
  readInput: () => RawInput;
  /** Entity the camera follows, if any. */
  follow?: EntityId;
  /** Called after every simulation step. */
  onTick?: (sim: Simulation) => void;
  /**
   * Called if a system throws. The runner pauses itself first, so a bug never kills the page
   * or spams errors every frame; the editor shows the message in the Problems panel.
   */
  onError?: (error: unknown, sim: Simulation) => void;
}

/**
 * Browser loop: real time -> fixed steps -> render. The simulation never sees wall-clock time.
 * Pause and single-step are used by the editor's Play / Pause / Step buttons.
 */
export class GameRunner {
  readonly timestep = new FixedTimestep();
  paused = false;
  recorder: InputRecorder | null = null;
  /** Set when a system threw; cleared by `resume()`. */
  failed: unknown = null;
  private raf = 0;
  private last = 0;
  private running = false;
  /** Snapshot supplier; swap it to feed recorded input (echoes, playbot). */
  inputSource: () => ActionSnapshot;

  constructor(private readonly o: RunnerOptions) {
    this.inputSource = () => o.inputMap.resolve(o.readInput());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number): void => {
      if (!this.running) return;
      const elapsed = now - this.last;
      this.last = now;
      if (!this.paused) {
        const steps = this.timestep.advance(elapsed);
        for (let i = 0; i < steps && !this.paused; i++) this.stepOnce();
      }
      this.draw();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Advance exactly one tick (works while paused). */
  step(): void {
    this.stepOnce();
    this.draw();
  }

  /** Continue after an error (the game state is whatever it was when the error happened). */
  resume(): void {
    this.failed = null;
    this.paused = false;
  }

  private stepOnce(): void {
    try {
      const snap = this.inputSource();
      this.recorder?.record(snap);
      this.o.sim.step(snap);
      const cam = this.o.renderer.camera;
      if (this.o.follow !== undefined) {
        const e = this.o.sim.world.get(this.o.follow);
        const t = e?.get<TransformIso>(C.Transform);
        if (t) cam.follow(gridToScreen(t.x, t.y, t.h, this.o.renderer.iso));
      }
      cam.update(TICK_DT);
      this.o.onTick?.(this.o.sim);
    } catch (error) {
      this.failed = error;
      this.paused = true;
      this.o.onError?.(error, this.o.sim);
    }
  }

  private draw(): void {
    this.o.renderer.render(this.o.sim.world);
  }
}
