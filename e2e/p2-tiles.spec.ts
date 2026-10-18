import { expect, test, type Page } from '@playwright/test';
import { clickCell, createProjectViaUi, launchEditor, pickTool } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

async function fillCanvas(page: Page): Promise<void> {
  await page.getByTestId('stool-fill').click();
  const box = await page.getByTestId('studio-canvas').boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

test('Phase 2: the tile studio makes a tile from a preset, clips it to the diamond, gives it properties, sends it to the palette and builds an edge set', async () => {
  test.setTimeout(240_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Tile Game', 'empty-iso');
  await page.getByTestId('btn-ws-sprites').click();
  await page.getByTestId('studio-mode-tile').click();

  // ---- a flat floor tile: a canvas the size of one cell with the diamond drawn on it ----
  await page.getByTestId('ts-preset').selectOption('flat');
  await page.getByTestId('ts-name').fill('meadow');
  await page.getByTestId('ts-create').click();
  await expect(page.getByTestId('studio-title')).toContainText('meadow');
  const meta = await page.evaluate(() => window.__studio!.doc!.meta);
  expect(meta).toMatchObject({ kind: 'tile', preset: 'flat' });
  expect(await page.evaluate(() => [window.__studio!.doc!.width, window.__studio!.doc!.height])).toEqual([64, 32]);
  await page.getByTestId('swatch-6').click();
  await fillCanvas(page);
  // everything is green now, including the corners; clipping cuts it to the diamond
  const corner = (): Promise<number> => page.evaluate(() => window.__studio!.doc!.composite(0)[3]!);
  expect(await corner()).toBe(255);
  await page.getByTestId('ts-clip').click();
  expect(await corner()).toBe(0);
  expect(await page.evaluate(() => window.__studio!.doc!.composite(0)[(16 * 64 + 32) * 4 + 3])).toBe(255);
  await page.getByTestId('studio-save').click();

  // ---- how it tiles ----
  await expect(page.getByTestId('ts-tiling-canvas')).toBeVisible();
  const patch = await page.getByTestId('ts-tiling-canvas').evaluate((c) => [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height]);
  expect(patch[0]).toBeGreaterThan(200);
  await page.getByTestId('ts-wrap').check();
  expect(await page.getByTestId('ts-tiling-canvas').evaluate((c) => (c as HTMLCanvasElement).width)).toBe(192);
  await page.getByTestId('ts-wrap').uncheck();

  // ---- properties, then into the palette ----
  await page.getByTestId('ts-tile-name').fill('Meadow');
  await page.getByTestId('ts-tile-name').press('Enter');
  await page.getByTestId('ts-blocks-light').check();
  await page.getByTestId('ts-tags').fill('soft, grass');
  await page.getByTestId('ts-tags').press('Enter');
  await page.getByTestId('ts-custom-key').fill('speed');
  await page.getByTestId('ts-custom-value').fill('1.5');
  await page.getByTestId('ts-custom-add').click();
  await page.getByTestId('ts-send').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.tileset.find((t) => t.name === 'Meadow')?.art)).toBe('meadow');
  const tile = await page.evaluate(() => window.__store!.state.project!.project.tileset.find((t) => t.name === 'Meadow')!);
  expect(tile.props).toEqual({ blocksLight: true, tags: ['soft', 'grass'], custom: { speed: 1.5 } });
  // changing it later updates the same tile (same id), and its water flag reaches the map when the game runs
  await page.getByTestId('ts-water').check();
  await page.getByTestId('ts-send').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.tileset.find((t) => t.name === 'Meadow')?.props?.water)).toBe(true);
  const again = await page.evaluate(() => window.__store!.state.project!.project.tileset.filter((t) => t.name === 'Meadow'));
  expect(again).toHaveLength(1);
  expect(again[0]!.id).toBe(tile.id);

  // ---- an edge set: the 47 pieces, drawn from the base tile and an edge brush ----
  await page.getByTestId('ts-sec-autotile').locator('summary').click();
  await page.getByTestId('ts-set-name').fill('meadow');
  await page.getByTestId('ts-set-name').press('Enter');
  await page.getByTestId('ts-set-base').selectOption({ label: 'Meadow' });
  await page.getByTestId('ts-set-create').click();
  await expect(page.getByTestId('ts-set-missing')).toContainText('47 of 47', { timeout: 60_000 });
  await page.getByTestId('ts-set-starter').click();
  await expect(page.getByTestId('ts-set-missing')).toContainText('Every piece is drawn', { timeout: 60_000 });
  await page.getByTestId('ts-set-apply').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.autotile.length)).toBe(46);
  const variants = await page.evaluate((id) => window.__store!.state.project!.project.tileset.filter((t) => t.group === id).length, tile.id as number);
  expect(variants).toBe(46);

  // ---- paint with it in the world: the edges choose themselves ----
  await page.getByTestId('btn-ws-world').click();
  await tab(page, 'Tiles').click();
  await page.getByTestId('tile-Meadow').click();
  await pickTool(page, 'paint');
  for (const [x, y] of [[8, 8], [9, 8], [8, 9], [9, 9]] as const) await clickCell(page, x, y);
  const tiles = await page.evaluate(() => [0, 1].flatMap((dx) => [0, 1].map((dy) => window.__store!.doc!.map.getTile(8 + dx, 8 + dy))));
  expect(new Set(tiles).size).toBe(4); // four different corner pieces
  expect(errors).toEqual([]);
  await app.close();
});
