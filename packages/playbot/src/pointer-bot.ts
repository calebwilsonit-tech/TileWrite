import { cameraSnapshot, pictureOf, pointerSnapshot, type CameraReading, type Cell2 } from '@tilewright/runtime';
import { Bot } from './bot';
import { activateWidget, findOnScreens, openScreens, setChoice, setSlider, walkView, type ViewNode } from '@tilewright/behaviors';

/**
 * A bot that plays with a mouse, a screen and turns, like a person does: it moves the pointer over cells, clicks, drags a box,
 * presses the buttons it can see on the open screens, and takes its turn in a battle by clicking its units. It still only does
 * what a player could do: no teleporting, no editing the world.
 */

export const DEFAULT_CAMERA: CameraReading = { x: 0, y: 200, zoom: 1, w: 1280, h: 720 };

export interface ClickOptions {
  button?: 'primary' | 'secondary';
  shift?: boolean;
  /** Ticks to hold the button (a press that lasts one tick is a click). */
  hold?: number;
  /** Other buttons held during the click (for example { rts_attack_move: 1 } for attack-move). */
  keys?: Record<string, number>;
}

export class PointerBot extends Bot {
  camera: CameraReading = DEFAULT_CAMERA;

  /** Where a cell's centre is in the picture, for the bot's camera and the game's current view. */
  screenOf(cell: Cell2, h = 0): { x: number; y: number } {
    const sim = this.game.sim;
    return pictureOf(this.camera, sim.runtime.view.rotation ?? 0, sim.map, cell.x + 0.5, cell.y + 0.5, h);
  }

  private pointer(cell: Cell2 | null, buttons: { primary?: boolean; secondary?: boolean; shift?: boolean; screen?: { x: number; y: number } } = {}, keys: Record<string, number> = {}): void {
    this.step({ ...cameraSnapshot(this.camera), ...pointerSnapshot(cell, { screen: cell ? this.screenOf(cell) : undefined, ...buttons }), ...keys });
  }

  /** Move the pointer over a cell for a moment (hover names, the build ghost and the cursor's highlight follow it). */
  hover(cell: Cell2, ticks = 2): void {
    for (let i = 0; i < ticks; i++) this.pointer(cell);
  }

  /** Press and release a mouse button over a cell. */
  click(cell: Cell2, opts: ClickOptions = {}): void {
    const buttons = { [opts.button ?? 'primary']: true, shift: opts.shift };
    this.pointer(cell, {}, opts.keys);
    for (let i = 0; i < (opts.hold ?? 1); i++) this.pointer(cell, buttons, opts.keys);
    this.pointer(cell, { shift: opts.shift }, opts.keys);
  }

  rightClick(cell: Cell2, opts: Omit<ClickOptions, 'button'> = {}): void {
    this.click(cell, { ...opts, button: 'secondary' });
  }

  /** Drag a box from one cell to another with the primary button (selects units with RTS Control). */
  dragBox(from: Cell2, to: Cell2, opts: { shift?: boolean } = {}): void {
    const a = this.screenOf(from);
    const b = this.screenOf(to);
    this.step({ ...cameraSnapshot(this.camera), ...pointerSnapshot(from, { screen: a, primary: true, shift: opts.shift }) });
    this.step({ ...cameraSnapshot(this.camera), ...pointerSnapshot(from, { screen: a, primary: true, shift: opts.shift }) });
    for (let i = 1; i <= 4; i++) {
      const at = { x: a.x + ((b.x - a.x) * i) / 4, y: a.y + ((b.y - a.y) * i) / 4 };
      this.step({ ...cameraSnapshot(this.camera), ...pointerSnapshot(to, { screen: at, primary: true, shift: opts.shift }) });
    }
    this.step({ ...cameraSnapshot(this.camera), ...pointerSnapshot(to, { screen: b, shift: opts.shift }) });
  }

  // ---------- the screens ----------

  /** Every visible word on the open screens, top screen first (what a player could read). */
  screenText(): string[] {
    const out: string[] = [];
    for (const { view } of [...openScreens(this.game.sim)].reverse()) {
      walkView(view, (n) => {
        if (n.visible && n.text.trim() !== '' && !out.includes(n.text)) out.push(n.text);
      });
    }
    return out;
  }

  /** The widget a player would see with this name or words, or null. */
  widget(nameOrWords: string): ViewNode | null {
    return findOnScreens(this.game.sim, nameOrWords);
  }

  /** Click a button, tick box or any widget on the open screens by its name or words. Returns false when it cannot be seen or is switched off. */
  pressWidget(nameOrWords: string): boolean {
    const w = this.widget(nameOrWords);
    if (!w || !w.visible || !w.enabled) return false;
    activateWidget(this.game.sim, w);
    this.wait(0.05);
    return true;
  }

  /** Drag a slider to a value. */
  slide(nameOrWords: string, value: number): boolean {
    const w = this.widget(nameOrWords);
    if (!w) return false;
    setSlider(this.game.sim, w, value);
    this.wait(0.05);
    return true;
  }

  choose(nameOrWords: string, choice: string): boolean {
    const w = this.widget(nameOrWords);
    if (!w) return false;
    setChoice(this.game.sim, w, choice);
    this.wait(0.05);
    return true;
  }

}

