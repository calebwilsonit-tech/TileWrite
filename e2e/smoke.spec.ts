import { expect, test } from '@playwright/test';
import { launchEditor, shot } from './helpers';

test('editor window opens and shows the project screen', async () => {
  const { app, page, errors } = await launchEditor();
  await expect(page.getByTestId('project-screen')).toBeVisible();
  await expect(page.locator('h1')).toHaveText('Tilewright');
  await page.screenshot({ path: shot('m0-welcome.png') });
  expect(errors).toEqual([]);
  await app.close();
});
