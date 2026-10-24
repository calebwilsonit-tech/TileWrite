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
  /** Buttons pressed since the last read, so a tap shorter than one frame (a quick click, a touchpad tap) is still seen once. */
  private latched: RawInput = {};
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.raw[`key:${e.code}`] = 1;
    this.latched[`key:${e.code}`] = 1;
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    delete this.raw[`key:${e.code}`];
  };
  private readonly onBlur = (): void => {
    for (const k of Object.keys(this.raw)) delete this.raw[k];
  };
  private readonly onMouseDown = (e: MouseEvent): void => {
    this.raw[`mouse:${e.button}`] = 1;
    this.latched[`mouse:${e.button}`] = 1;
    // a click on the game's picture (not on a menu or button drawn over it) is a click on the world
    if (this.overWorld(e)) {
      const k = `ptr:${['left', 'middle', 'right'][e.button] ?? 'left'}`;
      this.raw[k] = 1;
      this.latched[k] = 1;
    }
  };
  private readonly onMouseUp = (e: MouseEvent): void => {
    delete this.raw[`mouse:${e.button}`];
    delete this.raw[`ptr:${['left', 'middle', 'right'][e.button] ?? 'left'}`];
  };
  private readonly onMouseMove = (e: MouseEvent): void => {
    this.mouse = { x: e.clientX, y: e.clientY, over: this.overWorld(e) };
  };
  private readonly onWheel = (e: WheelEvent): void => {
    if (this.overWorld(e)) this.wheel = e.deltaY < 0 ? 1 : -1;
  };
  private readonly onContextMenu = (e: MouseEvent): void => {
    if (this.pointerEl && this.overWorld(e)) e.preventDefault();
  };
  /** Where the pointer last was, and whether it was over the world picture. */
  private mouse = { x: 0, y: 0, over: false };
  private wheel = 0;
  private pointerEl: HTMLElement | null = null;
  private probe: ((localX: number, localY: number) => { x: number; y: number } | null) | null = null;
  private cameraProbe: (() => { x: number; y: number; zoom: number; w: number; h: number }) | null = null;

  private overWorld(e: MouseEvent): boolean {
    const el = this.pointerEl;
    return !!el && e.target instanceof Element && e.target.tagName === 'CANVAS' && el.contains(e.target);
  }

  /**
   * Let the pointer drive the world: `el` holds the game picture; `probe` turns a position in it (pixels) into the cell
   * there (or null). Until this is called a mouse is only a button.
   */
  setPointer(el: HTMLElement, probe: (localX: number, localY: number) => { x: number; y: number } | null, camera?: () => { x: number; y: number; zoom: number; w: number; h: number }): void {
    this.pointerEl = el;
    this.probe = probe;
    this.cameraProbe = camera ?? null;
  }

  constructor(
    private readonly target: Window = window,
    private readonly pads: () => readonly (PadLike | null)[] = () => (typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : []),
  ) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('wheel', this.onWheel, { passive: true });
    target.addEventListener('contextmenu', this.onContextMenu);
  }

  read(): RawInput {
    const out: RawInput = { ...this.raw, ...this.latched, ...readGamepads(this.pads()) };
    this.latched = {};
    const el = this.pointerEl;
    if (el && this.probe) {
      const r = el.getBoundingClientRect();
      const lx = this.mouse.x - r.left;
      const ly = this.mouse.y - r.top;
      if (lx >= 0 && ly >= 0 && lx <= r.width && ly <= r.height) {
        out['ptr:sx'] = Math.round(lx) + 1;
        out['ptr:sy'] = Math.round(ly) + 1;
      }
      const cell = this.mouse.over ? this.probe(lx, ly) : null;
      if (cell) {
        out['ptr:cx'] = cell.x + 1;
        out['ptr:cy'] = cell.y + 1;
      }
      if (this.cameraProbe) {
        const c = this.cameraProbe();
        out['ptr:camx'] = Math.round(c.x) + 100000;
        out['ptr:camy'] = Math.round(c.y) + 100000;
        out['ptr:zoom'] = Math.round(c.zoom * 1000);
        out['ptr:vw'] = Math.round(c.w);
        out['ptr:vh'] = Math.round(c.h);
      }
      if (this.wheel !== 0) {
        out[this.wheel > 0 ? 'ptr:wheelUp' : 'ptr:wheelDown'] = 1;
        this.wheel = 0;
      }
    }
    return out;
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
    this.target.removeEventListener('mousemove', this.onMouseMove);
    this.target.removeEventListener('wheel', this.onWheel);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
  }
}

/** The default bindings of the buttons every game has (keyboard, mouse and a standard gamepad). Plugins add the buttons of their own kind of game. */
export const DEFAULT_INPUT_MAP = {
  move_left: ['key:KeyA', 'key:ArrowLeft', 'pad:axis0-', 'pad:button14'],
  move_right: ['key:KeyD', 'key:ArrowRight', 'pad:axis0+', 'pad:button15'],
  move_up: ['key:KeyW', 'key:ArrowUp', 'pad:axis1-', 'pad:button12'],
  move_down: ['key:KeyS', 'key:ArrowDown', 'pad:axis1+', 'pad:button13'],
  run: ['key:ShiftLeft', 'key:ShiftRight', 'pad:button5'],
  interact: ['key:KeyE', 'key:Enter', 'pad:button0'],
  jump: ['key:Space', 'pad:button1'],
  pause: ['key:Escape', 'key:KeyP', 'pad:button9'],
};

/** The buttons every game has; plugins add the others. */
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

/** Plain-English names for the buttons every game has, for the controls screen. */
export const ACTION_LABELS: Record<string, string> = {
  move_left: 'Move left',
  move_right: 'Move right',
  move_up: 'Move up',
  move_down: 'Move down',
  run: 'Run',
  interact: 'Interact / talk / confirm',
  jump: 'Jump',
  pause: 'Pause menu',
};

let extraActions: Record<string, { label: string; bindings: string[] }> = {};

/** The buttons the plugins that are on have added (called by the plugin host whenever plugins are turned on or off). */
export function setExtraInputActions(extra: Record<string, { label: string; bindings: string[] }>): void {
  extraActions = { ...extra };
}

/** Every button this game has right now: the core ones and those the plugins added, with the keys a new player starts with. */
export function activeInputMap(): Record<string, string[]> {
  return baseInput(extraActions).map;
}

/** The names of every button this game has right now. */
export function activeActionLabels(): Record<string, string> {
  return baseInput(extraActions).labels;
}

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
