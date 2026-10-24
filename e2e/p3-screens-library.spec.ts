import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectViaUi, launchEditor } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

/**
 * Phase 3, step 2: a screen you made from a plugin's is an ordinary asset, so it can be kept in the personal library and
 * added to another project, where it plays the same part.
 */
test('Phase 3: a customized pause menu is saved to the library and used in another project', async () => {
  test.setTimeout(150_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-screenlib-'));
  const { page, app, errors } = await launchEditor(undefined, { TILEWRIGHT_LIBRARY: path.join(tmp, 'library') });
  const key = async (k: string): Promise<void> => {
    await page.waitForTimeout(250);
    await page.keyboard.press(k);
  };

  await createProjectViaUi(page, 'Screens A', 'empty');
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-plugin-screen-prebuilt-pause-customize').click();
  await page.getByTestId('ui-outline-Resume').click();
  await page.getByTestId('ui-outline-Label').first().click();
  await page.getByTestId('ui-text').fill('Carry on');
  await page.getByTestId('ui-text').press('Enter');
  await page.getByTestId('btn-ws-world').click();

  await tab(page, 'Library').click();
  await page.getByTestId('library-save-kind').selectOption('ui');
  await page.getByTestId('library-pick-Screen: Pause').check();
  await page.getByTestId('library-save-name').fill('My pause menu');
  await page.getByTestId('library-save-go').click();
  await expect(page.getByTestId('library-save-message')).toContainText('version 1');
  await expect(page.getByTestId('library-item-my-pause-menu')).toBeVisible();

  // another project has the plugin's pause menu until the library's is added
  await page.evaluate(() => window.__store!.closeProject());
  await createProjectViaUi(page, 'Screens B', 'empty');
  await tab(page, 'Library').click();
  await page.getByTestId('library-add-my-pause-menu').click();
  await expect(page.getByTestId('library-add-contents')).toContainText('Pause');
  await page.getByTestId('library-add-confirm').click();
  await expect(page.getByTestId('library-add-result')).toContainText('Added "My pause menu"');
  await page.getByTestId('btn-ws-ui').click();
  await expect(page.getByTestId('ui-screen-Pause')).toBeVisible();
  await expect(page.getByTestId('ui-plugin-screen-prebuilt-pause-state')).toContainText('with your changes'); // it remembers it is a changed copy of the plugin's
  await page.getByTestId('btn-ws-world').click();
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await key('p');
  await expect(page.getByTestId('tw-ui-Resume')).toContainText('Carry on');
  await page.getByTestId('btn-stop').click();
  expect(errors).toEqual([]);
  await app.close();
});
