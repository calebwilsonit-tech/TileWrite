import { describe, expect, it } from 'vitest';
import { C, type TransformIso } from '@tilewright/runtime';
import { openScreens, walkView, type ViewNode } from '@tilewright/behaviors';
import type { Game } from '@tilewright/playbot';
import { parseRoom } from '../src/model';
import { RoomBot } from '../src/replay';
import { scenePath } from '../src/scene';
import { Rules, solve } from '../src/solver';
import { CHAPTERS, gameOn, project } from './helpers';

/**
 * The flow of DESIGN.md, section 5, walked with what a player can press: the rows of the menus, Back, the walking keys,
 * Interact and Restart. Nothing here reaches into the game to change it.
 */
const defs = CHAPTERS.flatMap((c) => c.rooms);
const up = (g: Game): string[] => openScreens(g.sim).map((s) => s.screen.name);
const menus = (g: Game): string[] => up(g).filter((n) => n !== 'HUD');
const texts = (g: Game): string[] => {
  const out: string[] = [];
  for (const { view } of openScreens(g.sim)) walkView(view, (n) => void (n.visible && n.text.trim() && out.push(n.text)));
  return out;
};
const cards = (g: Game): ViewNode[] => {
  const out: ViewNode[] = [];
  for (const { screen, view } of openScreens(g.sim)) if (screen.name === 'Rooms') walkView(view, (n) => void (n.node.name === 'Room card' && out.push(n)));
  return out;
};
const back = (bot: RoomBot): void => {
  bot.step({ pause: 1 });
  bot.wait(3);
};
const playRoom = (bot: RoomBot, index: number): void => {
  const out = solve(new Rules(parseRoom(defs[index]!)))!;
  for (const a of out.actions) expect(bot.act(a), `room ${defs[index]!.id}`).toBe('');
  bot.wait(6);
};

describe('the flow of the game', () => {
  it('starts on the title, and How to play and Settings lead back to it', async () => {
    const g = gameOn(await project(), scenePath(defs[0]!.id), { title: true });
    const bot = new RoomBot(g);
    bot.wait(4);
    expect(menus(g)).toEqual(['Title']);
    expect(g.sim.runtime.ui.modal, 'the garden waits behind the title').toBe(true);
    expect(texts(g)).toContain('New game');
    expect(texts(g), 'no Continue before there is a save').not.toContain('Continue');
    expect(bot.press('How to play')).toBe(true);
    expect(menus(g)).toEqual(['Title', 'How to play']);
    expect(bot.press('Back')).toBe(true);
    expect(menus(g)).toEqual(['Title']);
    expect(bot.press('Settings')).toBe(true);
    expect(menus(g)).toEqual(['Title', 'Settings']);
    expect(bot.press('Controls')).toBe(true);
    expect(menus(g)).toEqual(['Title', 'Settings', 'Controls']);
    back(bot);
    expect(menus(g)).toEqual(['Title', 'Settings']);
    back(bot);
    expect(menus(g)).toEqual(['Title']);
    back(bot);
    expect(menus(g), 'Back does nothing on the title').toEqual(['Title']);
  });

  it('New game shows the chapter card once, then the room with its heads-up display', async () => {
    const g = gameOn(await project(), scenePath(defs[0]!.id), { title: true });
    const bot = new RoomBot(g);
    bot.wait(4);
    expect(bot.press('New game')).toBe(true);
    bot.wait(4);
    expect(menus(g)).toEqual(['Chapter']);
    expect(texts(g)).toContain(CHAPTERS[0]!.name);
    expect(texts(g)).toContain(CHAPTERS[0]!.line);
    expect(bot.press('Go on')).toBe(true);
    expect(menus(g)).toEqual([]);
    expect(g.sim.runtime.ui.modal).toBe(false);
    const hud = texts(g);
    expect(hud).toContain(defs[0]!.name);
    expect(hud).toContain(CHAPTERS[0]!.name);
    expect(hud).toContain(`0 / ${defs.length}`);
    if (defs[0]!.hint) expect(hud).toContain(defs[0]!.hint);
    for (const t of hud) expect(t, 'no unfilled {names} on the heads-up display').not.toMatch(/\{[^}]+\}/);
  });

  it('Pause freezes the room; Rooms shows only the first room open; Back and Resume lead out again', async () => {
    const g = gameOn(await project(), scenePath(defs[0]!.id));
    const bot = new RoomBot(g);
    bot.wait(4);
    bot.dismissMenus();
    bot.wait(4);
    bot.dismissMenus();
    back(bot); // the pause button
    expect(menus(g)).toEqual(['Pause']);
    expect(g.sim.runtime.ui.modal).toBe(true);
    for (const t of texts(g)) expect(t).not.toMatch(/\{[^}]+\}/);
    expect(bot.press('Rooms')).toBe(true);
    expect(menus(g)).toEqual(['Pause', 'Rooms']);
    const list = cards(g);
    expect(list.length).toBe(defs.length);
    expect(list.map((c) => c.enabled)).toEqual(defs.map((_d, i) => i === 0));
    back(bot);
    expect(menus(g)).toEqual(['Pause']);
    expect(bot.press('Resume')).toBe(true);
    expect(menus(g)).toEqual([]);
    expect(g.sim.runtime.ui.modal).toBe(false);
    back(bot);
    expect(menus(g)).toEqual(['Pause']);
    back(bot);
    expect(menus(g), 'the pause button closes the pause menu too').toEqual([]);
  });

  it('R and "Restart room" put the room back as it began', async () => {
    const g = gameOn(await project(), scenePath(defs[0]!.id));
    const bot = new RoomBot(g);
    bot.wait(4);
    bot.dismissMenus();
    bot.wait(4);
    bot.dismissMenus();
    bot.settle();
    const at = (): string => {
      const t = g.player.require<TransformIso>(C.Transform);
      return `${Math.floor(t.x)},${Math.floor(t.y)}`;
    };
    const home = at();
    const first = solve(new Rules(parseRoom(defs[0]!)))!.actions[0]!;
    expect(bot.act(first)).toBe('');
    expect(at()).not.toBe(home);
    bot.step({ restart: 1 });
    bot.wait(10);
    bot.settle();
    expect(at()).toBe(home);
    expect(menus(g), 'no chapter card the second time').toEqual([]);
    expect(bot.act(first)).toBe('');
    back(bot);
    expect(bot.press('Restart room')).toBe(true);
    bot.wait(10);
    bot.settle();
    expect(menus(g)).toEqual([]);
    expect(at()).toBe(home);
  });

  it('finishing a room leads to the next, counts it, opens it on the Rooms screen, and a card takes you back', async () => {
    if (defs.length < 2) return;
    const g = gameOn(await project(), scenePath(defs[0]!.id));
    const bot = new RoomBot(g);
    bot.wait(4);
    bot.dismissMenus();
    bot.wait(4);
    bot.dismissMenus();
    bot.settle();
    playRoom(bot, 0);
    expect(g.scenePath).toBe(scenePath(defs[1]!.id));
    expect(g.problems).toEqual([]);
    bot.wait(6);
    expect(menus(g), 'no chapter card inside a chapter').toEqual([]);
    expect(texts(g)).toContain(defs[1]!.name);
    expect(texts(g)).toContain(`1 / ${defs.length}`);
    back(bot);
    expect(bot.press('Rooms')).toBe(true);
    const list = cards(g);
    expect(list.map((c) => c.enabled)).toEqual(defs.map((_d, i) => i <= 1));
    // the first card shows its tick
    let ticks = 0;
    walkView(list[0]!, (n) => void (n.node.name === 'Tended' && n.visible && ticks++));
    expect(ticks).toBe(1);
    // and takes the gardener back to the first room, leaving every menu
    const { activateWidget } = await import('@tilewright/behaviors');
    activateWidget(g.sim, list[0]!);
    bot.wait(10);
    expect(g.scenePath).toBe(scenePath(defs[0]!.id));
    expect(menus(g)).toEqual([]);
    expect(texts(g)).toContain(defs[0]!.name);
    expect(g.problems).toEqual([]);
  });

  it('the last room ends on "The end", with the totals', async () => {
    const last = defs.length - 1;
    const g = gameOn(await project(), scenePath(defs[last]!.id));
    const bot = new RoomBot(g);
    bot.wait(4);
    bot.dismissMenus();
    bot.wait(4);
    bot.dismissMenus();
    bot.settle();
    playRoom(bot, last);
    bot.wait(6);
    expect(menus(g)).toEqual(['The end']);
    const t = texts(g);
    expect(t).toContain(`1 of ${defs.length}`);
    for (const line of t) expect(line).not.toMatch(/\{[^}]+\}/);
    expect(bot.press('Stay in the garden')).toBe(true);
    expect(menus(g)).toEqual([]);
  });
});
