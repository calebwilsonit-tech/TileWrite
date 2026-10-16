import type { RawInput } from './input';

/** Browser keyboard + mouse-button source. Produces raw bindings "key:<KeyboardEvent.code>" and "mouse:<button>". */
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

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('mouseup', this.onMouseUp);
  }

  read(): RawInput {
    return { ...this.raw };
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    this.target.removeEventListener('mouseup', this.onMouseUp);
  }
}

/** Default bindings used by new projects and the samples. */
export const DEFAULT_INPUT_MAP = {
  move_left: ['key:KeyA', 'key:ArrowLeft'],
  move_right: ['key:KeyD', 'key:ArrowRight'],
  move_up: ['key:KeyW', 'key:ArrowUp'],
  move_down: ['key:KeyS', 'key:ArrowDown'],
  run: ['key:ShiftLeft', 'key:ShiftRight'],
  interact: ['key:KeyE', 'key:Enter'],
  attack: ['key:Space', 'mouse:0'],
  dodge: ['key:KeyQ'],
  echo: ['key:KeyR'],
  pause: ['key:Escape'],
};
