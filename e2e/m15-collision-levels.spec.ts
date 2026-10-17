import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { clickCell, createProjectViaUi, launchEditor, pickTool, shot } from './helpers';

const band = (page: Page, x: number, y: number) =>
  page.evaluate(([cx, cy]) => {
    const m = window.__store!.doc!.map;
    return { flag: (m.getFlags(cx!, cy!) & 2) !== 0, band: m.getBlockBand(cx!, cy!) };
  }, [x, y]);

test('M15: a blocker can cover every height or only some levels, shown as a walker at any height would meet it, and it is saved with the scene', async () => {
  test.setTimeout(120_000);
  const { page, app, errors, workDir } = await launchEditor();
  await createProjectViaUi(page, 'Levels', 'empty-iso');

  // ---- the default blocker covers every height ----
  await pickTool(page, 'block');
  await expect(page.getByTestId('opt-block-all')).toBeChecked();
  await expect(page.getByTestId('opt-block-from')).toHaveCount(0);
  await clickCell(page, 10, 10);
  expect(await band(page, 10, 10)).toEqual({ flag: true, band: null });

  // ---- a low wall: levels 0 and 1 only ----
  await page.getByTestId('opt-block-all').click();
  await expect(page.getByTestId('opt-block-all')).not.toBeChecked();
  await page.getByTestId('opt-block-to').fill('2');
  await clickCell(page, 12, 10);
  expect(await band(page, 12, 10)).toEqual({ flag: true, band: { low: 0, high: 2 } });

  // ---- an overhead one: only levels 3 and 4 ----
  await page.getByTestId('opt-block-to').fill('5');
  await page.getByTestId('opt-block-from').fill('3');
  await clickCell(page, 14, 10);
  expect(await band(page, 14, 10)).toEqual({ flag: true, band: { low: 3, high: 5 } });

  // ---- the same cells seen by walkers at different heights ----
  await page.locator('.dv-tab').getByText('Layers', { exact: true }).click();
  await page.getByTestId('view-collision').click();
  await page.getByTestId('view-collision-level').selectOption('4');
  expect(await page.evaluate(() => window.__store!.state.view.collisionLevel)).toBe(4);
  await page.getByTestId('view-collision-level').selectOption('auto');
  expect(await page.evaluate(() => window.__store!.state.view.collisionLevel)).toBeNull();
  await expect(page.getByTestId('collision-legend')).toContainText('other heights');
  await page.screenshot({ path: shot('m15-collision-levels.png') });

  // ---- Shift clears it, undo brings it back, save writes it ----
  await page.keyboard.down('Shift');
  await clickCell(page, 12, 10);
  await page.keyboard.up('Shift');
  expect(await band(page, 12, 10)).toEqual({ flag: false, band: null });
  await page.keyboard.press('Control+z');
  expect(await band(page, 12, 10)).toEqual({ flag: true, band: { low: 0, high: 2 } });
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty')).toHaveText('Saved');
  const saved = JSON.parse(fs.readFileSync(path.join(workDir, 'Levels', 'scenes', 'main.scene.json'), 'utf8'));
  expect(saved.map.blockHigh[10][12]).toBe(2);
  expect(saved.map.blockLow[10][14]).toBe(3);
  expect(saved.map.blockHigh[10][10]).toBe(0);
  expect(errors).toEqual([]);
  await app.close();
});
