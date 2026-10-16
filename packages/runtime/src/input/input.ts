/**
 * Input works with ACTIONS ("move_left", "interact"), never raw keys, so rebinding, gamepads,
 * recordings (echoes) and the playbot all share one path.
 *
 * Raw device state is a map of binding id -> value 0..1, e.g. "key:KeyW", "pad:button0",
 * "pad:axis0-", "mouse:0". An InputMap says which bindings drive which action.
 */

export type ActionSnapshot = Record<string, number>;
export type RawInput = Record<string, number>;
export type InputMapDef = Record<string, string[]>;

export class InputMap {
  constructor(public bindings: InputMapDef) {}

  get actions(): string[] {
    return Object.keys(this.bindings);
  }

  /** Raw device values -> action values (max over an action's bindings). Zero actions are omitted. */
  resolve(raw: RawInput): ActionSnapshot {
    const out: ActionSnapshot = {};
    for (const [action, list] of Object.entries(this.bindings)) {
      let v = 0;
      for (const b of list) v = Math.max(v, raw[b] ?? 0);
      if (v > 0) out[action] = v;
    }
    return out;
  }

  rebind(action: string, bindings: string[]): void {
    this.bindings = { ...this.bindings, [action]: [...bindings] };
  }

  toJSON(): InputMapDef {
    return this.bindings;
  }
}

/** Action state for the current simulation tick, with edge detection. */
export class InputState {
  private cur: ActionSnapshot = {};
  private prev: ActionSnapshot = {};

  /** Call once at the start of every simulation tick. */
  update(snapshot: ActionSnapshot): void {
    this.prev = this.cur;
    this.cur = snapshot;
  }

  value(action: string): number {
    return this.cur[action] ?? 0;
  }

  down(action: string): boolean {
    return this.value(action) > 0;
  }

  /** True only on the tick the action went down. */
  pressed(action: string): boolean {
    return this.down(action) && !((this.prev[action] ?? 0) > 0);
  }

  /** True only on the tick the action went up. */
  released(action: string): boolean {
    return !this.down(action) && (this.prev[action] ?? 0) > 0;
  }

  /** -1..1 from a negative/positive action pair. */
  axis(negative: string, positive: string): number {
    return this.value(positive) - this.value(negative);
  }

  /** Screen-space intent (right = +x, down = +y). Not normalised. */
  vector(left: string, right: string, up: string, down: string): { x: number; y: number } {
    return { x: this.axis(left, right), y: this.axis(up, down) };
  }

  get snapshot(): ActionSnapshot {
    return this.cur;
  }
}

export interface InputRecording {
  /** Tick the recording started on (usually 0). */
  startTick: number;
  /** Number of ticks recorded. */
  length: number;
  /** Snapshot changes: [tickOffset, snapshot]. A snapshot holds until the next entry. */
  events: [number, ActionSnapshot][];
}

function sameSnapshot(a: ActionSnapshot, b: ActionSnapshot): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/** Stores per-tick snapshots, only when they change. */
export class InputRecorder {
  private events: [number, ActionSnapshot][] = [];
  private last: ActionSnapshot = {};
  private n = 0;

  constructor(private readonly startTick = 0) {}

  record(snapshot: ActionSnapshot): void {
    if (this.n === 0 ? Object.keys(snapshot).length > 0 : !sameSnapshot(snapshot, this.last)) {
      this.events.push([this.n, { ...snapshot }]);
    }
    this.last = snapshot;
    this.n++;
  }

  get length(): number {
    return this.n;
  }

  finish(): InputRecording {
    return { startTick: this.startTick, length: this.n, events: this.events.map(([t, s]) => [t, { ...s }]) };
  }
}

/** Plays a recording back one tick at a time. */
export class InputPlayback {
  private idx = 0;
  private held: ActionSnapshot = {};
  private n = 0;

  constructor(private readonly rec: InputRecording) {}

  get done(): boolean {
    return this.n >= this.rec.length;
  }

  get length(): number {
    return this.rec.length;
  }

  /** Snapshot for the next tick; empty once the recording is over. */
  next(): ActionSnapshot {
    if (this.done) return {};
    while (this.idx < this.rec.events.length && this.rec.events[this.idx]![0] <= this.n) {
      this.held = this.rec.events[this.idx]![1];
      this.idx++;
    }
    this.n++;
    return this.held;
  }

  reset(): void {
    this.idx = 0;
    this.n = 0;
    this.held = {};
  }
}
