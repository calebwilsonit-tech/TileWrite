import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';

/**
 * Round 2, step 7.1: the plugin manager says what will stop working before a plugin is turned off, and an object that carries the
 * settings of a plugin that is not on shows them (kept, and with a button to turn the plugin on).
 */
test('Round 2: turning a plugin off says what stops working; the Inspector shows the settings of a plugin that is off', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Manager', 'empty');
  await page.evaluate(() => window.__store!.updateProjectSettings({ plugins: ['inventory'] }));
  await page.evaluate(() => {
    const doc = window.__store!.doc!;
    doc.addEntities([
      { name: 'Coin', tags: [], components: { transform: { x: 3.5, y: 3.5, h: 0, facing: 0 }, pickup: { item: 'key' } } },
      { name: 'Coin 2', tags: [], components: { transform: { x: 5.5, y: 3.5, h: 0, facing: 0 }, pickup: { item: 'key' } } },
    ]);
  });

  await page.getByTestId('btn-project-settings').click();
  await page.getByTestId('ps-tab-packs').click();
  // nothing stops working with a plugin nothing uses: it goes off at once
  await expect(page.getByTestId('pack-toggle-inventory')).toBeChecked();
  await page.getByTestId('pack-toggle-inventory').click();
  await expect(page.getByTestId('plugin-stops')).toBeVisible();
  await expect(page.getByTestId('plugin-stops')).toContainText('2 objects with the behaviour pickup');
  await page.screenshot({ path: shot('p4-plugin-stops.png') });

  // "Keep it" leaves everything as it was
  await page.getByTestId('plugin-stops-keep').click();
  await expect(page.getByTestId('plugin-stops')).toHaveCount(0);
  expect(await page.evaluate(() => window.__store!.state.project!.project.plugins)).toEqual(['inventory']);

  // "Turn it off anyway" does it, and keeps what the objects carry
  await page.getByTestId('pack-toggle-inventory').click();
  await page.getByTestId('plugin-stops-go').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.plugins)).toEqual([]);
  expect(await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.components.pickup !== undefined).length)).toBe(2);

  // the Inspector shows what the plugin that is off left on the object, and offers to turn it on
  await page.getByTestId('ps-tab-game').click();
  await page.getByTestId('ps-game').getByRole('button', { name: 'Close' }).click();
  await page.evaluate(() => window.__store!.select([window.__store!.doc!.entities.find((e) => e.name === 'Coin')!.id]));
  await expect(page.getByTestId('insp-missing-plugin-data')).toContainText('pickup');
  await page.getByTestId('missing-pickup').locator('summary').click();
  await expect(page.getByTestId('missing-pickup')).toContainText('"item": "key"');
  await page.getByTestId('turn-on-inventory').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.plugins)).toEqual(['inventory']);
  expect(errors).toEqual([]);
  await app.close();
});
