import { C, type Entity, type TransformIso } from '@tilewright/runtime';
import type { Game } from '@tilewright/playbot';
import { activateWidget, findOnScreens } from '@tilewright/behaviors';
import { DIRS, type Action, type Dir } from './solver';

/**
 * Plays a list of solver actions in the real game with nothing but the player's buttons (the four ways and Interact),
 * and says in words where it went wrong if it did. This is what proves a room can be finished as the game really runs.
 */
const KEYS: Record<Dir, string> = { E: 'move_right', W: 'move_left', S: 'move_down', N: 'move_up' };

export interface ReplayResult {
  ok: boolean;
  /** Seconds of game time the run took. */
  seconds: number;
  /** Every button pressed, tick by tick (a playthrough). */
  frames: Record<string, number>[];
  message: string;
}

export class RoomBot {
  readonly frames: Record<string, number>[] = [];
  private readonly scene: string;
  constructor(readonly game: Game) {
    this.scene = game.scenePath;
  }

  /** Has the room ended (the way out was taken)? */
  ended(): boolean {
    const v = this.game.sim.runtime.vars;
    return this.game.scenePath !== this.scene || v[`done_${String(v.ng_room)}`] === 1;
  }

  private get t(): TransformIso {
    return this.game.player.require<TransformIso>(C.Transform);
  }

  step(a: Record<string, number> = {}): void {
    this.frames.push(a);
    this.game.step(a);
  }

  /** Is a menu up (the title, a chapter card) that holds the game still? */
  menuUp(): boolean {
    return this.game.sim.runtime.ui.modal === true;
  }

  /** Press a row of an open menu by its words, as a click on it does. False when it is not there to be pressed. */
  press(words: string): boolean {
    const w = findOnScreens(this.game.sim, words);
    if (!w || !w.visible || !w.enabled) return false;
    activateWidget(this.game.sim, w);
    this.wait(3);
    return true;
  }

  /** Leave the menus a room starts under the way a player does: New game on the title, Go on on a chapter card. Returns how many were left. */
  dismissMenus(): number {
    let n = 0;
    for (let i = 0; i < 6 && this.menuUp(); i++) {
      if (!this.press('New game') && !this.press('Go on')) break;
      n++;
    }
    return n;
  }

  wait(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.step();
  }

  private cell(): [number, number] {
    return [Math.floor(this.t.x), Math.floor(this.t.y)];
  }

  /** Is anything in the room still on the move (the gardener walking, a bloom rising, a crate sliding, a gate swinging)? */
  private moving(): boolean {
    if (this.game.sim.runtime.vars.ng_moving) return true;
    for (const e of this.game.sim.world.all()) {
      const bloom = e.get<{ data?: { p?: number } }>('state:script_Bloom');
      const p = bloom?.data?.p;
      if (p !== undefined && p > 0 && p < 1) return true;
      const gate = e.get<{ data?: { open?: number } }>('state:script_Gate');
      const o = gate?.data?.open;
      if (o !== undefined && o > 0 && o < 1) return true;
      const push = e.get<{ target: unknown }>('state:pushable');
      if (push?.target) return true;
    }
    const body = this.game.player.get<{ state: string }>(C.Body);
    return body ? body.state !== 'ground' : false;
  }

  /** Wait until the room has been still for a moment. */
  settle(): void {
    let still = 0;
    for (let i = 0; i < 600 && still < 6 && !this.ended(); i++) {
      this.step();
      still = this.moving() ? 0 : still + 1;
    }
  }

  /** Do one action. Returns words about what went wrong, or '' when it went as planned. */
  act(a: Action): string {
    const [cx, cy] = this.cell();
    const [dx, dy] = DIRS[a.dir];
    if (a.kind === 'toggle') {
      // turn to face the lamp (Run + the direction turns on the spot), then Interact
      this.step({ run: 1, [KEYS[a.dir]]: 1 });
      this.step({ run: 1 });
      this.step();
      this.step({ interact: 1 });
      this.step();
      this.settle();
      return '';
    }
    const crate = a.kind === 'push' ? this.pushableIn(cx + dx, cy + dy) : undefined;
    if (a.kind === 'push' && !crate) return `there is nothing to push ${a.dir} of cell (${cx}, ${cy})`;
    this.step({ [KEYS[a.dir]]: 1 });
    this.step();
    this.settle();
    if (this.ended()) return '';
    const [nx, ny] = this.cell();
    if (nx !== cx + dx || ny !== cy + dy) return `the gardener did not get from cell (${cx}, ${cy}) to (${cx + dx}, ${cy + dy}) and is in (${nx}, ${ny})`;
    return '';
  }

  private pushableIn(x: number, y: number): Entity | undefined {
    return this.game.sim.world.query('pushable').find((c) => {
      const t = c.require<TransformIso>(C.Transform);
      return Math.floor(t.x) === x && Math.floor(t.y) === y;
    });
  }
}


/** Play the actions in a game that has just started on the room. `check` is asked after every action whether the game agrees with the plan. */
export function replay(game: Game, actions: readonly Action[], check?: (bot: RoomBot, step: number) => string): ReplayResult {
  const bot = new RoomBot(game);
  bot.wait(6);
  bot.dismissMenus();
  bot.wait(4);
  bot.dismissMenus(); // the chapter card comes up once the room has started
  if (bot.menuUp()) return { ok: false, seconds: game.seconds, frames: bot.frames, message: 'A menu is up at the start of the room and neither New game nor Go on leaves it.' };
  bot.settle();
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    const wrong = bot.act(a) || (bot.ended() ? '' : check?.(bot, i) ?? '');
    if (wrong) return { ok: false, seconds: game.seconds, frames: bot.frames, message: `Step ${i + 1} of ${actions.length} (${a.kind} ${a.dir}): ${wrong}.` };
    if (bot.ended() && i < actions.length - 1) return { ok: false, seconds: game.seconds, frames: bot.frames, message: `The room ended at step ${i + 1} of ${actions.length}, before the plan did.` };
  }
  if (!bot.ended()) return { ok: false, seconds: game.seconds, frames: bot.frames, message: 'The plan was played to its end, but the way out was not taken.' };
  return { ok: true, seconds: game.seconds, frames: bot.frames, message: 'Played to the end.' };
}
