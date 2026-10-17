import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodePng, encodePng } from '../packages/runtime/src/sprites/png';
import { clickCell, createProjectViaUi, launchEditor, pickTool, shot } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

/** The colour on the screen at a point of the page (from a screenshot of a small area). */
async function colourAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const clip = { x: Math.max(0, Math.round(x) - 2), y: Math.max(0, Math.round(y) - 2), width: 5, height: 5 };
  const png = decodePng(new Uint8Array(await page.screenshot({ clip })));
  const i = (2 * 5 + 2) * 4;
  return [png.rgba[i]!, png.rgba[i + 1]!, png.rgba[i + 2]!];
}

test('M15: a PNG becomes a tile, covers the top of the floor in the world, and a missing sprite is reported', async () => {
  test.setTimeout(150_000);
  // a 64 x 32 tile picture: pure red on the left half, pure blue on the right (the flat colour it averages to is purple)
  const rgba = new Uint8ClampedArray(64 * 32 * 4);
  for (let i = 0; i < 64 * 32; i++) rgba.set(i % 64 < 32 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-e2e-'));
  const png = path.join(base, 'floor.png');
  fs.writeFileSync(png, encodePng(64, 32, rgba));
  const { page, app, errors } = await launchEditor(base, { TILEWRIGHT_TEST_IMPORT: png });
  await createProjectViaUi(page, 'Art Game', 'empty-iso');

  // ---- import it as a tile through the Tiles panel ----
  await tab(page, 'Tiles').click();
  await page.getByTestId('tile-import-png').click();
  await expect(page.getByTestId('tile-floor')).toBeVisible();
  await expect(page.getByTestId('tile-floor').getByTestId('tile-art-thumb')).toBeVisible();
  const tiles = await page.evaluate(() => window.__store!.state.project!.project.tileset);
  const floor = tiles.find((t) => t.name === 'floor')!;
  expect(floor).toMatchObject({ art: 'floor', top: 0x800080 });
  expect(tiles.length).toBeGreaterThan(6); // the built-in tiles came along

  // ---- paint with it: the screen shows the picture, not the flat colour ----
  await page.getByTestId('tile-floor').click();
  await pickTool(page, 'paint');
  await page.getByTestId('view-grid').count(); // (the grid is faint either way)
  await clickCell(page, 6, 6);
  const at = await page.evaluate(() => window.__viewport!.cellToClient(6, 6));
  const zoom = await page.evaluate(() => window.__viewport!.renderer.camera.zoom);
  const [lr, , lb] = await colourAt(page, at.x - 12 * zoom, at.y);
  const [rr, , rb] = await colourAt(page, at.x + 12 * zoom, at.y);
  expect(lr).toBeGreaterThan(180); // the red half of the picture is on the left
  expect(lb).toBeLessThan(80);
  expect(rb).toBeGreaterThan(180); // and the blue half on the right
  expect(rr).toBeLessThan(80);
  await page.screenshot({ path: shot('m15-tile-art.png') });

  // ---- take the art away: the flat colour is the same here, so check the tile's data and the panel ----
  await page.getByTestId('tile-art-sprite').selectOption('');
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.tileset.find((t) => t.name === 'floor')!.art)).toBeUndefined();
  await expect(page.getByTestId('tile-floor').getByTestId('tile-art-thumb')).toHaveCount(0);
  await page.getByTestId('tile-art-sprite').selectOption('floor');
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.tileset.find((t) => t.name === 'floor')!.art)).toBe('floor');

  // ---- a tile whose sprite is gone is reported by the project check ----
  await page.evaluate(() => {
    const p = window.__store!.state.project!;
    const tileset = p.project.tileset.map((t) => (t.name === 'floor' ? { ...t, art: 'Vanished' } : t));
    return window.__store!.updateTiles(tileset, p.project.autotile);
  });
  const problems = await page.evaluate(async () => (await window.__store!.checkWholeProject()).map((p) => p.message));
  expect(problems.join('\n')).toMatch(/covered by the sprite "Vanished", which is not in this project/);
  expect(errors).toEqual([]);
  await app.close();
});
