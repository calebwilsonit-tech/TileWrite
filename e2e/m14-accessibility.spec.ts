import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor, pickTool, shot } from './helpers';

test('M14: text size, colour-blind-safe overlay colours and less motion are one dialog away, apply at once and are remembered', async () => {
  test.setTimeout(150_000);
  const first = await launchEditor();
  const { page } = first;
  const width0 = await page.evaluate(() => window.innerWidth);

  // available from the very first screen
  await page.getByTestId('btn-access').click();
  await expect(page.getByTestId('accessibility-dialog')).toBeVisible();
  await page.getByTestId('acc-zoom').selectOption('1.5');
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(width0 * 0.75); // everything is 1.5 times bigger
  await page.getByTestId('acc-colourblind').check();
  await page.getByTestId('acc-motion').check();
  await page.getByTestId('acc-close').click();
  expect(await page.evaluate(() => document.documentElement.classList.contains('reduce-motion'))).toBe(true);

  // the overlays change colour with the editor open
  await createProjectViaUi(page, 'Access Game', 'starter-room');
  expect(await page.evaluate(() => (window as unknown as { __palette: { walkable: number; blocked: number } }).__palette)).toMatchObject({ walkable: 0x56b4e9, blocked: 0xd55e00 });
  await page.locator('.dv-tab', { hasText: 'Layers' }).click();
  await page.getByTestId('view-collision').check();
  await pickTool(page, 'walktest');
  await expect(page.getByTestId('collision-legend')).toContainText('light blue walk');
  await page.screenshot({ path: shot('m14-accessibility.png') });
  await page.getByTestId('view-collision').uncheck();
  await pickTool(page, 'select');

  // the dialog is also on the toolbar, and each change is undone as easily
  await page.getByTestId('btn-access').click();
  await page.getByTestId('acc-colourblind').uncheck();
  expect(await page.evaluate(() => (window as unknown as { __palette: { walkable: number } }).__palette.walkable)).toBe(0x2ec27e);
  await page.getByTestId('acc-colourblind').check();
  await page.getByTestId('acc-close').click();
  await first.app.close();

  // remembered next time
  const again = await launchEditor(first.base);
  await again.page.waitForFunction(() => document.documentElement.classList.contains('reduce-motion'));
  expect(await again.page.evaluate(() => window.innerWidth)).toBeLessThan(width0 * 0.75);
  expect(await again.page.evaluate(() => (window as unknown as { __palette: { walkable: number } }).__palette.walkable)).toBe(0x56b4e9);
  expect(again.errors).toEqual([]);
  await again.app.close();
});
