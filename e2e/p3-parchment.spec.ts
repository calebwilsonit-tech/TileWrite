import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot, ui } from './helpers';

/** Phase 3, step 2: the Parchment UI kit (a plugin that re-skins the game's menus) is turned on in Project settings and the pause menu changes. */
test('Phase 3: the Parchment UI kit gives the pause menu an old-paper look, and turning it off brings the plain one back', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  const key = async (k: string): Promise<void> => {
    await page.waitForTimeout(250);
    await page.keyboard.press(k);
  };
  await createProjectViaUi(page, 'Paper', 'empty');
  await page.evaluate(() => window.__store!.updateProjectSettings({ packs: ['example-parchment-ui'] }));
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await key('p');
  await expect(page.getByTestId('tw-screen-Pause')).toBeVisible();
  const box = page.getByTestId('tw-ui-Pause box');
  await expect(box).toHaveCSS('background-color', 'rgb(232, 217, 181)');
  await expect(ui(page, 'Flourish')).toContainText('\u2726');
  await page.screenshot({ path: shot('p3-parchment-pause.png') });
  await ui(page, 'Resume').click();
  await expect(page.getByTestId('tw-screen-Pause')).toHaveCount(0);
  await page.getByTestId('btn-stop').click();

  await page.evaluate(() => window.__store!.updateProjectSettings({ packs: [] }));
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await key('p');
  await expect(page.getByTestId('tw-ui-Pause box')).not.toHaveCSS('background-color', 'rgb(232, 217, 181)');
  await expect(ui(page, 'Flourish')).toHaveCount(0);
  await page.getByTestId('btn-stop').click();
  expect(errors).toEqual([]);
  await app.close();
});
