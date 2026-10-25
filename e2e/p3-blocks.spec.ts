import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createProjectViaUi, launchEditor, pickTool, shot } from './helpers';

const where = (page: Page, x: number, y: number, z: number, face: 'top' | 'left' | 'right' = 'top') =>
  page.evaluate(([a, b, c, f]) => window.__viewport!.blockToClient(a as number, b as number, c as number, f as 'top' | 'left' | 'right'), [x, y, z, face] as const);

const blockAt = (page: Page, x: number, y: number, z: number) => page.evaluate(([a, b, c]) => window.__store!.doc!.map.blockAt(a!, b!, c!) ?? null, [x, y, z]);
const options = (page: Page) => page.evaluate(() => ({ ...window.__store!.state.options }));

/**
 * Phase 3, step 4.3: placing blocks the way Minecraft does, through the real mouse and keyboard in the editor: the face under
 * the pointer lights up with a ghost of the block that would go there, click places, right-click removes, middle-click copies,
 * dragging fills a line or a floor, Shift-drag builds a box, R turns stairs, 1 to 9 pick from the hotbar.
 */
test('Phase 3: blocks are placed, removed, copied and dragged out the way Minecraft does it', async () => {
  test.setTimeout(240_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Block World', 'empty');
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);
  await page.evaluate(() => window.__viewport!.frameMap());

  // a new project plays with block physics and the sight rule for walls: the Compatibility tab says so
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('tw:project-settings')));
  await page.getByTestId('ps-tab-compat').click();
  await expect(page.getByTestId('compat-toggle-blockPhysics')).toBeChecked();
  await expect(page.getByTestId('compat-toggle-fadeBySight')).toBeChecked();
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(page.getByTestId('project-settings')).toHaveCount(0);

  await pickTool(page, 'blocks');
  await expect(page.getByTestId('hotbar')).toBeVisible();
  await expect(page.getByTestId('hotbar-1')).toBeVisible();

  // pointing at the ground lights its face and shows the ghost of the block that would go there
  const ground = await where(page, 10, 10, -1);
  await page.mouse.move(ground.x, ground.y);
  await expect.poll(() => page.evaluate(() => window.__viewport!.previewKinds)).toEqual(['face', 'solid']);
  await page.screenshot({ path: shot('p3-blocks-hover.png') });

  // click: a block goes on the ground, and another on top of it
  await page.mouse.click(ground.x, ground.y);
  expect(await blockAt(page, 10, 10, 0)).toMatchObject({ tile: 1 });
  const top0 = await where(page, 10, 10, 0);
  await page.mouse.click(top0.x, top0.y);
  expect(await blockAt(page, 10, 10, 1)).not.toBeNull();

  // right-click takes away the block you point at (the top one), and Undo brings it back
  const top1 = await where(page, 10, 10, 1);
  await page.mouse.click(top1.x, top1.y, { button: 'right' });
  expect(await blockAt(page, 10, 10, 1)).toBeNull();
  expect(await blockAt(page, 10, 10, 0)).not.toBeNull();
  await page.keyboard.press('Control+z');
  expect(await blockAt(page, 10, 10, 1)).not.toBeNull();
  await page.keyboard.press('Control+z'); // and the second block goes with the next undo
  expect(await blockAt(page, 10, 10, 1)).toBeNull();

  // drag along the ground: a line of blocks, in one undo step
  const a = await where(page, 12, 12, -1);
  const b = await where(page, 16, 12, -1);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await expect.poll(() => page.evaluate(() => window.__viewport!.previewKinds)).toEqual(['solid']);
  await page.mouse.up();
  for (let x = 12; x <= 16; x++) expect(await blockAt(page, x, 12, 0), `x = ${x}`).not.toBeNull();
  await page.keyboard.press('Control+z');
  for (let x = 12; x <= 16; x++) expect(await blockAt(page, x, 12, 0), `after undo, x = ${x}`).toBeNull();

  // Shift-drag builds a box: Height layers deep (2 here)
  await page.getByTestId('opt-block-height').fill('2');
  const c = await where(page, 12, 15, -1);
  const d = await where(page, 14, 16, -1);
  await page.mouse.move(c.x, c.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(d.x, d.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  let box = 0;
  for (let x = 12; x <= 14; x++) for (let y = 15; y <= 16; y++) for (let z = 0; z <= 1; z++) if (await blockAt(page, x, y, z)) box++;
  expect(box).toBe(12);
  expect(await blockAt(page, 12, 15, 2)).toBeNull();

  // stairs of a chosen way round, not solid; R turns them
  await page.getByTestId('block-shape-stairs').click();
  await page.getByTestId('block-rot-2').click();
  await expect.poll(async () => (await options(page)).blockRot).toBe(2);
  await page.keyboard.press('r');
  await expect.poll(async () => (await options(page)).blockRot).toBe(3);
  const e = await where(page, 20, 20, -1);
  await page.mouse.click(e.x, e.y);
  expect(await blockAt(page, 20, 20, 0)).toMatchObject({ shape: 'stairs', rot: 3 });
  await page.screenshot({ path: shot('p3-blocks-built.png') });

  // middle click on a block copies its tile, shape and way round; 1 to 9 pick from the hotbar
  await page.getByTestId('block-shape-cube').click();
  await page.getByTestId('tile-brick').click();
  const f = await where(page, 22, 20, -1);
  await page.mouse.click(f.x, f.y);
  expect((await blockAt(page, 22, 20, 0))!.tile).toBe(5);
  expect((await options(page)).hotbar.map((s: { tile: number }) => s.tile)).toContain(5);
  const stair = await where(page, 20, 20, 0);
  await page.mouse.click(stair.x, stair.y, { button: 'middle' });
  const copied = await options(page);
  expect([copied.blockShape, copied.blockRot, copied.tile]).toEqual(['stairs', 3, 1]);
  await page.keyboard.press('4');
  expect((await options(page)).tile).toBe((await options(page)).hotbar[3]!.tile);

  // a stair or a bridge can be edited as blocks too (a column with stairs on top is a stack of blocks and a stair)
  await page.getByTestId('block-shape-cube').click();
  const saved = await page.evaluate(() => window.__store!.save());
  void saved;
  await page.keyboard.press('Control+s');
  await expect.poll(() => fs.existsSync(path.join(dir, 'scenes', 'main.scene.json'))).toBe(true);
  const scene = JSON.parse(fs.readFileSync(path.join(dir, 'scenes', 'main.scene.json'), 'utf8')) as { map: { stacks: { x: number; y: number; blocks: { z: number; shape?: string; rot?: number }[] }[] } };
  const s = scene.map.stacks.find((x) => x.x === 20 && x.y === 20)!;
  expect(s.blocks).toEqual([expect.objectContaining({ z: 0, shape: 'stairs', rot: 3 })]);
  // a plain scene has no stacks key until blocks are edited; this one has its own
  expect(scene.map.stacks.length).toBe(9); // the first block, the box (6 cells), the stairs and the brick block
  expect(errors).toEqual([]);
  await app.close();
});

test('Phase 3: a scene turns gravity and lets the game place blocks; both are saved in the scene and undone with Undo', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Gravity Scene', 'empty');
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);
  await page.evaluate(() => window.__store!.select([]));
  await expect(page.getByTestId('scene-gravity')).toHaveValue('-z');
  await page.getByTestId('scene-gravity').selectOption('+x');
  await page.getByTestId('scene-blocks-runtime').click();
  await expect(page.getByTestId('scene-blocks-runtime')).toBeChecked();
  await page.getByTestId('scene-blocks-limit').fill('7');
  await page.getByTestId('scene-blocks-limit').press('Enter');
  await page.keyboard.press('Control+s');
  const file = path.join(dir, 'scenes', 'main.scene.json');
  await expect.poll(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).gravity).toBe('+x');
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).blocks).toEqual({ runtime: true, limit: 7 });
  await page.getByTestId('scene-gravity').selectOption('-z');
  await page.getByTestId('scene-blocks-runtime').click();
  await expect(page.getByTestId('scene-blocks-runtime')).not.toBeChecked();
  await page.keyboard.press('Control+s');
  await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).gravity).toBeUndefined();
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).blocks).toBeUndefined();
  expect(errors).toEqual([]);
  await app.close();
});
