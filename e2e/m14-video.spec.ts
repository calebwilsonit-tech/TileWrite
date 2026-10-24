import { expect, test, type Page } from '@playwright/test';
import { launchEditor, ui } from './helpers';

type Snapshot = Record<string, number>;
async function play(page: Page, snapshot: Snapshot, ticks: number): Promise<void> {
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

test('M14: camera zoom and the frame-rate corner are in Settings and apply at once; full screen is only offered to a game in its own window', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  await page.getByTestId('sample-last-storytender').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  await page.evaluate(() => localStorage.removeItem('tilewright.settings'));
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, {}, 2);
  const zoom = () => page.evaluate(() => window.__viewport!.renderer.camera.zoom);
  expect(await zoom()).toBe(1);

  await play(page, { pause: 1 }, 1);
  await ui(page, 'Settings').click();
  await expect(ui(page, 'Full screen tick box')).toBeHidden(); // the editor's own window is never switched
  const zoomSlider = ui(page, 'Camera zoom slider').locator('input');
  await expect(zoomSlider).toHaveValue('1');
  await zoomSlider.fill('1.25');
  await expect.poll(zoom).toBe(1.25);
  await zoomSlider.fill('1.5');
  await expect.poll(zoom).toBe(1.5);
  await zoomSlider.fill('0.75'); // the far view
  await expect.poll(zoom).toBe(0.75);

  await expect(page.getByTestId('tw-fps')).toBeHidden();
  await ui(page, 'Show frame rate tick box').click();
  await expect(page.getByTestId('tw-fps')).toBeVisible();
  await expect(page.getByTestId('tw-fps')).toContainText('fps', { timeout: 5000 });
  await ui(page, 'Show frame rate tick box').click();
  await expect(page.getByTestId('tw-fps')).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tilewright.settings')!).cameraZoom)).toBe(0.75); // remembered
  expect(errors).toEqual([]);
  await app.close();
});
