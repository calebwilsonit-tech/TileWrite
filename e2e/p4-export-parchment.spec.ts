import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectViaUi, launchEditor, shot } from './helpers';

/**
 * Round 2, step 7.2: the Parchment UI kit used to be an example, which the exported game's player did not carry, so a game that used it
 * exported with plain menus. It is a plugin that ships with the editor now; an exported game must show the paper pause menu.
 */
test('Round 2: a game that uses the Parchment UI kit exports with its paper menus', async () => {
  test.setTimeout(600_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Paper', 'empty');
  await page.evaluate(() => window.__store!.updateProjectSettings({ plugins: ['parchment'] }));
  await page.getByTestId('btn-export').click();
  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('export-name').fill('Paper Game');
  await page.getByTestId('export-name').blur();
  await expect(page.getByTestId('export-ready')).toBeVisible();
  await page.getByTestId('export-go').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 300_000 });
  const exe = (await page.getByTestId('export-exe').textContent())!;
  expect(errors).toEqual([]);
  await app.close();
  expect(fs.existsSync(exe)).toBe(true);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-game-'));
  const game = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, TILEWRIGHT_GAME_TEST: '1', TILEWRIGHT_GAME_USERDATA: userData } });
  const gamePage = await game.firstWindow();
  const gameErrors: string[] = [];
  gamePage.on('pageerror', (e) => gameErrors.push(e.message));
  await gamePage.waitForFunction(() => (window as unknown as { __game?: unknown }).__game !== undefined, undefined, { timeout: 60_000 });
  await gamePage.waitForTimeout(500);
  await gamePage.keyboard.press('p');
  await expect(gamePage.getByTestId('tw-screen-Pause')).toBeVisible();
  await expect(gamePage.getByTestId('tw-ui-Pause box')).toHaveCSS('background-color', 'rgb(232, 217, 181)');
  await gamePage.screenshot({ path: shot('p4-export-parchment.png') });
  // the kit's own pages are in the exported game too: the pause menu's Travel row, and the binder with its paper doll
  await expect(gamePage.getByTestId('tw-ui-Travel')).toBeVisible();
  await gamePage.getByTestId('tw-ui-Inventory').first().click();
  await expect(gamePage.getByTestId('tw-screen-Inventory')).toBeVisible();
  await expect(gamePage.getByTestId('tw-ui-Paper doll')).toBeVisible();
  await gamePage.screenshot({ path: shot('p4-export-parchment-binder.png') });
  expect(gameErrors).toEqual([]);
  await game.close();
});
