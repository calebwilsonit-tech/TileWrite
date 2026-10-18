import { C, cameraSnapshot, pictureOf, pointerSnapshot, type CameraReading, type Cell2, type TransformIso } from '@tilewright/runtime';
import { activateWidget, attackTargets, currentUnit, findOnScreens, moveRange, openScreens, setChoice, setSlider, takerOf, unitsOf, walkView, type ViewNode } from '@tilewright/behaviors';
import { Bot, formatTime, type PlayReport } from './bot';

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
}

export interface BattleReport extends PlayReport {
  rounds: number;
  turns: number;
}

export class PointerBot extends Bot {
  camera: CameraReading = DEFAULT_CAMERA;

  /** Where a cell's centre is in the picture, for the bot's camera and the game's current view. */
  screenOf(cell: Cell2, h = 0): { x: number; y: number } {
    const sim = this.game.sim;
    return pictureOf(this.camera, sim.runtime.view.rotation ?? 0, sim.map, cell.x + 0.5, cell.y + 0.5, h);
  }

  private pointer(cell: Cell2 | null, buttons: { primary?: boolean; secondary?: boolean; shift?: boolean; screen?: { x: number; y: number } } = {}): void {
    this.step({ ...cameraSnapshot(this.camera), ...pointerSnapshot(cell, { screen: cell ? this.screenOf(cell) : undefined, ...buttons }) });
  }

  /** Move the pointer over a cell for a moment (hover names, the build ghost and the cursor's highlight follow it). */
  hover(cell: Cell2, ticks = 2): void {
    for (let i = 0; i < ticks; i++) this.pointer(cell);
  }

  /** Press and release a mouse button over a cell. */
  click(cell: Cell2, opts: ClickOptions = {}): void {
    const buttons = { [opts.button ?? 'primary']: true, shift: opts.shift };
    this.pointer(cell);
    for (let i = 0; i < (opts.hold ?? 1); i++) this.pointer(cell, buttons);
    this.pointer(cell, { shift: opts.shift });
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

  // ---------- turns ----------

  /** Who is acting in the battle right now. */
  battle(): { active: boolean; round: number; unit: string; team: string; winner: string; ap: number } {
    const g = this.game;
    const t = g.sim.runtime.turns;
    const u = currentUnit(g.ctx);
    return { active: t.active, round: t.round, unit: u?.name ?? '', team: u ? takerOf(u).team : '', winner: t.winner, ap: u ? (t.ap[u.id] ?? 0) : 0 };
  }

  private cellOfUnit(e: { require<T>(k: string): T }): Cell2 {
    const t = e.require<TransformIso>(C.Transform);
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  }

  /**
   * Take one of my units' turn by clicking: select it, hit an enemy in reach, or walk toward the nearest enemy, then end the turn.
   * Returns what it did, in words.
   */
  takeTurn(): string {
    const g = this.game;
    const me = currentUnit(g.ctx);
    if (!me) return 'nobody is acting';
    const cell = this.cellOfUnit(me);
    const done: string[] = [];
    for (let guard = 0; guard < 6 && this.battle().active && currentUnit(g.ctx) === me; guard++) {
      const targets = attackTargets(g.ctx, me);
      const ap = this.battle().ap;
      if (targets.length > 0 && ap >= takerOf(me).attackCost) {
        const foe = targets.sort((a, b) => (healthLeft(a) - healthLeft(b)))[0]!;
        this.click(this.cellOfUnit(me));
        this.click(this.cellOfUnit(foe));
        done.push(`hit ${foe.name}`);
        this.wait(0.4);
        continue;
      }
      const reach = moveRange(g.ctx, me);
      const foes = unitsOf(g.ctx).filter((u) => takerOf(u).team !== takerOf(me).team);
      if (foes.length === 0 || reach.size <= 1) break;
      const near = (c: Cell2): number => Math.min(...foes.map((f) => Math.hypot(this.cellOfUnit(f).x - c.x, this.cellOfUnit(f).y - c.y)));
      let best: Cell2 | null = null;
      let bestD = near(this.cellOfUnit(me));
      for (const key of reach.keys()) {
        const [x, y] = key.split(',').map(Number) as [number, number];
        const d = near({ x, y });
        if (d < bestD - 0.01) {
          bestD = d;
          best = { x, y };
        }
      }
      if (!best) break;
      this.click(this.cellOfUnit(me));
      this.click(best);
      done.push(`walked to ${best.x},${best.y}`);
      this.wait(1.2);
      if (this.cellOfUnit(me).x === cell.x && this.cellOfUnit(me).y === cell.y && done.length > 3) break;
    }
    if (this.battle().active && currentUnit(g.ctx) === me) {
      this.press('end_turn');
      this.wait(0.4);
      done.push('ended the turn');
    }
    return `${me.name}: ${done.join(', ') || 'waited'}`;
  }

  /** Play my side of a battle until it is won, a side loses, or time runs out. Enemies play themselves. */
  playBattle(opts: { team?: string; maxSeconds?: number } = {}): BattleReport {
    const team = opts.team ?? 'blue';
    const start = this.game.sim.tick;
    const limit = Math.round((opts.maxSeconds ?? 300) * 60);
    let turns = 0;
    let rounds = 1;
    for (let i = 0; i < 90 && !this.battle().active; i++) this.step(); // the battle may be about to start
    while (this.game.sim.tick - start < limit) {
      const b = this.battle();
      if (!b.active) break;
      rounds = Math.max(rounds, b.round);
      if (b.team === team && b.unit) {
        this.takeTurn();
        turns++;
      } else this.step();
    }
    const b = this.battle();
    const seconds = (this.game.sim.tick - start) / 60;
    if (!b.active && b.winner === team) return { ok: true, kind: 'reached', seconds, message: `The ${team} side won after ${rounds} rounds (${turns} turns, ${formatTime(seconds)}).`, rounds, turns };
    if (!b.active) return { ok: false, kind: 'died', seconds, message: b.winner ? `The ${b.winner} side won.` : 'The battle ended with no winner.', rounds, turns };
    return { ok: false, kind: 'timeout', seconds, message: `The battle was not finished after ${formatTime(seconds)}.`, rounds, turns };
  }
}

const healthLeft = (e: { get<T>(k: string): T | undefined }): number => e.get<{ hp?: number }>('health')?.hp ?? 99;
