import { expect, test, type Page } from '@playwright/test';
import { clickCell, createProjectViaUi, launchEditor, pickTool, shot } from './helpers';
import { addTableRow, loadSampleGame, makeTable, saveSample, setText, tab } from './sample-helpers';
import { swapRows } from '@tilewright/behaviors';

const outline = (page: Page, name: string) => page.getByTestId(`ui-outline-${name}`);
const add = (page: Page, type: string) => page.getByTestId(`ui-palette-${type}`).click();

async function newScreen(page: Page, name: string, o: { modal?: boolean; start?: boolean } = {}): Promise<void> {
  await page.getByTestId('ui-new-screen-name').fill(name);
  await page.getByTestId('ui-new-screen').click();
  await expect(page.getByTestId(`ui-screen-${name}`)).toBeVisible();
  if (o.modal) await page.getByTestId('ui-screen-modal').check();
  if (o.start) await page.getByTestId('ui-screen-start').check();
}

/** A column of widgets in a panel pinned to a place on the picture. */
async function column(page: Page, name: string, anchor: string): Promise<void> {
  await add(page, 'panel');
  await setText(page, 'ui-name', name);
  await page.getByTestId(`ui-anchor-${anchor}`).click();
  await page.getByTestId('ui-layout').selectOption('column');
  await page.getByTestId('ui-align').selectOption('stretch');
}

async function button(page: Page, parent: string, name: string, text: string, action?: string, params: Record<string, string> = {}): Promise<void> {
  await outline(page, parent).click();
  await add(page, 'button');
  await setText(page, 'ui-name', name);
  await setText(page, 'ui-text', text);
  if (!action) return;
  await page.getByTestId('ui-on-click-add').selectOption(action);
  for (const [k, v] of Object.entries(params)) {
    const f = page.getByTestId(`ui-on-click-p0-${k}`);
    if ((await f.evaluate((el) => el.tagName)) === 'SELECT') await f.selectOption(v);
    else await setText(page, `ui-on-click-p0-${k}`, v);
  }
}

/** A gamepad as the browser reports it, with the given buttons held (the engine reads the real Gamepad API). */
async function pad(page: Page, held: number[]): Promise<void> {
  await page.evaluate((buttons) => {
    const mk = () => ({ id: 'Test pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: buttons.includes(i), touched: buttons.includes(i), value: buttons.includes(i) ? 1 : 0 })) });
    (navigator as unknown as { getGamepads: () => unknown[] }).getGamepads = () => [mk()];
  }, held);
}

/**
 * Sample 7 of Phase 2: every screen of a small game, made in the UI designer with nothing but widgets, bindings, actions and one
 * Quick Action: title, settings (sliders and key remapping), pause, a HUD bound to variables, and an inventory grid from a data table
 * with drag-and-drop. Played with the mouse, the keyboard and a (simulated) gamepad; checked at four picture shapes.
 */
test('Phase 2 sample: UI showcase - title, settings, pause, bound HUD, inventory grid; mouse, keyboard and gamepad; four picture shapes', async () => {
  test.setTimeout(600_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'UI Showcase', 'empty-iso');

  // ---- the inventory is a table of slots ----
  await tab(page, 'Data').click();
  await makeTable(page, 'Bag', [['name', 'text'], ['count', 'number']]);
  for (const [id, name, count] of [['s1', 'Potion', '3'], ['s2', 'Sword', '1'], ['s3', 'Brass key', '1'], ['s4', 'Bread', '5'], ['s5', 'Torch', '2'], ['s6', '', '0']] as const) await addTableRow(page, 'Bag', { id, name, count });

  // ---- numbers the HUD shows ----
  await tab(page, 'Events').click();
  await page.locator('.events-panel details summary').first().click();
  for (const [i, n, v] of [[0, 'hp', '7'], [1, 'hpMax', '10'], [2, 'gold', '12']] as const) {
    await page.getByTestId('add-variable').click();
    await setText(page, `var-value-${i}`, v); // the value first: renaming a variable rebuilds its row
    await setText(page, `var-name-${i}`, n);
  }

  // ---- a chest in the world: clicking it opens the inventory (a Quick Action, no event sheet) ----
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption('clickable');
  await clickCell(page, 20, 12);

  await page.getByTestId('btn-ws-ui').click();

  // ---- Title ----
  await newScreen(page, 'Title', { modal: true, start: true });
  await column(page, 'TitleMenu', 'c');
  await add(page, 'text');
  await setText(page, 'ui-name', 'Name');
  await setText(page, 'ui-text', 'The Last Storytender');
  await button(page, 'TitleMenu', 'NewGame', 'New game', 'uiScreen', { op: 'close', screen: 'Title' });
  await button(page, 'TitleMenu', 'LoadGame', 'Load game', 'loadGame');
  await button(page, 'TitleMenu', 'Options', 'Settings');
  await button(page, 'TitleMenu', 'QuitGame', 'Quit', 'quitGame');

  // ---- Settings: sliders, a tick box, a key to remap ----
  await newScreen(page, 'Settings', { modal: true });
  await column(page, 'SettingsBox', 'c');
  await add(page, 'text');
  await setText(page, 'ui-name', 'SettingsTitle');
  await setText(page, 'ui-text', 'Settings');
  for (const [name, key] of [['Music', 'settings.music'], ['Effects', 'settings.sfx']] as const) {
    await outline(page, 'SettingsBox').click();
    await add(page, 'slider');
    await setText(page, 'ui-name', name);
    await page.getByTestId('ui-bind-value').click();
    await page.getByTestId('bind-search').fill(key);
    await page.getByTestId(`bind-item-${key}`).click();
    await setText(page, 'ui-max', '1');
    await setText(page, 'ui-step', '0.1');
  }
  await outline(page, 'SettingsBox').click();
  await add(page, 'toggle');
  await setText(page, 'ui-name', 'Fps');
  await setText(page, 'ui-text', 'Show frame rate');
  await setText(page, 'ui-value', 'settings.showFps');
  await outline(page, 'SettingsBox').click();
  await add(page, 'keybind');
  await setText(page, 'ui-name', 'JumpKey');
  await setText(page, 'ui-text', 'jump');
  await button(page, 'SettingsBox', 'SettingsBack', 'Back', 'uiScreen', { op: 'back' });

  // the title's Settings button opens it
  await page.getByTestId('ui-screen-Title').click();
  await outline(page, 'Options').click();
  await page.getByTestId('ui-on-click-add').selectOption('uiScreen');
  await page.getByTestId('ui-on-click-p0-screen').selectOption('Settings');

  // ---- Pause: the reserved name, opened by the pause key ----
  await newScreen(page, 'Pause', { modal: true });
  await column(page, 'PauseBox', 'c');
  await add(page, 'text');
  await setText(page, 'ui-name', 'PauseTitle');
  await setText(page, 'ui-text', 'Paused');
  await button(page, 'PauseBox', 'Resume', 'Resume', 'uiScreen', { op: 'back' });
  await button(page, 'PauseBox', 'PauseSettings', 'Settings', 'uiScreen', { screen: 'Settings' });
  await button(page, 'PauseBox', 'MainMenu', 'Main menu', 'uiScreen', { op: 'closeAll' });

  // ---- Inventory: a grid of the table's slots; cells can be dragged onto each other ----
  await newScreen(page, 'Inventory', { modal: true });
  await column(page, 'BagBox', 'c');
  await page.getByTestId('ui-wmode').selectOption('fixed');
  await setText(page, 'ui-w', '470');
  await page.getByTestId('ui-hmode').selectOption('fixed');
  await setText(page, 'ui-h', '330');
  await add(page, 'text');
  await setText(page, 'ui-name', 'BagTitle');
  await setText(page, 'ui-text', 'Your bag');
  await outline(page, 'BagBox').click();
  await add(page, 'grid');
  await setText(page, 'ui-name', 'Slots');
  await page.getByTestId('ui-source').selectOption('table:Bag');
  await setText(page, 'ui-columns', '3');
  await page.getByTestId('ui-drag').check();
  await page.getByTestId('ui-wmode').selectOption('fixed');
  await setText(page, 'ui-w', '420');
  await add(page, 'panel');
  await setText(page, 'ui-name', 'Slot');
  await page.getByTestId('ui-layout').selectOption('column');
  await setText(page, 'ui-w', '130');
  await page.getByTestId('ui-hmode').selectOption('fixed');
  await setText(page, 'ui-h', '80');
  await add(page, 'text');
  await setText(page, 'ui-name', 'SlotName');
  await setText(page, 'ui-text', '{row.name}');
  await add(page, 'text');
  await setText(page, 'ui-name', 'SlotCount');
  await setText(page, 'ui-text', 'x{row.count}');
  await outline(page, 'Slot').click();
  await page.getByTestId('ui-prefab-name').fill('SlotCell');
  await page.getByTestId('ui-prefab-make').click();
  await outline(page, 'Slots').click();
  await page.getByTestId('ui-template').selectOption('SlotCell');
  await outline(page, 'SlotCell').click();
  await page.getByTestId('ui-delete').click();
  await button(page, 'BagBox', 'BagClose', 'Close', 'uiScreen', { op: 'back' });

  // ---- HUD: a bar for health, gold, a Bag button ----
  await newScreen(page, 'HUD', { start: true });
  await column(page, 'HudBox', 'tl');
  await add(page, 'bar');
  await setText(page, 'ui-name', 'Health');
  await setText(page, 'ui-value', 'hp');
  await setText(page, 'ui-max', '{hpMax}');
  await outline(page, 'HudBox').click();
  await add(page, 'text');
  await setText(page, 'ui-name', 'Gold');
  await setText(page, 'ui-text', 'Gold {gold}   Health {hp}/{hpMax}');
  await button(page, 'HudBox', 'Bag', 'Bag', 'uiScreen', { screen: 'Inventory' });

  // ---- a chest that opens the bag: the clickable's Quick Action ----
  await page.getByTestId('btn-ws-world').click();
  await pickTool(page, 'select');
  const chest = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Button')!.id);
  await page.evaluate((i) => window.__store!.select([i]), chest);
  await tab(page, 'Inspector').click();
  await page.getByTestId('qa-add').selectOption({ label: 'Open a screen' });
  await page.getByTestId('qa-list-clickable.clicked-p0-screen').selectOption('Inventory');
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- four picture shapes: nothing falls off the edge ----
  await page.getByTestId('btn-ws-ui').click();
  for (const screen of ['Title', 'Settings', 'Pause', 'Inventory', 'HUD']) {
    await page.getByTestId(`ui-screen-${screen}`).click();
    for (const ratio of ['16:9', '16:10', '21:9', '4:3']) {
      await page.getByTestId('ui-resolution').selectOption(ratio);
      await expect(page.getByTestId('ui-stage')).toHaveAttribute('data-res', ratio);
      await expect(page.getByTestId('ui-problems'), `${screen} at ${ratio}`).toContainText('No problems');
    }
    await page.getByTestId('ui-resolution').selectOption('16:9');
  }
  await page.getByTestId('btn-ws-world').click();

  // ---- play with the keyboard: the title opens first; arrows and Enter reach Settings ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await expect(page.getByTestId('tw-screen-Title')).toBeVisible();
  await page.screenshot({ path: shot('p2-ui-title.png') });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // keys go to the game, not to the toolbar button just clicked
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(120);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('tw-screen-Settings')).toBeVisible();
  // ---- with a gamepad: the pad's right button on the first slider moves it ----
  await page.keyboard.press('ArrowDown'); // focus the first widget (the Music slider)
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('tilewright.settings') ?? '{}').music ?? 1);
  await pad(page, [14]); // d-pad left
  await page.waitForTimeout(250);
  await pad(page, []);
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('tilewright.settings') ?? '{}').music ?? 1);
  expect(after).toBeLessThan(before);
  await page.screenshot({ path: shot('p2-ui-settings.png') });
  // ---- with the mouse: Back, then New game ----
  await page.getByTestId('tw-ui-SettingsBack').click();
  await expect(page.getByTestId('tw-screen-Settings')).toHaveCount(0);
  await page.getByTestId('tw-ui-NewGame').click();
  await expect(page.getByTestId('tw-screen-Title')).toHaveCount(0);
  await expect(page.getByTestId('tw-screen-HUD')).toContainText('Gold 12   Health 7/10');
  // pause: the key opens the Pause screen, Resume goes back
  await page.keyboard.press('p'); // (Esc stops the game in the editor; P is the pause key too)
  await expect(page.getByTestId('tw-screen-Pause')).toBeVisible();
  await page.getByTestId('tw-ui-Resume').click();
  await expect(page.getByTestId('tw-screen-Pause')).toHaveCount(0);
  // the bag: the HUD button opens it; a cell dragged onto another swaps them
  await page.getByTestId('tw-ui-Bag').click();
  await expect(page.getByTestId('tw-screen-Inventory')).toContainText('Potion');
  const cells = page.locator('[data-testid="tw-screen-Inventory"] [data-testid="tw-ui-item"]');
  const a = await cells.nth(0).boundingBox();
  const b = await cells.nth(1).boundingBox();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__play!.sim.assets.tables.get('Bag')!.rows.slice(0, 2).map((r) => r.name))).toEqual(['Sword', 'Potion']);
  await page.screenshot({ path: shot('p2-ui-inventory.png') });
  await page.getByTestId('tw-ui-BagClose').click();
  expect(await page.evaluate(() => window.__store!.state.runtimeError)).toBeNull();
  await page.getByTestId('btn-stop').click();

  const dir = await saveSample(page, 'ui-showcase');
  expect(errors).toEqual([]);
  await app.close();

  // ---- the bot reads and presses the same screens ----
  const { game, bot } = await loadSampleGame(dir);
  bot.wait(0.3);
  expect(bot.screenText()).toEqual(expect.arrayContaining(['The Last Storytender', 'New game', 'Settings']));
  expect(bot.pressWidget('Settings')).toBe(true);
  expect(bot.screenText()).toContain('Show frame rate');
  expect(bot.pressWidget('Back')).toBe(true);
  expect(bot.pressWidget('New game')).toBe(true);
  expect(bot.screenText().join(' ')).toContain('Gold 12   Health 7/10');
  expect(bot.pressWidget('Bag')).toBe(true);
  expect(bot.screenText()).toEqual(expect.arrayContaining(['Potion', 'Sword', 'Brass key']));
  expect(swapRows(game.sim, 'Bag', 's3', 's6')).toBe(true);
  bot.wait(0.1);
  expect(game.sim.assets.tables.get('Bag')!.rows.find((r) => r.id === 's6')!.name).toBe('Brass key');
  expect(bot.pressWidget('Close')).toBe(true);
  expect(bot.pressWidget('Nothing at all')).toBe(false);
});
