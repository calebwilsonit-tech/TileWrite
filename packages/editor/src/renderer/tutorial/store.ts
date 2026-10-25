import { useSyncExternalStore } from 'react';
import { getPlay } from '../viewport/controller';
import { store as app } from '../app/store';
import { TUTORIAL_STEPS, type TutorialContext } from './steps';

export interface TutorialState {
  active: boolean;
  index: number;
  startedAt: number;
  finishedAt: number | null;
  sawGateOpen: boolean;
}

const INITIAL: TutorialState = { active: false, index: 0, startedAt: 0, finishedAt: null, sawGateOpen: false };

class TutorialStore {
  private state: TutorialState = INITIAL;
  private listeners = new Set<() => void>();
  private unsub: (() => void) | null = null;
  private timer: number | undefined;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = (): TutorialState => this.state;

  private set(patch: Partial<TutorialState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  start(): void {
    this.stopWatching();
    this.set({ active: true, index: 0, startedAt: Date.now(), finishedAt: null, sawGateOpen: false });
    this.unsub = app.subscribe(() => this.check());
    this.timer = window.setInterval(() => this.check(), 400);
  }

  close(): void {
    this.stopWatching();
    this.set({ active: false });
  }

  private stopWatching(): void {
    this.unsub?.();
    this.unsub = null;
    window.clearInterval(this.timer);
  }

  next(): void {
    const last = TUTORIAL_STEPS.length - 1;
    if (this.state.index >= last) {
      this.set({ finishedAt: this.state.finishedAt ?? Date.now() });
      this.close();
      return;
    }
    const index = this.state.index + 1;
    this.set({ index, ...(index === last ? { finishedAt: Date.now() } : {}) });
    this.check();
  }

  back(): void {
    if (this.state.index > 0) this.set({ index: this.state.index - 1, finishedAt: null });
  }

  /** Has the current step been done? If so, move on. */
  private check(): void {
    if (!this.state.active) return;
    let saw = this.state.sawGateOpen;
    if (!saw && app.state.mode === 'play' && getPlay()) {
      saw = getPlay()!.sim.world.all().some((e) => e.has('gate') && (e.get<{ outputs: Record<string, boolean> }>('signals')?.outputs.isOpen ?? false));
      if (saw) this.set({ sawGateOpen: true });
    }
    const step = TUTORIAL_STEPS[this.state.index];
    if (!step?.done) return;
    const ctx: TutorialContext = { doc: app.doc, mode: app.state.mode, sawGateOpen: saw };
    if (step.done(ctx)) this.next();
  }
}

export const tutorial = new TutorialStore();

export function useTutorial<T>(selector: (s: TutorialState) => T): T {
  return useSyncExternalStore(tutorial.subscribe, () => selector(tutorial.getState()));
}
