import crypto from 'node:crypto';
import { C, type TransformIso } from '@tilewright/runtime';
import { PointerBot, type Game } from '@tilewright/playbot';

export const sha = (text: string | Uint8Array): string => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface Checkpoint {
  tick: number;
  /** Where the player is (null if there is none). */
  player: { x: number; y: number; h: number } | null;
  entities: number;
  /** A fingerprint of every object's name, tags and position, and of the game's variables. */
  world: string;
  vars: string;
  /** The interface screens that are open, bottom first. */
  screen: string;
}

/** What the game looks like right now, small enough to keep in a baseline and exact enough to notice any change. */
export function checkpoint(game: Game, watch: readonly string[] = []): Checkpoint {
  const all = game.sim.world.all();
  const rows = all
    .map((e) => {
      const t = e.get<TransformIso>(C.Transform);
      return `${e.name}|${[...e.tags].sort().join(',')}|${t ? `${r3(t.x)},${r3(t.y)},${r3(t.h)}` : '-'}`;
    })
    .sort();
  const vars = Object.entries(game.sim.runtime.vars)
    .map(([k, v]) => `${k}=${typeof v === 'number' ? r3(v) : String(v)}`)
    .sort();
  const p = game.sim.world.withTag('player')[0];
  const t = p?.get<TransformIso>(C.Transform);
  const ui = game.sim.runtime.ui;
  return {
    tick: game.sim.tick,
    player: t ? { x: r3(t.x), y: r3(t.y), h: r3(t.h) } : null,
    entities: all.length,
    world: sha(rows.join('\n')),
    vars: sha(vars.join('\n')),
    ...(watch.length > 0 ? { watched: Object.fromEntries(watch.map((k) => [k, (game.sim.runtime.vars[k] ?? '(not set)') as string | number | boolean])) } : {}),
    screen: `${ui.stack.join('>')}${ui.modal ? ' (modal)' : ''}`,
  };
}

export type Step = { hold: Record<string, number>; ticks: number };

/** A named list of button presses for one scene of one project (see compat/scenarios). */
export interface Scenario {
  name: string;
  /** Scene path; the project's start scene when empty. */
  scene?: string;
  steps: Step[];
  /** Take a checkpoint every this many ticks (default 30). */
  every?: number;
  /** Variables to write out in full (the rest are only fingerprinted). */
  watch?: string[];
}

/** The same buttons for every project: walk the four ways, run, jump, use, attack, dodge, open the menu and the inventory, wait. */
export const KEY_SCRIPT: Step[] = [
  { hold: {}, ticks: 60 },
  { hold: { move_right: 1 }, ticks: 45 },
  { hold: { move_down: 1 }, ticks: 45 },
  { hold: { move_left: 1 }, ticks: 45 },
  { hold: { move_up: 1 }, ticks: 45 },
  { hold: { move_right: 1, run: 1 }, ticks: 40 },
  { hold: { jump: 1 }, ticks: 2 },
  { hold: {}, ticks: 40 },
  { hold: { move_down: 1, jump: 1 }, ticks: 30 },
  { hold: { interact: 1 }, ticks: 2 },
  { hold: {}, ticks: 20 },
  { hold: { attack: 1 }, ticks: 2 },
  { hold: {}, ticks: 20 },
  { hold: { dodge: 1, move_left: 1 }, ticks: 6 },
  { hold: { move_left: 1 }, ticks: 40 },
  { hold: { pause: 1 }, ticks: 2 },
  { hold: {}, ticks: 30 },
  { hold: { pause: 1 }, ticks: 2 },
  { hold: {}, ticks: 20 },
  { hold: { inventory: 1 }, ticks: 2 },
  { hold: {}, ticks: 20 },
  { hold: { inventory: 1 }, ticks: 2 },
  { hold: { move_up: 1 }, ticks: 60 },
  { hold: {}, ticks: 60 },
];

/** Play a list of button presses, taking a checkpoint every few ticks. Never throws: a crash is part of the trace. */
export function runSteps(game: Game, steps: readonly Step[], every = 60, watch: readonly string[] = []): { checkpoints: Checkpoint[]; error: string } {
  const checkpoints: Checkpoint[] = [checkpoint(game, watch)];
  let error = '';
  try {
    for (const step of steps) {
      for (let i = 0; i < step.ticks; i++) {
        // a press is one tick long: the first tick of a step holds the buttons, the rest of a 2-tick step does not
        game.step(step.ticks <= 2 && i > 0 ? {} : step.hold);
        if (game.sim.tick % every === 0) checkpoints.push(checkpoint(game, watch));
      }
    }
  } catch (e) {
    error = (e as Error).message;
  }
  checkpoints.push(checkpoint(game, watch));
  return { checkpoints, error };
}

/** Play the key script, taking a checkpoint every 60 ticks. */
export const runKeys = (game: Game, every = 60): { checkpoints: Checkpoint[]; error: string } => runSteps(game, KEY_SCRIPT, every);

/** Play with the mouse: hover and click cells around the player, then right-click one and drag a box. */
export function runMouse(game: Game): { checkpoints: Checkpoint[]; error: string } {
  const checkpoints: Checkpoint[] = [checkpoint(game)];
  let error = '';
  try {
    const bot = new PointerBot(game);
    const p = game.sim.world.withTag('player')[0];
    const t = p?.get<TransformIso>(C.Transform);
    const cx = Math.floor(t?.x ?? 2);
    const cy = Math.floor(t?.y ?? 2);
    const cells = [
      { x: cx + 2, y: cy },
      { x: cx, y: cy + 2 },
      { x: cx - 2, y: cy },
      { x: cx, y: cy - 2 },
      { x: cx + 3, y: cy + 3 },
    ];
    bot.wait(0.5);
    checkpoints.push(checkpoint(game));
    for (const c of cells) {
      bot.hover(c, 3);
      bot.click(c);
      bot.wait(1.5);
      checkpoints.push(checkpoint(game));
    }
    bot.rightClick(cells[0]!);
    bot.wait(1);
    bot.dragBox({ x: cx - 3, y: cy - 3 }, { x: cx + 3, y: cy + 3 });
    bot.wait(1);
    checkpoints.push(checkpoint(game));
  } catch (e) {
    error = (e as Error).message;
  }
  return { checkpoints, error };
}
