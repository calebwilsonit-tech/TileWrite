import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InputMap, Simulation, legacyFlags, UiDocSchema, newWidget, openScreen, openStartScreens, pauseButtonRow, physicsSystem, DEFAULT_INPUT_MAP, type UiNode, type UiScreen } from '@tilewright/runtime';
import { backAction, routeInput, type RouterHost } from './router';
import { addStandardSystems } from '../index';

/**
 * Phase 3, step 1: the custom-screen bug. With the player's own screens, one press of Back used to be handled twice
 * in the same tick (first by the screen on top, then by the game's own "pause" rule), so Back from a custom screen landed
 * on Pause, and closing a custom Pause opened it again at once. Non-modal screens could never be backed out of.
 */

let n = 0;
const screen = (name: string, extra: Partial<UiScreen> = {}): UiScreen => ({
  id: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  root: { ...newWidget('panel', `w${++n}`), name: `${name} root`, anchor: 'fill' } as UiNode,
  modal: false,
  back: 'auto',
  backTo: '',
  priority: 0,
  dim: 0,
  transition: 'none',
  mapX: 0,
  mapY: 0,
  opensOnStart: false,
  ...extra,
});

/** A game with these screens and no built-in menu (a game made in the designer). */
function game(screens: UiScreen[], compat: { backClosesMenus: boolean } = { backClosesMenus: true }): { sim: Simulation; host: RouterHost; opened: string[]; press(...actions: string[]): void; stack(): string[] } {
  const sim = new Simulation(1);
  sim.compat = { ...legacyFlags(), ...compat };
  sim.assets.ui = UiDocSchema.parse({ screens });
  const opened: string[] = [];
  const host: RouterHost = { sim };
  return {
    sim,
    host,
    opened,
    // one tick with these buttons held down, then the screens' share of it, as the game's interface runs it
    press(...actions: string[]) {
      sim.step(Object.fromEntries(actions.map((a) => [a, 1])));
      routeInput(host);
    },
    stack: () => [...sim.runtime.ui.stack],
  };
}

const idle = (g: ReturnType<typeof game>, ticks = 3): void => {
  for (let i = 0; i < ticks; i++) g.press();
};

describe('Back on the screens you made', () => {
  it('goes back from a modal screen to the Pause under it, and not on to a second Pause', () => {
    const g = game([screen('Hud'), screen('Pause', { modal: true }), screen('Settings', { modal: true })]);
    openScreen(g.sim, 'Hud');
    openScreen(g.sim, 'Pause');
    openScreen(g.sim, 'Settings');
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Hud', 'Pause']);
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Hud']); // Pause closed, and it did not open again by itself
    idle(g);
    expect(g.stack()).toEqual(['Hud']);
  });

  it('pops Inventory (a modal screen) and does NOT open Pause (the ui-showcase sample)', () => {
    const doc = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../samples/ui-showcase/assets/screens.json'), 'utf8')) as unknown;
    const sim = new Simulation(1);
    sim.assets.ui = UiDocSchema.parse(doc);
    const host: RouterHost = { sim };
    const step = (...a: string[]): void => {
      sim.step(Object.fromEntries(a.map((x) => [x, 1])));
      routeInput(host);
    };
    const inventory = sim.assets.ui.screens.find((s) => /inventory/i.test(s.name))!;
    expect(inventory.modal).toBe(true);
    openStartScreens(sim);
    step();
    openScreen(sim, inventory.name);
    step();
    step();
    step('pause');
    expect(sim.runtime.ui.stack).not.toContain(inventory.name);
    expect(sim.runtime.ui.stack).not.toContain('Pause');
  });

  it('closes a custom Pause with Back, and it stays closed', () => {
    const g = game([screen('Hud', { opensOnStart: true }), screen('Pause', { modal: true })]);
    openStartScreens(g.sim);
    idle(g);
    g.press('pause'); // nothing is open but the HUD: Pause opens
    expect(g.stack()).toEqual(['Hud', 'Pause']);
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Hud']);
    idle(g, 5);
    expect(g.stack()).toEqual(['Hud']);
  });

  it('closes a custom Pause that does not freeze the game (it was impossible to close with Back before)', () => {
    const g = game([screen('Pause', { modal: false })]);
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Pause']);
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual([]);
  });

  it('a screen that does not block input can be left with Back when it says so', () => {
    const g = game([screen('Note', { back: 'close' }), screen('Pause', { modal: true })]);
    openScreen(g.sim, 'Note');
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual([]); // closed, and Pause did not open in the same tick
  });

  it('a heads-up display does not eat Back: the pause button still opens Pause', () => {
    const g = game([screen('Hud', { opensOnStart: true }), screen('Pause', { modal: true })]);
    openStartScreens(g.sim);
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Hud', 'Pause']);
  });

  it('a custom Title cannot be backed out of, but a Settings opened over it goes back to it', () => {
    const g = game([screen('Title', { modal: true, opensOnStart: true }), screen('Settings', { modal: true })]);
    openStartScreens(g.sim);
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Title']);
    openScreen(g.sim, 'Settings');
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Title']);
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Title']);
  });

  it('the gamepad Start button is the same Back', () => {
    const map = new InputMap(DEFAULT_INPUT_MAP);
    expect(map.resolve({ 'pad:button9': 1 }).pause).toBe(1);
    const g = game([screen('Pause', { modal: true }), screen('Settings', { modal: true })]);
    openScreen(g.sim, 'Pause');
    openScreen(g.sim, 'Settings');
    idle(g);
    g.sim.step(map.resolve({ 'pad:button9': 1 }));
    routeInput(g.host);
    expect(g.stack()).toEqual(['Pause']);
  });

  it('follows each screen\'s own Back setting: close, a chosen screen, nothing', () => {
    const g = game([
      screen('Hub', { modal: true }),
      screen('Shop', { modal: true, back: 'screen', backTo: 'Hub' }),
      screen('Locked', { modal: true, back: 'nothing' }),
      screen('Wizard', { modal: true, back: 'close' }),
    ]);
    openScreen(g.sim, 'Shop');
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Hub']);
    openScreen(g.sim, 'Locked');
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Hub', 'Locked']);
    expect(g.sim.runtime.ui.last?.result).toContain('keeps Back for itself');
    openScreen(g.sim, 'Wizard'); // opened last, so on top; "close" closes it and anything opened from it
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Hub', 'Locked']);
  });

  it('offers Back to the screen with the highest priority first', () => {
    const g = game([screen('Low', { modal: true }), screen('High', { modal: true, priority: 5 })]);
    openScreen(g.sim, 'High');
    openScreen(g.sim, 'Low'); // on top, but lower priority
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Low']);
    expect(g.sim.runtime.ui.last?.by).toBe('High');
  });

  it('a screen that blocks input without freezing the game takes the buttons and the pause key', () => {
    const g = game([screen('Shop', { pauses: false, blocksInput: true }), screen('Pause', { modal: true })]);
    openScreen(g.sim, 'Shop');
    expect(g.sim.runtime.ui.modal).toBe(false);
    expect(g.sim.runtime.ui.blocking).toBe(true);
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual([]); // Back went back from the shop; it did not also open Pause
    openScreen(g.sim, 'Shop');
    idle(g);
    g.sim.step({ move_right: 1 });
    expect(g.sim.input.down('move_right')).toBe(false); // the game's own buttons are off while it is open
    expect(g.sim.uiInput.down('move_right')).toBe(true);
  });

  it('while a conversation or a minigame is up, Back belongs to it and nothing else opens', () => {
    const g = game([screen('Pause', { modal: true })]);
    g.sim.runtime.dialogue = {} as never;
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual([]);
    g.sim.runtime.dialogue = null;
  });

  it('one press is handled once: what takes a press hides it from everything after', () => {
    const g = game([screen('Pause', { modal: true })]);
    g.sim.step({ pause: 1 });
    expect(g.sim.uiInput.pressed('pause')).toBe(true);
    g.sim.uiInput.consume('pause');
    expect(g.sim.uiInput.pressed('pause')).toBe(false);
    expect(g.sim.uiInput.down('pause')).toBe(false);
    g.sim.step({ pause: 1 }); // held: no new press
    expect(g.sim.uiInput.pressed('pause')).toBe(false);
    g.sim.step({});
    g.sim.step({ pause: 1 });
    expect(g.sim.uiInput.pressed('pause')).toBe(true); // the next press is a new one
  });
});

describe('what Back means on a screen', () => {
  it('reads the screen\'s setting, and for "auto" its name and whether it blocks input', () => {
    expect(backAction(screen('Pause', { modal: true }))).toEqual({ kind: 'close' });
    expect(backAction(screen('Pause'))).toEqual({ kind: 'close' });
    expect(backAction(screen('Title', { modal: true }))).toEqual({ kind: 'swallow' });
    expect(backAction(screen('Settings', { modal: true }))).toEqual({ kind: 'previous' });
    expect(backAction(screen('Hud', { role: 'hud' }))).toEqual({ kind: 'pass' });
    expect(backAction(screen('Hud', { opensOnStart: true }))).toEqual({ kind: 'pass' }); // up from the start and takes no buttons: an overlay
    expect(backAction(screen('Backpack'))).toEqual({ kind: 'close' }); // a menu that does not take the buttons: Back closes it (it used to fall through to Pause)
    expect(backAction(screen('Hud', { back: 'close' }))).toEqual({ kind: 'close' });
    expect(backAction(screen('X', { back: 'screen', backTo: 'Y' }))).toEqual({ kind: 'goto', to: 'Y' });
    expect(backAction(screen('X', { back: 'screen' }))).toEqual({ kind: 'previous' });
  });
});

describe('Back on every kind of screen (the owner reported that a menu they made let Esc fall through to Pause)', () => {
  type Role = '' | 'hud' | 'pause' | 'title' | 'inventory';
  type Setting = 'auto' | 'previous' | 'close' | 'screen' | 'nothing' | 'pass';
  /** What Back should do, worked out from the rules in words, not from the code. */
  function expected(o: { blocks: boolean; back: Setting; role: Role; opensOnStart: boolean; backTo: boolean }): string {
    if (o.back === 'close') return 'close';
    if (o.back === 'previous') return 'previous';
    if (o.back === 'screen') return o.backTo ? 'goto' : 'previous';
    if (o.back === 'nothing') return 'swallow';
    if (o.back === 'pass') return 'pass';
    // auto: Pause closes, Title keeps Back, a heads-up display (the role, or a screen that is up from the start and takes nothing) lets it through;
    // any other screen is a menu: one that takes the buttons goes back to what is under it, one that does not closes
    if (o.role === 'pause') return 'close';
    if (o.role === 'title') return 'swallow';
    if (o.role === 'hud') return 'pass';
    if (o.opensOnStart && !o.blocks) return 'pass';
    return o.blocks ? 'previous' : 'close';
  }

  const roles: Role[] = ['', 'hud', 'pause', 'title', 'inventory'];
  const settings: Setting[] = ['auto', 'previous', 'close', 'screen', 'nothing', 'pass'];
  const cases = roles.flatMap((role) => settings.flatMap((back) => [false, true].flatMap((blocks) => [false, true].map((opensOnStart) => ({ role, back, blocks, opensOnStart })))));

  it.each(cases)('role "$role", Back "$back", takes the buttons: $blocks, opens on start: $opensOnStart', ({ role, back, blocks, opensOnStart }) => {
    const s = screen('Some screen', { ...(role ? { role } : {}), back: back as never, backTo: back === 'screen' ? 'Elsewhere' : '', modal: blocks, opensOnStart });
    expect(backAction(s).kind).toBe(expected({ role, back, blocks, opensOnStart, backTo: true }));
  });

  it('Esc on a menu you made (it does not take the buttons) closes it and does not open Pause', () => {
    const g = game([screen('Hud', { role: 'hud', opensOnStart: true }), screen('Backpack'), screen('Pause', { role: 'pause', modal: true })]);
    openStartScreens(g.sim);
    idle(g);
    openScreen(g.sim, 'Backpack');
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Hud']); // closed, and Pause did not open on the same press
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Hud', 'Pause']); // the next press opens it, as it should
  });

  it('a project from before (no backClosesMenus) keeps the older rule: a menu that does not take the buttons lets Esc through to Pause', () => {
    const g = game([screen('Hud', { opensOnStart: true }), screen('Backpack'), screen('Pause', { role: 'pause', modal: true })], { backClosesMenus: false });
    openStartScreens(g.sim);
    idle(g);
    openScreen(g.sim, 'Backpack');
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Hud', 'Backpack', 'Pause']); // as it always was
    expect(backAction(screen('Backpack'), false)).toEqual({ kind: 'pass' });
    expect(backAction(screen('Backpack'), true)).toEqual({ kind: 'close' });
    // the explicit settings mean the same with or without the flag
    expect(backAction(screen('Backpack', { back: 'close' }), false)).toEqual({ kind: 'close' });
    expect(backAction(screen('Backpack', { back: 'pass' }), true)).toEqual({ kind: 'pass' });
  });

  it('a screen that is up from the start and takes nothing (a status bar) lets Esc through; `pass` lets any screen do so', () => {
    const g = game([screen('Status bar', { opensOnStart: true }), screen('Pause', { role: 'pause', modal: true })]);
    openStartScreens(g.sim);
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Status bar', 'Pause']);
    const h = game([screen('Tip', { back: 'pass' }), screen('Pause', { role: 'pause', modal: true })]);
    openScreen(h.sim, 'Tip');
    idle(h);
    h.press('pause');
    expect(h.stack()).toEqual(['Tip', 'Pause']);
  });
});

describe('the pause button as a Quick Action (the pauseAction flag)', () => {
  /** A game where the pause button is the project's own rule, as in every new scene. */
  function ruled(rule = true): ReturnType<typeof game> {
    const g = game([screen('Hud', { opensOnStart: true }), screen('Pause', { modal: true })]);
    addStandardSystems(g.sim, physicsSystem);
    g.sim.compat.pauseAction = true;
    g.host.pauseKeyOpensPause = false;
    if (rule) g.sim.runtime.sheet = [pauseButtonRow()];
    openStartScreens(g.sim);
    idle(g);
    return g;
  }

  it('the row opens Pause once, and the next press closes it: the press that opened it is not also Back', () => {
    const g = ruled();
    g.press('pause');
    expect(g.stack()).toEqual(['Hud', 'Pause']);
    idle(g);
    expect(g.stack()).toEqual(['Hud', 'Pause']);
    g.press('pause');
    expect(g.stack()).toEqual(['Hud']);
    idle(g, 4);
    expect(g.stack()).toEqual(['Hud']);
  });

  it('with the row deleted the button does nothing by itself, but Back still closes what is open', () => {
    const g = ruled(false);
    g.press('pause');
    expect(g.stack()).toEqual(['Hud']);
    openScreen(g.sim, 'Pause');
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Hud']);
  });

  it('the older projects keep the older rule: no flag, no row, the button opens Pause by itself', () => {
    const g = game([screen('Pause', { modal: true })]);
    idle(g);
    g.press('pause');
    expect(g.stack()).toEqual(['Pause']);
  });
});
