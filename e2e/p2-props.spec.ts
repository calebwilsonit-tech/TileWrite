import { expect, test, type Page } from '@playwright/test';
import { clickCell, createProjectViaUi, dragCells, launchEditor, pickTool } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

async function fillCanvas(page: Page, swatch: number): Promise<void> {
  await page.getByTestId(`swatch-${swatch}`).click();
  await page.getByTestId('stool-fill').click();
  const box = await page.getByTestId('studio-canvas').boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

test('Phase 2: tall props with fading canopies, scattered with spacing; wall attachments; boxes of blocks saved as structures and placed turned', async () => {
  test.setTimeout(300_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Prop Game', 'empty-iso');

  // ---- a tree: 2 x 2 footprint, only the trunk blocks, the top 60% fades ----
  await page.getByTestId('btn-ws-sprites').click();
  await page.getByTestId('studio-mode-tile').click();
  await page.getByTestId('ts-preset').selectOption('tree');
  await page.getByTestId('ts-name').fill('oak');
  await page.getByTestId('ts-create').click();
  await fillCanvas(page, 6);
  await page.getByTestId('ts-sec-prop').locator('summary').click();
  await page.getByTestId('ts-col-trunk').click();
  await page.getByTestId('ts-fade-canopy').click();
  await page.getByTestId('studio-save').click();
  const oak = await page.evaluate(() => window.__studio!.assets.get('oak')!.meta!);
  expect(oak.kind).toBe('prop');
  expect(oak.footprint).toEqual({ w: 2, d: 2 });
  expect(oak.collision!.w).toBeCloseTo(0.6);
  expect(oak.fade!.toY).toBeGreaterThan(20);
  expect(oak.fade!.fromY).toBe(0);
  // a second look for variety
  await page.getByTestId('ts-preset').selectOption('tree');
  await page.getByTestId('ts-name').fill('oak2');
  await page.getByTestId('ts-create').click();
  await fillCanvas(page, 7);
  await page.getByTestId('studio-save').click();
  await page.getByTestId('sprite-oak').click();
  await page.getByTestId('ts-pvar-sprite').selectOption('oak2');
  await page.getByTestId('ts-pvar-weight').fill('1');
  await page.getByTestId('ts-pvar-add').click();
  await page.getByTestId('studio-save').click();

  // ---- a window for a wall, with its other side ----
  await page.getByTestId('ts-preset').selectOption('attach-left');
  await page.getByTestId('ts-name').fill('window');
  await page.getByTestId('ts-create').click();
  await fillCanvas(page, 8);
  await page.getByTestId('studio-save').click();
  await page.getByTestId('ts-sec-attach').locator('summary').click();
  await page.getByTestId('ts-other-side').click();
  await expect.poll(() => page.evaluate(() => window.__studio!.assets.has('window_right'))).toBe(true);
  await page.getByTestId('studio-save').click();
  expect(await page.evaluate(() => window.__studio!.assets.get('window')!.meta!.otherSide)).toBe('window_right');

  // ---- place a tree: the footprint is aligned to the grid, and it blocks only its trunk ----
  await page.getByTestId('btn-ws-world').click();
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption('sprite:oak');
  await clickCell(page, 5, 5);
  const placed = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'oak')!.components);
  expect(placed.transform).toMatchObject({ x: 6, y: 6 });
  expect(placed.sprite).toMatchObject({ asset: expect.stringMatching(/^oak/), w: 2, d: 2 });
  expect((placed.collider as { w: number }).w).toBeCloseTo(0.6);

  // ---- scatter props over a field: spaced apart, never on top of each other ----
  await pickTool(page, 'props');
  await page.getByTestId('opt-prefab').selectOption('sprite:oak');
  await page.getByTestId('opt-density').fill('1');
  await page.getByTestId('opt-spacing').fill('3');
  await dragCells(page, [12, 8], [26, 20]);
  const trees = await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.name.startsWith('oak')).map((e) => (e.components.transform as { x: number; y: number })));
  expect(trees.length).toBeGreaterThan(4);
  let closest = Infinity;
  for (let i = 0; i < trees.length; i++) for (let j = i + 1; j < trees.length; j++) closest = Math.min(closest, Math.hypot(trees[i]!.x - trees[j]!.x, trees[i]!.y - trees[j]!.y));
  expect(closest).toBeGreaterThanOrEqual(3 - 1e-6);
  const looks = await page.evaluate(() => new Set(window.__store!.doc!.entities.filter((e) => e.name.startsWith('oak')).map((e) => (e.components.sprite as { asset: string }).asset)).size);
  expect(looks).toBe(2); // the two looks are mixed

  // ---- a hut from a box of blocks ----
  await tab(page, 'Structures').click();
  await pickTool(page, 'blockbox');
  await page.getByTestId('opt-zto').fill('2');
  await dragCells(page, [2, 14], [6, 17]);
  await expect(page.getByTestId('structures-box')).toContainText('5 x 4 cells, levels 0 to 2');
  await tab(page, 'Tiles').click();
  await page.getByTestId('tile-brick').click();
  await tab(page, 'Structures').click();
  await page.getByTestId('box-fill').click();
  const levelsAt = (x: number, y: number) => page.evaluate(([cx, cy]) => window.__store!.doc!.map.getStack(cx!, cy!)?.blocks.map((b) => b.z) ?? [], [x, y]);
  expect(await levelsAt(4, 15)).toEqual([0, 1, 2]);
  await page.getByTestId('box-hollow').click();
  expect(await levelsAt(4, 15)).toEqual([0, 2]); // a room with a floor and a roof
  expect(await levelsAt(2, 15)).toEqual([0, 1, 2]); // a wall
  // a doorway in the front wall: take out the two lower blocks of one wall column
  await dragCells(page, [4, 17], [4, 17]);
  await page.getByTestId('box-z1').fill('1');
  await page.getByTestId('box-z1').press('Enter');
  await page.getByTestId('box-clear').click();
  expect(await levelsAt(4, 17)).toEqual([2]); // an arch: nothing under the lintel

  // ---- a window fixed to the right-hand wall ----
  await pickTool(page, 'attach');
  await page.getByTestId('opt-attachment').selectOption('window');
  const face = await page.evaluate(() => window.__viewport!.blockToClient(6, 15, 1, 'right'));
  await page.mouse.click(face.x, face.y);
  const win = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'window')!.components);
  expect(win.attach).toMatchObject({ face: '+x', cell: { x: 6, y: 15 }, z: 1 });
  expect((win.transform as { x: number }).x).toBeGreaterThan(6.9);
  // Inspector: slide it along the wall
  await tab(page, 'Inspector').click();
  await page.getByTestId('attach-along').fill('0.8');
  await page.getByTestId('attach-along').press('Enter');
  expect(await page.evaluate(() => (window.__store!.doc!.entities.find((e) => e.name === 'window')!.components.attach as { along: number }).along)).toBeCloseTo(0.8);

  // ---- save the hut (with its window) as a structure, place it turned ----
  await tab(page, 'Structures').click();
  await pickTool(page, 'blockbox');
  await page.getByTestId('opt-zfrom').fill('0');
  await page.getByTestId('opt-zto').fill('2');
  await dragCells(page, [2, 14], [6, 17]);
  await page.getByTestId('structure-name').fill('Hut');
  await page.getByTestId('structure-save').click();
  await expect(page.getByTestId('structure-Hut')).toContainText('1 objects');
  await page.getByTestId('structure-Hut').click();
  await page.keyboard.press('r');
  await expect(page.getByTestId('structure-placing')).toContainText('90');
  await clickCell(page, 20, 2);
  // turned: 4 across and 5 deep now
  const turnedBlocks = await page.evaluate(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (window.__store!.doc!.map.getStack(x, y)?.blocks.some((b) => b.z === 2) && x >= 18 && y <= 8) {
          xs.push(x);
          ys.push(y);
        }
    return { w: Math.max(...xs) - Math.min(...xs) + 1, d: Math.max(...ys) - Math.min(...ys) + 1 };
  });
  expect(turnedBlocks).toEqual({ w: 4, d: 5 });
  const windows = await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.name.startsWith('window')).map((e) => (e.components.attach as { face: string; cell: { x: number; y: number } })));
  expect(windows).toHaveLength(2);
  expect(windows[1]!.face).toBe('+y'); // the east window turned to face south
  // one undo takes the whole hut and its window back out
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.name.startsWith('window')).length)).toBe(1);

  // ---- take the wall away: the window is reported as floating, and one click removes it ----
  await pickTool(page, 'blockbox');
  await page.getByTestId('opt-zto').fill('2');
  await dragCells(page, [6, 15], [6, 15]);
  await page.getByTestId('box-clear').click();
  await tab(page, 'Problems').click();
  await expect(page.getByTestId('problems-panel')).toContainText('hangs in the air');
  await page.getByTestId('problem-quickfix').first().click();
  expect(await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.name === 'window').length)).toBe(0);

  expect(errors).toEqual([]);
  await app.close();
});
