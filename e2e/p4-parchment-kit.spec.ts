import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor, screenLayer, shot, ui } from './helpers';

/**
 * Round 2, section 9: the Parchment UI kit is the real thing, built with the designer's general tools: a binder inventory, a parchment
 * map, a pause menu with Travel and Restart pages, a title whose New game picks a difficulty locked for the save, and a heads-up
 * display. Played in the editor, each page is opened, looked at and used.
 */
test('Round 2: the Parchment UI kit plays - binder, map, pause with its pages, title with a locked difficulty, heads-up display', async () => {
  test.setTimeout(240_000);
  const { page, app, errors } = await launchEditor();
  const key = async (k: string): Promise<void> => {
    await page.waitForTimeout(250);
    await page.keyboard.press(k);
  };
  await createProjectViaUi(page, 'Paper', 'empty');
  await page.evaluate(() => window.__store!.updateProjectSettings({ plugins: ['inventory', 'parchment'] }));
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  // a world, items and a story for the pages to show
  await page.evaluate(() => {
    const sim = window.__play!.sim;
    const node = (id: string, label: string, x: number, y: number, unlock: object = { kind: 'always' }) => ({ id, label, scene: `${id}.scene.json`, x, y, icon: 'town', unlock, spawn: '', hidden: false });
    sim.assets.worldMap = { schemaVersion: 1, title: 'The Realm', nodes: [node('hub', 'Hearthwick', 480, 320), node('cave', 'Mossback Cave', 220, 160), node('tower', 'Grey Tower', 800, 130), node('mine', 'Old Mine', 820, 470, { kind: 'variable', name: 'mine', atLeast: 1 })], links: [{ a: 'hub', b: 'cave' }, { a: 'hub', b: 'tower' }, { a: 'hub', b: 'mine' }] } as never;
    sim.runtime.scene = 'hub.scene.json';
    sim.assets.tables.set('Chapters', { name: 'Chapters', columns: [{ id: 'name', type: 'text' }], rows: [{ id: 'c1', name: 'The road to Hearthwick' }, { id: 'c2', name: 'Under the moss' }, { id: 'c3', name: 'The grey tower' }] } as never);
    const items = new Map<string, unknown>([
      ['sword', { id: 'sword', name: 'Iron sword', description: 'Plain and sharp.', color: 0x999999, max: 0, use: { heal: 0, setVariable: 'equip_weapon', setValue: 'Iron sword', consume: false, message: 'You take up the sword.' } }],
      ['bread', { id: 'bread', name: 'Bread', description: 'Tasty.', color: 0xc9964a, max: 0, use: { heal: 2, setVariable: '', setValue: 1, consume: true, message: '' } }],
      ['key', { id: 'key', name: 'Brass key', description: 'Opens a door.', color: 0xc9a227, max: 0 }],
      ['lamp', { id: 'lamp', name: 'Lamp', description: 'Gives light.', color: 0xffe08a, max: 0 }],
      ['map', { id: 'map', name: 'Old map', description: 'Torn at one corner.', color: 0xd9c6a0, max: 0 }],
    ]);
    sim.assets.data.set('items', items as never);
    Object.assign(sim.runtime.vars, { 'item:sword': 1, 'item:bread': 3, 'item:key': 1, 'item:lamp': 1, 'item:map': 1, chapter: 2, equip_head: 'Leather cap', stat_attack: 4, stat_defence: 2, stat_speed: 3 });
    sim.runtime.regions = [{ id: 'r', name: 'The Mossy Hollow', x: 0, y: 0, w: 99, h: 99, cameraBounds: false, music: '', darkness: 0, bossActive: false }];
  });

  // ---- the pause menu: the description follows the chosen row; Travel and Restart are pages ----
  await key('p');
  await expect(screenLayer(page, 'Pause')).toBeVisible();
  await expect(page.getByTestId('tw-ui-Pause box')).toHaveCSS('background-color', 'rgb(232, 217, 181)');
  await ui(page, 'Restart').hover();
  await expect(ui(page, 'Description')).toContainText('Start this area again');
  await page.screenshot({ path: shot('p4-parchment-pause.png') });
  await ui(page, 'Travel').click();
  await expect(screenLayer(page, 'Pause: Travel')).toBeVisible();
  await expect(ui(page, 'Place')).toHaveCount(2); // the place the player is in is not a place to travel to, and the Old Mine is only guessed at
  await expect(ui(page, 'Place').first()).toContainText('Mossback Cave');
  await page.screenshot({ path: shot('p4-parchment-travel.png') });
  await key('p'); // Back (the pause key) goes to the pause menu, not out of it
  await expect(screenLayer(page, 'Pause: Travel')).toHaveCount(0);
  expect(await page.evaluate(() => window.__play!.sim.runtime.ui.stack)).toEqual(['HUD', 'Pause']);
  await expect(screenLayer(page, 'Pause')).toBeVisible();
  await ui(page, 'Restart').click();
  await expect(screenLayer(page, 'Pause: Restart')).toBeVisible();
  await page.screenshot({ path: shot('p4-parchment-restart.png') });
  await ui(page, 'No, keep playing').click();
  await expect(screenLayer(page, 'Pause: Restart')).toHaveCount(0);

  // ---- the binder ----
  await ui(page, 'Inventory').click();
  await expect(screenLayer(page, 'Inventory')).toBeVisible();
  await expect(ui(page, 'Paper doll')).toBeVisible();
  await expect(page.locator('[data-testid="tw-ui-Item card"]')).toHaveCount(5);
  await page.locator('[data-testid="tw-ui-Item card"]').first().hover();
  await expect(ui(page, 'Chosen item')).toBeVisible();
  await page.locator('[data-testid="tw-ui-Item card"]', { hasText: 'Iron sword' }).click();
  await expect(page.locator('[data-testid="tw-ui-Chosen mark"]:visible')).toHaveCount(1);
  await expect(page.locator('[data-testid="tw-ui-Slot"]', { hasText: 'Iron sword' })).toBeVisible();
  await page.screenshot({ path: shot('p4-parchment-binder.png') });

  // ---- the map ----
  await key('p'); // Back from the binder: the pause menu, which lists the map
  await expect(screenLayer(page, 'Inventory')).toHaveCount(0);
  await page.locator('[data-testid="tw-ui-Entry"]', { hasText: 'Map' }).click();
  await expect(screenLayer(page, 'Map')).toBeVisible();
  await expect(page.getByTestId('tw-pmark-hub')).toHaveAttribute('data-look', 'here');
  await expect(page.getByTestId('tw-pmark-cave')).toHaveAttribute('data-look', 'lit');
  await expect(page.getByTestId('tw-pmark-mine')).toHaveAttribute('data-look', 'unknown'); // guessed at, not found
  await expect(page.locator('[data-testid="tw-ui-Chapter"]')).toHaveCount(2); // the third chapter has not been reached
  await page.screenshot({ path: shot('p4-parchment-map.png') });
  await key('p');
  await key('p');
  await expect(screenLayer(page, 'Pause')).toHaveCount(0);

  // ---- the heads-up display ----
  await page.evaluate(() => Object.assign(window.__play!.sim.runtime.vars, { gold: 37, prompt: 'Press E to open the door', boss_name: 'The Warden', boss_hp: 30, boss_max: 60, narrator: 'The wind carried a name across the hollow.' }));
  await page.evaluate(() => window.__play!.sim.events.emit('message', { text: 'You found a brass key.' }));
  await page.waitForTimeout(500);
  await expect(ui(page, 'Boss bar')).toBeVisible();
  await expect(ui(page, 'Narrator')).toBeVisible();
  await expect(page.locator('.tw-slip', { hasText: 'brass key' })).toBeVisible();
  await page.screenshot({ path: shot('p4-parchment-hud.png') });
  await page.getByTestId('btn-stop').click();

  // ---- the title: New game picks a difficulty that is then locked for the save ----
  await page.evaluate(() => window.__store!.updateProjectSettings({ title: { enabled: true, subtitle: 'a small trial' } }));
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await expect(screenLayer(page, 'Title')).toBeVisible();
  await expect(page.getByTestId('tw-ui-Title box')).toHaveCSS('background-color', 'rgb(232, 217, 181)');
  await ui(page, 'New game').click();
  await expect(screenLayer(page, 'Title: New game')).toBeVisible();
  await page.screenshot({ path: shot('p4-parchment-new-game.png') });
  await ui(page, 'Hard').click();
  await expect(screenLayer(page, 'Title')).toHaveCount(0);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars.difficulty_locked)).toBe(1);
  expect(await page.evaluate(() => window.__play!.sim.runtime.difficulty)).toBe('hard');
  await page.getByTestId('btn-stop').click();
  expect(errors).toEqual([]);
  await app.close();
});
