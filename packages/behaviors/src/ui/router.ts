import { closeScreen, openRole, roleOfScreen, openScreen, screenBlocksInput, screenIsOverlay, screenNamed, screenPauses, sync, type Simulation, type UiScreen } from '@tilewright/runtime';

/**
 * One place decides what a press of Back (the pause button: Esc, the pad's Start or B) does, for every screen the game
 * can show. The screen on top is asked first; whatever handles the press takes it, so nothing underneath reacts to the
 * same press in the same tick.
 *
 * This has no drawing in it (it is plain data and functions), so the game, the playbot and the tests run the same code.
 */

/** What the game's own interface offers the router. */
export interface RouterHost {
  sim: Simulation;
  /** Does the pause button open the Pause screen by itself? (A project can instead use its own rule: see the `pauseKey` compatibility flag.) */
  pauseKeyOpensPause?: boolean;
}

/** What Back does on one screen. */
export type BackAction = { kind: 'close' } | { kind: 'previous' } | { kind: 'goto'; to: string } | { kind: 'swallow' } | { kind: 'pass' };

/**
 * Back's meaning on a screen, from the screen's own setting (and, for `auto`, from its role and whether it takes the buttons).
 * A screen the player opened as a menu is closed by Back whether or not it takes the buttons; only an overlay (a heads-up display) lets it pass.
 */
export function backAction(s: UiScreen, menusClose = true): BackAction {
  switch (s.back) {
    case 'close':
      return { kind: 'close' };
    case 'previous':
      return { kind: 'previous' };
    case 'screen':
      return s.backTo ? { kind: 'goto', to: s.backTo } : { kind: 'previous' };
    case 'nothing':
      return { kind: 'swallow' };
    case 'pass':
      return { kind: 'pass' };
    default:
      if (roleOfScreen(s) === 'pause') return { kind: 'close' };
      if (roleOfScreen(s) === 'title') return { kind: 'swallow' };
      if (screenIsOverlay(s)) return { kind: 'pass' };
      if (screenBlocksInput(s)) return { kind: 'previous' };
      // the older rule (the project does not have `backClosesMenus`): anything that does not take the buttons lets Back through
      return menusClose ? { kind: 'close' } : { kind: 'pass' };
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
export function backFromScreens(sim: Simulation, fresh: ReadonlySet<string> = new Set()): string {
  const r = sim.runtime;
  for (const s of offerOrder(sim)) {
    // a screen that opened on this very press (a Quick Action did it) is not also sent the press as Back
    if (fresh.has(s.name)) continue;
    const a = backAction(s, sim.compat.backClosesMenus);
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
 * when no screen has the buttons. Each key opens the screen that plays its role (Pause, Inventory, World map), which is
 * the project's own or the one a plugin ships; with no such screen the key does nothing.
 */
export function routeInput(h: RouterHost): void {
  const sim = h.sim;
  const r = sim.runtime;
  const busy = Boolean(r.dialogue || r.cutscene || r.minigame);
  const fresh = new Set(r.ui.stack.filter((n) => !r.ui.seen.includes(n)));
  try {
    route(h, busy, fresh);
  } finally {
    r.ui.seen = [...r.ui.stack];
  }
}

function route(h: RouterHost, busy: boolean, fresh: ReadonlySet<string>): void {
  const sim = h.sim;
  const ui = sim.uiInput;
  const r = sim.runtime;
  if (!busy && ui.pressed('pause')) {
    const by = backFromScreens(sim, fresh);
    if (by !== '') ui.consume('pause');
  }
  sync(sim);
  // a screen that blocks input has the buttons: nothing else reacts, not even to a press it did not use
  if (r.ui.blocking || busy) return;

  if (ui.pressed('pause') && h.pauseKeyOpensPause !== false) {
    ui.consume('pause');
    if (openRole(sim, 'pause')) note(sim, r.ui.stack[r.ui.stack.length - 1] ?? 'Pause', 'opened the Pause screen');
    else note(sim, 'game', 'there is no Pause screen to open');
  } else if (ui.pressed('inventory')) {
    ui.consume('inventory');
    openRole(sim, 'inventory');
  } else if (ui.pressed('map')) {
    ui.consume('map');
    // the world map when the project has one, otherwise the screen a plugin offers for travelling
    if (!(sim.assets.worldMap && sim.assets.worldMap.nodes.length > 0 && openRole(sim, 'map'))) openRole(sim, 'travel');
  }
}

/** What Back does on a screen, in words (for the screens overlay and the designer). */
export function backWords(s: UiScreen, menusClose = true): string {
  const a = backAction(s, menusClose);
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
      return 'Back passes through (to the game)';
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
    lines.push(`${i === 0 ? '>' : ' '} ${s.name}  [${kind}]  ${backWords(s, sim.compat.backClosesMenus)}${s.priority !== 0 ? `  priority ${s.priority}` : ''}`);
  }
  const l = r.ui.last;
  lines.push(l ? `Last press of ${l.action}, tick ${l.tick}: ${l.result}` : 'Last press of Back: none yet');
  return lines.join('\n');
}
