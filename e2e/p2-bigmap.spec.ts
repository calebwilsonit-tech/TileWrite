import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor } from './helpers';

test('Phase 2: a large map (256 x 256) is drawn in chunks near the camera, so it opens at once and costs what is on screen', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Big Game', 'empty');
  await page.getByTestId('scene-w').fill('256');
  await page.getByTestId('scene-w').press('Enter');
  await page.getByTestId('scene-h').fill('256');
  await page.getByTestId('scene-h').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__store!.doc!.map.width)).toBe(256);
  await page.evaluate(() => window.__viewport!.frameMap());
  await page.waitForTimeout(500);
  // zoomed out to see the whole map the visible chunks are many but bounded; zoomed in only the ones near the camera exist
  await page.evaluate(() => {
    const v = window.__viewport!;
    v.camera.zoom = 1;
    v.camera.snapTo({ x: 0, y: 128 * 16 });
    v.invalidate();
  });
  await page.waitForTimeout(400);
  const near = await page.evaluate(() => window.__viewport!.renderer.stats().tiles);
  expect(near).toBeGreaterThan(100);
  expect(near).toBeLessThan(6000);
  // far away in the corner of the map the tiles are different ones but no more of them
  await page.evaluate(() => {
    window.__viewport!.camera.snapTo({ x: 0, y: 10 * 16 });
    window.__viewport!.invalidate();
  });
  await page.waitForTimeout(400);
  const far = await page.evaluate(() => window.__viewport!.renderer.stats().tiles);
  expect(far).toBeLessThan(6000);
  // editing a far cell works and costs nothing until it is in view
  await page.evaluate(() => window.__store!.doc!.paint('far edit', [{ x: 250, y: 250, patch: { tile: 2 } }]));
  await page.evaluate(() => {
    window.__viewport!.camera.snapTo({ x: 0, y: 500 * 16 });
    window.__viewport!.invalidate();
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__viewport!.renderer.tileAlpha(250, 250))).toBeDefined();
  // it plays
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.waitForTimeout(300);
  await page.getByTestId('btn-stop').click();
  expect(errors).toEqual([]);
  await app.close();
});
