import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

async function steps(page: Page, ticks: number): Promise<void> {
  await page.evaluate((ticks) => {
    window.__store!.set({ paused: true });
    const r = window.__play!.runner;
    r.paused = true;
    r.inputSource = () => ({});
    for (let i = 0; i < ticks; i++) r.step();
  }, ticks);
  await page.waitForTimeout(80);
}

test('M15: the lantern is a resource: it burns down, its bar is on the screen and its glow shrinks', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Lantern Game', 'starter-room');
  const playerId = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.tags.includes('player'))!.id);
  await page.evaluate((id) => window.__store!.select([id]), playerId);
  await tab(page, 'Inspector').click();
  await page.getByTestId('add-behavior').selectOption('lightResource');
  await page.getByTestId('add-behavior-ok').click();
  await expect(page.getByTestId('behavior-lightResource')).toBeVisible();
  await expect(page.getByTestId('behavior-light')).toBeVisible(); // it brings the Light it shrinks
  await page.getByTestId('behavior-lightResource').locator('[data-testid="bf-burn"]').fill('10');
  await page.getByTestId('behavior-lightResource').locator('[data-testid="bf-burn"]').press('Enter');
  expect(await page.evaluate((id) => (window.__store!.doc!.getEntity(id)!.components.lightResource as { burn: number }).burn, playerId)).toBe(10);

  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await steps(page, 3);
  await expect(page.getByTestId('tw-lightbar')).toBeVisible();
  const width = () => page.getByTestId('tw-lightbar').locator('.fill').evaluate((e) => parseFloat((e as HTMLElement).style.width));
  const start = await width();
  expect(start).toBeGreaterThan(90);
  await steps(page, 300); // five seconds at 10 a second
  const half = await width();
  expect(half).toBeLessThan(start - 35);
  expect(half).toBeGreaterThan(30);
  const radius = () => page.evaluate(() => window.__play!.sim.world.withTag('player')[0]!.get<{ radius: number }>('light')!.radius);
  const mid = await radius();
  await steps(page, 600);
  expect(await radius()).toBeLessThan(mid);
  await expect(page.getByTestId('tw-lightbar')).toHaveClass(/low/);
  await page.screenshot({ path: shot('m15-lantern.png') });
  expect(errors).toEqual([]);
  await app.close();
});
