import { RESERVED_SCREENS, closeScreen, openScreen, screenBlocksInput, screenNamed, screenPauses, sync, type Simulation, type UiScreen } from '@tilewright/runtime';

/**
 * One place decides what a press of Back (the pause button: Esc, the pad's Start or B) does, for every screen the game
 * can show. The screen on top is asked first; whatever handles the press takes it, so nothing underneath reacts to the
 * same press in the same tick.
 *
 * This has no drawing in it (it is plain data and functions), so the game, the playbot and the tests run the same code.
 */

export type BuiltinMenu = 'main' | 'inventory' | 'map' | 'travel';

/** What the game's own interface offers the router. */
export interface RouterHost {
  sim: Simulation;
  /** The older fixed menus (built-in pause, title, inventory) are showing; they read the buttons themselves. */
  builtinOpen(): boolean;
  /** Open one of the fixed menus (used when no screen made in the designer replaces it). */
  openMenu(menu: BuiltinMenu): void;
  /** Does the pause button open the Pause screen by itself? (A project can instead use its own rule: see the `pauseKey` compatibility flag.) */
  pauseKeyOpensPause?: boolean;
}

/** What Back does on one screen. */
export type BackAction = { kind: 'close' } | { kind: 'previous' } | { kind: 'goto'; to: string } | { kind: 'swallow' } | { kind: 'pass' };

/** Back's meaning on a screen, from the screen's own setting (and, for `auto`, from its name and whether it blocks input). */
export function backAction(s: UiScreen): BackAction {
  switch (s.back) {
    case 'close':
      return { kind: 'close' };
    case 'previous':
      return { kind: 'previous' };
    case 'screen':
      return s.backTo ? { kind: 'goto', to: s.backTo } : { kind: 'previous' };
    case 'nothing':
      return { kind: 'swallow' };
    default:
      if (s.name === RESERVED_SCREENS.pause) return { kind: 'close' };
      if (s.name === RESERVED_SCREENS.title) return { kind: 'swallow' };
      return screenBlocksInput(s) ? { kind: 'previous' } : { kind: 'pass' };
  }
}

/** The open screens in the order they are offered the buttons: higher priority first, then the one opened last. */
export function offerOrder(sim: Simulation): UiScreen[] {
  const st = sim.runtime.ui.stack;
  return st
    .map((name, index) => ({ s: screenNamed(sim.assets, name), index }))
    .filter((x): x is { s: UiScreen; index: number } => x.s !== undefined)
    .sort((a, b) => b.s.priority - a.s.priority || b.index - a.index)
    .map((x) => x.s);
}

const note = (sim: Simulation, by: string, result: string): void => {
  sim.runtime.ui.last = { tick: sim.tick, action: 'pause', by, result };
};

/** Offer Back to the open screens. Returns the name of the one that took it, or '' when none did. */
export function backFromScreens(sim: Simulation): string {
  const r = sim.runtime;
  for (const s of offerOrder(sim)) {
    const a = backAction(s);
    if (a.kind === 'pass') continue;
    switch (a.kind) {
      case 'close': {
        const at = r.ui.stack.indexOf(s.name);
        const above = at >= 0 ? r.ui.stack.slice(at + 1) : [];
        for (const n of above) closeScreen(sim, n);
        closeScreen(sim, s.name);
        note(sim, s.name, above.length > 0 ? `closed "${s.name}" and the ${above.length} opened from it` : `closed "${s.name}"`);
        break;
      }
      case 'previous':
        closeScreen(sim, s.name);
        note(sim, s.name, `went back from "${s.name}"${r.ui.stack.length > 0 ? ` to "${r.ui.stack[r.ui.stack.length - 1]}"` : ''}`);
        break;
      case 'goto':
        closeScreen(sim, s.name);
        if (openScreen(sim, a.to)) note(sim, s.name, `went from "${s.name}" to "${a.to}"`);
        else note(sim, s.name, `closed "${s.name}" (there is no screen "${a.to}" to go back to)`);
        break;
      default:
        note(sim, s.name, `"${s.name}" keeps Back for itself: nothing happened`);
    }
    return s.name;
  }
  return '';
}

/**
 * Run the screens' part of one tick's buttons: Back on the screens, then the game's own keys (pause, inventory, map)
 * when no screen has the buttons. Returns `'builtin'` when a fixed menu is showing and should read the buttons
 * itself, `'done'` otherwise.
 */
export function routeInput(h: RouterHost): 'builtin' | 'done' {
  const sim = h.sim;
  const ui = sim.uiInput;
  const r = sim.runtime;
  if (h.builtinOpen()) return 'builtin';
  const busy = Boolean(r.dialogue || r.cutscene || r.minigame);

  if (!busy && ui.pressed('pause')) {
    const by = backFromScreens(sim);
    if (by !== '') ui.consume('pause');
  }
  sync(sim);
  // a screen that blocks input has the buttons: nothing else reacts, not even to a press it did not use
  if (r.ui.blocking || busy) return 'done';

  if (ui.pressed('pause') && h.pauseKeyOpensPause !== false) {
    ui.consume('pause');
    if (openScreen(sim, RESERVED_SCREENS.pause)) note(sim, RESERVED_SCREENS.pause, 'opened "Pause"');
    else {
      h.openMenu('main');
      note(sim, 'game', 'opened the built-in pause menu');
    }
  } else if (ui.pressed('inventory')) {
    ui.consume('inventory');
    h.openMenu('inventory');
  } else if (ui.pressed('map')) {
    ui.consume('map');
    h.openMenu(sim.assets.worldMap && sim.assets.worldMap.nodes.length > 0 ? 'map' : 'travel');
  }
  return h.builtinOpen() ? 'builtin' : 'done';
}

/** What Back does on a screen, in words (for the screens overlay and the designer). */
export function backWords(s: UiScreen): string {
  const a = backAction(s);
  switch (a.kind) {
    case 'close':
      return 'Back closes it';
    case 'previous':
      return 'Back goes to the screen before';
    case 'goto':
      return `Back goes to "${a.to}"`;
    case 'swallow':
      return 'Back does nothing (it keeps Back)';
    default:
      return 'Back passes through';
  }
}

/** The screen stack as text, top first: what is open, what each does with Back, and who handled the last press. */
export function describeScreens(sim: Simulation): string {
  const r = sim.runtime;
  const lines = [`Screens open: ${r.ui.stack.length}   game waits: ${r.ui.modal ? 'yes' : 'no'}   game buttons: ${r.ui.blocking ? 'taken by a screen' : 'free'}`];
  const order = offerOrder(sim);
  if (order.length === 0) lines.push('  (none)');
  for (const [i, s] of order.entries()) {
    const kind = [screenPauses(s) ? 'pauses' : '', screenBlocksInput(s) ? 'takes buttons' : ''].filter(Boolean).join(', ') || 'shows only';
    lines.push(`${i === 0 ? '>' : ' '} ${s.name}  [${kind}]  ${backWords(s)}${s.priority !== 0 ? `  priority ${s.priority}` : ''}`);
  }
  const l = r.ui.last;
  lines.push(l ? `Last press of ${l.action}, tick ${l.tick}: ${l.result}` : 'Last press of Back: none yet');
  return lines.join('\n');
}
