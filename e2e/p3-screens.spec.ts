import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { SAMPLES_DIR, tab } from './sample-helpers';

/**
 * Phase 3, step 1, played in the real editor with the real keyboard: with the player's own screens (the ui-showcase
 * sample: Title, Settings, Pause, Inventory and a HUD, all made in the designer), Back goes back one screen, closing
 * Pause leaves it closed, and backing out of the inventory does not drop the player on Pause.
 */
test('Phase 3: Back works on the screens you made (the custom-screen bug)', async () => {
  test.setTimeout(180_000);
  const { page, app, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Scratch', 'empty');
  const copy = path.join(workDir, 'ui-showcase-copy');
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(path.join(SAMPLES_DIR, 'ui-showcase'), copy, { recursive: true });
  await page.evaluate(() => window.__store!.closeProject());
  await page.evaluate((d) => window.tilewright.recent.add(d, 'ui-showcase-copy'), copy);
  await page.evaluate((d) => window.__store!.openRecent(d), copy);
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);

  // the screen settings are in the designer: what Back does, whether the screen pauses the game and takes the buttons
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-screen-Inventory').click();
  await expect(page.getByTestId('ui-screen-back')).toHaveValue('auto');
  await expect(page.getByTestId('ui-screen-modal')).toBeChecked();
  await expect(page.getByTestId('ui-screen-blocks')).toBeChecked();
  await page.getByTestId('ui-screen-back').selectOption('screen');
  await expect(page.getByTestId('ui-screen-back-to')).toBeVisible();
  await page.getByTestId('ui-screen-back').selectOption('auto'); // (put back; this sample stays as it is)
  await page.getByTestId('ui-screen-HUD').click();
  await expect(page.getByTestId('ui-screen-modal')).not.toBeChecked();
  await expect(page.getByTestId('ui-screen-blocks')).not.toBeChecked();
  await page.getByTestId('btn-ws-world').click();

  const stack = (): Promise<string[]> => page.evaluate(() => [...window.__play!.sim.runtime.ui.stack]);
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await expect(page.getByTestId('tw-screen-Title')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.getByTestId('tw-ui-NewGame').click();
  await expect(page.getByTestId('tw-screen-Title')).toHaveCount(0);
  expect(await stack()).toEqual(['HUD']);

  // P is the pause key (Esc stops the game in the editor). It opens Pause, and the next press closes it for good.
  await page.keyboard.press('p');
  await expect(page.getByTestId('tw-screen-Pause')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.getByTestId('tw-screen-Pause')).toHaveCount(0);
  await page.waitForTimeout(400);
  expect(await stack()).toEqual(['HUD']); // it did not open again by itself

  // the bag is a screen of its own: Back leaves it and does NOT land on Pause
  await page.getByTestId('tw-ui-Bag').click();
  await expect(page.getByTestId('tw-screen-Inventory')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.getByTestId('tw-screen-Inventory')).toHaveCount(0);
  await page.waitForTimeout(400);
  expect(await stack()).toEqual(['HUD']);
  await expect(page.getByTestId('tw-screen-Pause')).toHaveCount(0);

  // Pause -> Settings -> Back is Pause again, then Back is the game
  await page.keyboard.press('p');
  await expect(page.getByTestId('tw-screen-Pause')).toBeVisible();
  await page.getByTestId('tw-ui-PauseSettings').click();
  await expect(page.getByTestId('tw-screen-Settings')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.getByTestId('tw-screen-Settings')).toHaveCount(0);
  await expect(page.getByTestId('tw-screen-Pause')).toBeVisible();
  await page.keyboard.press('p');
  await expect(page.getByTestId('tw-screen-Pause')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await stack()).toEqual(['HUD']);

  // the Start button of a gamepad is the same Back
  await page.keyboard.press('p');
  await expect(page.getByTestId('tw-screen-Pause')).toBeVisible();
  await page.evaluate(() => {
    const pad = { index: 0, id: 'test pad', connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 9, touched: i === 9, value: i === 9 ? 1 : 0 })) };
    (navigator as unknown as { getGamepads: () => unknown[] }).getGamepads = () => [pad];
  });
  await page.waitForTimeout(300);
  await expect(page.getByTestId('tw-screen-Pause')).toHaveCount(0);
  await page.evaluate(() => {
    (navigator as unknown as { getGamepads: () => unknown[] }).getGamepads = () => [];
  });

  // the Screens overlay shows the stack and who handled the last press
  await tab(page, 'Layers').click();
  await page.getByTestId('view-screens').check();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('tw-screens-overlay')).toContainText('Screens open: 1');
  await expect(page.getByTestId('tw-screens-overlay')).toContainText('Last press of pause');
  await page.screenshot({ path: shot('p3-screens-overlay.png') });
  await page.getByTestId('view-screens').uncheck();
  await expect(page.getByTestId('tw-screens-overlay')).toHaveCount(0);

  expect(await page.evaluate(() => window.__store!.state.runtimeError)).toBeNull();
  await page.getByTestId('btn-stop').click();
  expect(errors).toEqual([]);
  await app.close();
});
