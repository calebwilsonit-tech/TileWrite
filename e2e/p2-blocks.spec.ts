import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';

const block = (page: Page, x: number, y: number, z: number, face: 'top' | 'left' | 'right') => page.evaluate(([a, b, c, f]) => window.__viewport!.blockToClient(a as number, b as number, c as number, f as 'top' | 'left' | 'right'), [x, y, z, face] as const);

async function clickBlock(page: Page, x: number, y: number, z: number, face: 'top' | 'left' | 'right', mods: ('Shift' | 'Alt')[] = []): Promise<void> {
  const p = await block(page, x, y, z, face);
  await page.mouse.move(p.x, p.y);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of mods) await page.keyboard.up(m);
}

const runs = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => window.__store!.doc!.map.runs(a!, b!).map((r) => `${r.bottom}-${r.top}:${r.tile}`), [x, y]);

test('Phase 2: single blocks are edited at any height: gaps for arches, a window block mid-wall, a face of its own, slicing, undo, saving', async () => {
  test.setTimeout(180_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Block Game', 'empty');
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);

  // a brick wall three levels high along y = 12 (cells 8..16)
  await page.getByTestId('tile-brick').click();
  await pickTool(page, 'cliff');
  await page.getByTestId('opt-height').fill('3');
  await dragCells(page, [8, 12], [16, 12]);
  expect(await runs(page, 12, 12)).toEqual(['0-3:5']);

  await pickTool(page, 'blocks');
  // an arch: take out the two lowest blocks of one cell by their left (south-facing) faces
  await page.getByTestId('block-mode-delete').click();
  await clickBlock(page, 12, 12, 0, 'left');
  expect(await runs(page, 12, 12)).toEqual(['1-3:5']);
  await clickBlock(page, 12, 12, 1, 'left');
  expect(await runs(page, 12, 12)).toEqual(['2-3:5']);
  expect(await page.evaluate(() => ({ h: window.__store!.doc!.map.getHeight(12, 12), s: window.__store!.doc!.map.surfaces(12, 12) }))).toEqual({ h: 0, s: [0, 3] });

  // a window: change the middle block of the next cell's wall to wood, and give its south face stone
  await page.getByTestId('block-mode-replace').click();
  await page.getByTestId('tile-wood').click();
  await clickBlock(page, 13, 12, 1, 'left');
  expect(await runs(page, 13, 12)).toEqual(['0-3:5']); // still one solid run (a wall), the middle block is wood
  expect(await page.evaluate(() => window.__store!.doc!.map.blockAt(13, 12, 1)!.tile)).toBe(6);
  await page.getByTestId('block-mode-face').click();
  await page.getByTestId('tile-stone').click();
  await clickBlock(page, 13, 12, 1, 'left');
  expect(await page.evaluate(() => window.__store!.doc!.map.blockAt(13, 12, 1)!.faces)).toEqual({ s: 2 });

  // add a block on top of the wall (click the top face), and one floating beside the arch (against a side face)
  await page.getByTestId('block-mode-add').click();
  await page.getByTestId('tile-brick').click();
  await clickBlock(page, 14, 12, 2, 'top');
  expect(await runs(page, 14, 12)).toEqual(['0-4:5']);
  await clickBlock(page, 15, 12, 2, 'left');
  expect(await runs(page, 15, 13)).toEqual(['2-3:5']); // a balcony piece with nothing under it
  await page.screenshot({ path: shot('p2-blocks-edit.png') });

  // undo brings the column back, one step at a time
  await page.keyboard.press('Control+z');
  expect(await runs(page, 15, 13)).toEqual([]);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  expect(await runs(page, 12, 12)).toEqual(['1-3:5']);
  await page.keyboard.press('Control+z');
  expect(await runs(page, 12, 12)).toEqual(['0-3:5']);
  expect(await page.evaluate(() => window.__store!.doc!.map.stacks.size)).toBe(0);
  // redo is there too
  await page.keyboard.press('Control+y');
  expect(await runs(page, 12, 12)).toEqual(['1-3:5']);
  await page.keyboard.press('Control+y');
  expect(await runs(page, 12, 12)).toEqual(['2-3:5']);

  // slicing: only the blocks below level 2 are shown; x-ray fades the world
  await page.locator('.dv-tab').getByText('Layers', { exact: true }).click();
  const tilesBefore = await page.evaluate(() => window.__viewport!.renderer.stats().tiles);
  await page.getByTestId('view-slice').fill('1');
  await page.getByTestId('view-slice').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__viewport!.renderer.stats().tiles)).not.toBe(tilesBefore);
  await page.screenshot({ path: shot('p2-blocks-slice.png') });
  await page.getByTestId('view-slice').fill('0');
  await page.getByTestId('view-slice').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__viewport!.renderer.stats().tiles)).toBe(tilesBefore);

  // saved in the scene file, and the scene opens again with the same blocks
  await page.getByTestId('btn-save').click();
  const file = path.join(dir, 'scenes', 'main.scene.json');
  await expect.poll(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).map.stacks?.length).toBeGreaterThan(0);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')).map.stacks as { x: number; y: number; blocks: { z: number }[] }[];
  expect(saved.find((s) => s.x === 12 && s.y === 12)!.blocks.map((b) => b.z)).toEqual([2]);
  await page.evaluate(() => window.__store!.closeProject());
  await page.evaluate((d) => window.__store!.openRecent(d), dir);
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  expect(await runs(page, 12, 12)).toEqual(['2-3:5']);

  // and it plays (nothing to control in this project, the picture just draws)
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.waitForTimeout(400);
  await page.getByTestId('btn-stop').click();
  expect(errors).toEqual([]);
  await app.close();
});
