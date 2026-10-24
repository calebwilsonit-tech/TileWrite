import { expect, test, type Page } from '@playwright/test';
import { launchEditor, shot, ui } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

async function press(page: Page, snapshot: Record<string, number>, ticks: number): Promise<void> {
  await page.evaluate(
    ({ snapshot, ticks }) => {
      window.__store!.set({ paused: true });
      const r = window.__play!.runner;
      r.paused = true;
      r.inputSource = () => snapshot;
      for (let i = 0; i < ticks; i++) r.step();
    },
    { snapshot, ticks },
  );
  await page.waitForTimeout(60);
}

const playerColor = (page: Page) =>
  page.evaluate(() => window.__play!.sim.world.withTag('player')[0]!.get<{ color: number }>('sprite')!.color);

test('M15: a skin made in the Story panel is offered in Settings -> Appearance and recolours the player', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  await page.getByTestId('sample-last-storytender').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  await page.evaluate(() => localStorage.removeItem('tilewright.settings'));

  await tab(page, 'Story').click();
  await page.getByTestId('story-tab-skins').click();
  await page.getByTestId('skin-new-name').fill('Crimson');
  await page.getByTestId('skin-new').click();
  await expect(page.getByTestId('skin-crimson')).toBeVisible();
  await page.getByTestId('skin-color-crimson').fill('#cc2222');
  // a second skin that is locked until a flag is set
  await page.getByTestId('skin-new-name').fill('Golden');
  await page.getByTestId('skin-new').click();
  await page.getByTestId('skin-unlock-golden').selectOption('variable');
  await page.getByTestId('skin-var-golden').fill('won');
  await page.getByTestId('skin-var-golden').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__store!.skins.map((s) => s.id))).toEqual(['crimson', 'golden']);
  await page.screenshot({ path: shot('m15-skins-panel.png') });

  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await press(page, {}, 2);
  const original = await playerColor(page);

  await press(page, { pause: 1 }, 1);
  await ui(page, 'Settings').click();
  const looks = ui(page, 'Appearance choice').locator('select');
  await expect(looks.locator('option:checked')).toHaveText('Original');
  await expect(looks.locator('option')).toHaveText(['Original', 'Crimson']); // Golden is locked: not on offer
  await looks.selectOption({ label: 'Crimson' });
  expect(await playerColor(page)).toBe(0xcc2222);
  await looks.selectOption({ label: 'Original' });
  expect(await playerColor(page)).toBe(original);

  // unlock it by setting the flag; now it is on offer
  await page.evaluate(() => (window.__play!.sim.runtime.vars['won'] = true));
  await expect(looks.locator('option')).toHaveText(['Original', 'Crimson', 'Golden']);
  await looks.selectOption({ label: 'Golden' });
  await expect(looks.locator('option:checked')).toHaveText('Golden');
  expect(errors).toEqual([]);
  await app.close();
});
