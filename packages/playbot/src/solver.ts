import { C, type EntityData, type InputRecording, type TransformIso } from '@tilewright/runtime';
import { Bot, formatTime } from './bot';
import { Game, type GameSetup } from './game';
import { expandEntities } from '@tilewright/runtime';
import { extractPushPuzzle, solvePush } from './push-solver';
import { host } from '@tilewright/behaviors';

/**
 * A puzzle solver that searches combinations of what a player can do in a room: stand on a plate, flip a lever, push the
 * crates onto their plates, and whatever steps the plugins that are on add. It tries short plans first (a walk with no help, then one
 * thing, then two...), each time playing the plan from the first frame with the player's buttons only, and stops at the
 * first that lets the player reach the goal. Because every try is a real run of the game, whatever it finds works in the
 * game exactly as shown (and an impossible room is reported honestly after the search). Meant for small rooms.
 */

export type MacroKind = string;

export interface Macro {
  kind: MacroKind;
  /** The object it is about (a reference the bot understands), or '' for the crate puzzle. */
  ref: string;
  label: string;
}

export interface SolveOptions {
  /** What has to be reached (default: the first thing tagged goal, exit or reward). */
  goal?: string;
  /** Most steps in a plan (default 4). */
  maxSteps?: number;
  /** Most plans to try (default 400). */
  maxPlans?: number;
  /** Stop searching after this many milliseconds (default 60 000). */
  maxMs?: number;
  /** Game seconds each try may take to reach the goal at the end (default 40). */
  walkSeconds?: number;
}

export interface SolveReport {
  /** A way to reach the goal was found. */
  found: boolean;
  /** The plan, in words, in order. Empty with `found` means the goal can simply be walked to. */
  steps: string[];
  /** Game seconds the winning run took. */
  seconds: number;
  /** Plans tried. */
  plans: number;
  /** The search ran out of time or tries before it could rule everything out. */
  gaveUp: boolean;
  message: string;
  /** The buttons of the winning run (save it as a playthrough). */
  recording?: InputRecording;
}

const sceneIdOf = (e: EntityData): string => e.id;

/** What the player could do in this scene, as steps the search can combine. */
export function candidateMacros(setup: GameSetup): Macro[] {
  const { entities } = expandEntities(setup.scene.entities, setup.prefabs ?? new Map());
  const player = entities.find((e) => e.tags.includes('player'));
  const pt = player?.components.transform as { x: number; y: number } | undefined;
  const dist = (e: EntityData): number => {
    const t = e.components.transform as { x: number; y: number } | undefined;
    return t && pt ? Math.hypot(t.x - pt.x, t.y - pt.y) : 0;
  };
  const out: Macro[] = [];
  const byDistance = [...entities].sort((a, b) => dist(a) - dist(b));
  for (const e of byDistance) {
    if (e.components.transform === undefined) continue;
    // the steps plugins offer for this object come first (a copy of yourself on a plate, before standing on it)
    for (const move of host.ext.playbotMoves.values()) for (const o of move.offer(e, player)) out.push({ kind: move.id, ref: o.ref, label: o.label });
    const plate = e.components.pressurePlate as { activatedBy?: string } | undefined;
    if (plate) {
      const ref = `id:${sceneIdOf(e)}`;
      out.push({ kind: 'stand', ref, label: `stand on "${e.name}"` });
    }
    if (e.components.lever !== undefined) out.push({ kind: 'lever', ref: `id:${sceneIdOf(e)}`, label: `flip "${e.name}"` });
  }
  if (entities.some((e) => e.components.pushable !== undefined) && entities.some((e) => (e.components.pressurePlate as { activatedBy?: string } | undefined)?.activatedBy === 'crates')) {
    out.push({ kind: 'push', ref: '', label: 'push the crates onto their plates' });
  }
  return out;
}

/** Carry out one step with the player's buttons. Returns whether it worked. `memory` is shared by the steps of one try. */
function perform(bot: Bot, game: Game, setup: GameSetup, m: Macro, memory: Record<string, unknown>): boolean {
  const plugged = host.ext.playbotMoves.get(m.kind);
  if (plugged) return plugged.perform(bot, game, m.ref, memory);
  switch (m.kind) {
    case 'stand':
      return bot.standOn(m.ref, 0.8, { maxSeconds: 30 }).ok;
    case 'lever':
      return bot.interact(m.ref, { maxSeconds: 30 }).ok;
    case 'push': {
      const puzzle = extractPushPuzzle(setup.scene, setup.prefabs ?? new Map(), { player: game.position, openGates: true });
      if (!puzzle) return false;
      const plan = solvePush(puzzle);
      return plan.solvable && bot.executePushes(plan.moves).ok;
    }
    default:
      return false;
  }
}

function goalOf(game: Game, goal: string | undefined): string | null {
  if (goal) return goal;
  for (const tag of ['goal', 'exit', 'reward']) if (game.sim.world.withTag(tag).length > 0) return `tag:${tag}`;
  return null;
}

/** Search for a plan that gets the player to the goal. */
export function solvePuzzles(setup: GameSetup, opts: SolveOptions = {}): SolveReport {
  const started = Date.now();
  const maxSteps = opts.maxSteps ?? 4;
  const maxPlans = opts.maxPlans ?? 400;
  const maxMs = opts.maxMs ?? 60_000;
  const macros = candidateMacros(setup);
  let plans = 0;
  const dead = new Set<string>(); // plans that cannot even be carried out: nothing that starts with them is tried
  let gaveUp = false;

  const probe = new Game(setup);
  const goal = goalOf(probe, opts.goal);
  if (!goal) return { found: false, steps: [], seconds: 0, plans: 0, gaveUp: false, message: 'There is nothing tagged goal, exit or reward to reach. Tag the place the player must get to.' };
  if (!probe.find(goal)) return { found: false, steps: [], seconds: 0, plans: 0, gaveUp: false, message: `There is nothing matching "${goal}" to reach.` };

  /** Play a plan on a fresh game; the key of the plan is its steps' indices. */
  const attempt = (plan: number[]): { ok: boolean; carried: boolean; game: Game; bot: Bot } => {
    plans++;
    const game = new Game(setup);
    const bot = new Bot(game);
    const memory: Record<string, unknown> = {};
    for (let i = 0; i < plan.length; i++) {
      if (!perform(bot, game, setup, macros[plan[i]!]!, memory)) {
        dead.add(plan.slice(0, i + 1).join(','));
        return { ok: false, carried: false, game, bot };
      }
    }
    // a door takes a moment to open and an echo a moment to arrive: if the way is shut, wait a little and try again
    let r = bot.walkToEntity(goal, { maxSeconds: opts.walkSeconds ?? 40 });
    for (let again = 0; again < 4 && !r.ok && r.kind !== 'died'; again++) {
      bot.wait(1.5);
      r = bot.walkToEntity(goal, { maxSeconds: opts.walkSeconds ?? 40 });
    }
    return { ok: r.ok, carried: true, game, bot };
  };

  const win = (plan: number[], game: Game, bot: Bot): SolveReport => {
    const steps = plan.map((i) => macros[i]!.label);
    const seconds = game.seconds;
    return {
      found: true,
      steps,
      seconds,
      plans,
      gaveUp: false,
      message: steps.length === 0 ? `The goal can be reached by walking, in ${formatTime(seconds)}.` : `Solved in ${steps.length} step${steps.length === 1 ? '' : 's'}: ${steps.join(', then ')}; then walk to the goal (${formatTime(seconds)} in all).`,
      recording: bot.recording(),
    };
  };

  // shortest plans first
  const budgetLeft = (): boolean => plans < maxPlans && Date.now() - started < maxMs;
  for (let depth = 0; depth <= Math.min(maxSteps, macros.length); depth++) {
    const stack: number[][] = [[]];
    const walk = (plan: number[]): SolveReport | null => {
      if (!budgetLeft()) {
        gaveUp = true;
        return null;
      }
      if (plan.length === depth) {
        const r = attempt(plan);
        return r.ok ? win(plan, r.game, r.bot) : null;
      }
      for (let i = 0; i < macros.length; i++) {
        if (plan.includes(i)) continue;
        // an echo and a stand on the same plate are the same idea twice
        const next = [...plan, i];
        if (dead.has(next.join(','))) continue;
        const found = walk(next);
        if (found) return found;
        if (gaveUp) return null;
      }
      return null;
    };
    void stack;
    const found = walk([]);
    if (found) return found;
    if (gaveUp) break;
  }
  return {
    found: false,
    steps: [],
    seconds: 0,
    plans,
    gaveUp,
    message: gaveUp
      ? `No solution found yet after ${plans} plans (the search stopped at its limit). A bigger room needs a bigger limit, or the puzzle may not be solvable.`
      : `No way to reach the goal was found with up to ${maxSteps} steps of ${macros.length === 0 ? 'nothing to use in this room' : 'moves, plates, levers and crates'} (${plans} plans tried). The puzzle may be impossible.`,
  };
}

/** A player position helper for callers that want to show where the solver stood. */
export function playerCell(game: Game): { x: number; y: number } {
  const t = game.player.get<TransformIso>(C.Transform)!;
  return { x: Math.floor(t.x), y: Math.floor(t.y) };
}
