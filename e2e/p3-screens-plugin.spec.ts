import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';

/**
 * Phase 3, step 2, in the real editor: the game's own screens are ordinary designer screens. A new project plays with the
 * plugin's Pause screen; Customize makes a copy that can be changed, compared with the plugin's and put back; a screen can be
 * given a role; and the game uses the project's own.
 */
test('Phase 3: the pause menu is a designer screen you can customize, compare, revert and replace', async () => {
  test.setTimeout(150_000);
  const { page, app, errors } = await launchEditor();
  const key = async (k: string): Promise<void> => {
    await page.waitForTimeout(250);
    await page.keyboard.press(k);
  };
  await createProjectViaUi(page, 'Menus', 'empty');
  await page.evaluate(() => window.__store!.updateProjectSettings({ packs: ['inventory'] })); // (the inventory button comes with that plugin)
  // the pause button is a Quick Action every new scene starts with, so it can be seen and changed
  await page.locator('.dv-tab').getByText('Events', { exact: true }).click();
  await expect(page.getByText('the "pause" button is pressed').first()).toBeVisible();
  await expect(page.getByText('open the pause screen').first()).toBeVisible();
  await page.getByTestId('btn-ws-ui').click();

  // nothing of its own: the plugin's screens are played as they come
  const pause = page.getByTestId('ui-plugin-screen-prebuilt-pause');
  await expect(pause).toBeVisible();
  await expect(page.getByTestId('ui-plugin-screen-prebuilt-pause-state')).toContainText('just as it comes');
  await expect(page.getByTestId('ui-screen-list').locator('button')).toHaveCount(0);

  // Customize: a copy in the project that plays the Pause role
  await page.getByTestId('ui-plugin-screen-prebuilt-pause-customize').click();
  await expect(page.getByTestId('ui-screen-Pause')).toBeVisible();
  await expect(page.getByTestId('ui-screen-role')).toHaveValue('pause');
  await expect(page.getByTestId('ui-screen-from')).toContainText('prebuilt-pause');
  await expect(page.getByTestId('ui-plugin-screen-prebuilt-pause-state')).toContainText('not changed');

  // change the words of the Resume row
  await page.getByTestId('ui-outline-Resume').click();
  await page.getByTestId('ui-outline-Label').first().click();
  await page.getByTestId('ui-text').fill('Carry on');
  await page.getByTestId('ui-text').press('Enter');
  await expect(page.getByTestId('ui-plugin-screen-prebuilt-pause-state')).toContainText('with your changes');
  await page.getByTestId('ui-plugin-screen-prebuilt-pause-compare').click();
  await expect(page.getByTestId('ui-plugin-screen-prebuilt-pause-diff')).toContainText('Carry on');
  await expect(page.getByTestId('ui-plugin-screen-prebuilt-pause-diff')).toContainText('Resume');
  await page.screenshot({ path: shot('p3-screens-compare.png') });

  // the game plays with the copy
  await page.getByTestId('btn-ws-world').click();
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await key('p');
  await expect(page.getByTestId('tw-screen-Pause')).toBeVisible();
  await expect(page.getByTestId('tw-ui-Resume')).toContainText('Carry on');
  await page.screenshot({ path: shot('p3-screens-custom-pause.png') });
  await page.getByTestId('btn-stop').click();

  // Revert puts the plugin's screen back
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-plugin-screen-prebuilt-pause-revert').click();
  await expect(page.getByTestId('ui-plugin-screen-prebuilt-pause-state')).toContainText('not changed');
  await page.getByTestId('btn-ws-world').click();
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await key('p');
  await expect(page.getByTestId('tw-ui-Resume')).toContainText('Resume');
  await page.getByTestId('btn-stop').click();

  // a screen of your own can be given a part to play: the inventory key opens it
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-new-screen-name').fill('My bag');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-role').selectOption('inventory');
  await expect(page.getByTestId('ui-plugin-screen-prebuilt-inventory-state')).toContainText('Your own screen');
  await page.getByTestId('btn-ws-world').click();
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await key('i');
  await expect(page.getByTestId('tw-screen-My bag')).toBeVisible();
  await page.getByTestId('btn-stop').click();

  // taking the copy away brings the plugin's screen back as the one in use
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-plugin-screen-prebuilt-pause-remove').click();
  await expect(page.getByTestId('ui-plugin-screen-prebuilt-pause-state')).toContainText('just as it comes');
  expect(errors).toEqual([]);
  await app.close();
});
