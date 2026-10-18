import type { RawInput } from './input';

/** The parts of the browser Gamepad object we read (so tests can pass plain objects). */
export interface PadLike {
  connected: boolean;
  buttons: readonly { pressed: boolean; value: number }[];
  axes: readonly number[];
}

const DEADZONE = 0.3;

/**
 * Gamepad state as raw bindings: "pad:button<N>" (0..1) and "pad:axis<N>+" / "pad:axis<N>-" (how far the stick
 * leans that way). Buttons and sticks follow the standard layout (A = button0, start = button9, d-pad = 12..15).
 */
export function readGamepads(pads: readonly (PadLike | null)[]): RawInput {
  const out: RawInput = {};
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    pad.buttons.forEach((b, i) => {
      const v = b.pressed ? Math.max(b.value, 1e-3) : b.value;
      if (v > 0.1) out[`pad:button${i}`] = Math.max(out[`pad:button${i}`] ?? 0, v);
    });
    pad.axes.forEach((a, i) => {
      if (Math.abs(a) < DEADZONE) return;
      const key = `pad:axis${i}${a > 0 ? '+' : '-'}`;
      out[key] = Math.max(out[key] ?? 0, Math.min(1, Math.abs(a)));
    });
  }
  return out;
}

/** Browser keyboard + mouse-button + gamepad source. Produces raw bindings "key:<KeyboardEvent.code>", "mouse:<button>" and "pad:...". */
export class DomInputSource {
  private readonly raw: RawInput = {};
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.raw[`key:${e.code}`] = 1;
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    delete this.raw[`key:${e.code}`];
  };
  private readonly onBlur = (): void => {
    for (const k of Object.keys(this.raw)) delete this.raw[k];
  };
  private readonly onMouseDown = (e: MouseEvent): void => {
    this.raw[`mouse:${e.button}`] = 1;
  };
  private readonly onMouseUp = (e: MouseEvent): void => {
    delete this.raw[`mouse:${e.button}`];
  };

  constructor(
    private readonly target: Window = window,
    private readonly pads: () => readonly (PadLike | null)[] = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : []),
  ) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('mouseup', this.onMouseUp);
  }

  read(): RawInput {
    return { ...this.raw, ...readGamepads(this.pads()) };
  }

  /**
   * The next key, mouse button or gamepad button the player presses, for "press a key to rebind". Resolves with the
   * binding id, or null if nothing was pressed in time or Escape was pressed (which cancels).
   */
  captureNext(timeoutMs = 10000): Promise<string | null> {
    return new Promise((resolve) => {
      const held = readGamepads(this.pads());
      let finished = false;
      const finish = (id: string | null): void => {
        if (finished) return;
        finished = true;
        this.target.removeEventListener('keydown', onKey, true);
        this.target.removeEventListener('mousedown', onMouse, true);
        clearInterval(poll);
        clearTimeout(timer);
        resolve(id);
      };
      const onKey = (e: KeyboardEvent): void => {
        e.preventDefault();
        finish(e.code === 'Escape' ? null : `key:${e.code}`);
      };
      const onMouse = (e: MouseEvent): void => finish(`mouse:${e.button}`);
      this.target.addEventListener('keydown', onKey, true);
      this.target.addEventListener('mousedown', onMouse, true);
      const poll = setInterval(() => {
        const fresh = Object.keys(readGamepads(this.pads())).find((k) => k.startsWith('pad:button') && !(k in held));
        if (fresh) finish(fresh);
      }, 30);
      const timer = setTimeout(() => finish(null), timeoutMs);
    });
  }
  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    this.target.removeEventListener('mouseup', this.onMouseUp);
  }
}

/** Default bindings used by new projects and the samples (keyboard, mouse and a standard gamepad). */
export const DEFAULT_INPUT_MAP = {
  move_left: ['key:KeyA', 'key:ArrowLeft', 'pad:axis0-', 'pad:button14'],
  move_right: ['key:KeyD', 'key:ArrowRight', 'pad:axis0+', 'pad:button15'],
  move_up: ['key:KeyW', 'key:ArrowUp', 'pad:axis1-', 'pad:button12'],
  move_down: ['key:KeyS', 'key:ArrowDown', 'pad:axis1+', 'pad:button13'],
  run: ['key:ShiftLeft', 'key:ShiftRight', 'pad:button5'],
  interact: ['key:KeyE', 'key:Enter', 'pad:button0'],
  attack: ['key:KeyJ', 'mouse:0', 'pad:button2'],
  jump: ['key:Space', 'pad:button1'],
  dodge: ['key:KeyQ', 'pad:button3'],
  echo: ['key:KeyR', 'pad:button4'],
  pause: ['key:Escape', 'key:KeyP', 'pad:button9'],
  inventory: ['key:KeyI', 'pad:button8'],
  map: ['key:KeyM'],
  quick_1: ['key:Digit1'],
  quick_2: ['key:Digit2'],
  quick_3: ['key:Digit3'],
  quick_4: ['key:Digit4'],
};

/** The buttons every game has; packs add the others (attack, dodge, echo, quick slots...). */
export const CORE_ACTIONS = ['move_left', 'move_right', 'move_up', 'move_down', 'run', 'interact', 'jump', 'pause'] as const;

/** The bindings and names of the actions a project has: the core ones plus what its packs added. */
export function baseInput(extra: Record<string, { label: string; bindings: string[] }> = {}): { map: Record<string, string[]>; labels: Record<string, string> } {
  const map: Record<string, string[]> = {};
  const labels: Record<string, string> = {};
  for (const a of CORE_ACTIONS) {
    map[a] = [...DEFAULT_INPUT_MAP[a]];
    labels[a] = ACTION_LABELS[a]!;
  }
  for (const [a, d] of Object.entries(extra)) {
    map[a] = [...d.bindings];
    labels[a] = d.label;
  }
  return { map, labels };
}

/** Plain-English names for the actions, for the controls screen. */
export const ACTION_LABELS: Record<string, string> = {
  move_left: 'Move left',
  move_right: 'Move right',
  move_up: 'Move up',
  move_down: 'Move down',
  run: 'Run',
  interact: 'Interact / talk / confirm',
  attack: 'Attack (quill)',
  jump: 'Jump',
  dodge: 'Dodge',
  echo: 'Record an echo',
  pause: 'Pause menu',
  inventory: 'Inventory',
  map: 'Travel map',
  quick_1: 'Quick slot 1',
  quick_2: 'Quick slot 2',
  quick_3: 'Quick slot 3',
  quick_4: 'Quick slot 4',
};

/** A binding id in words: "key:KeyE" -> "E", "pad:button0" -> "Gamepad A". */
export function bindingLabel(id: string): string {
  const [kind, rest = ''] = id.split(/:(.*)/s);
  if (kind === 'key') return rest.replace(/^Key/, '').replace(/^Digit/, '').replace('Arrow', 'Arrow ').replace('ShiftLeft', 'Left Shift').replace('ShiftRight', 'Right Shift');
  if (kind === 'mouse') return `Mouse ${['left', 'middle', 'right'][Number(rest)] ?? rest}`;
  if (kind === 'pad') {
    const b = /^button(\d+)$/.exec(rest);
    if (b) return `Gamepad ${['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'][Number(b[1])] ?? `button ${b[1]}`}`;
    const a = /^axis(\d+)([+-])$/.exec(rest);
    if (a) return `Gamepad ${a[1] === '0' ? (a[2] === '-' ? 'stick left' : 'stick right') : a[1] === '1' ? (a[2] === '-' ? 'stick up' : 'stick down') : `axis ${a[1]}${a[2]}`}`;
  }
  return id;
}
