import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from '../packages/runtime/src/sprites/png';
import { createProjectViaUi, launchEditor, shot } from './helpers';

/** Page position of a point in sprite pixel coordinates (a pixel's middle is x + 0.5; the grid lines are whole numbers). */
const at = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([a, b]) => window.__studioPx!(a! - 0.5, b! - 0.5), [x, y]);

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6);
  await page.mouse.up();
}

async function click(page: Page, x: number, y: number): Promise<void> {
  const p = await at(page, x, y);
  await page.mouse.click(p.x, p.y);
}

const pixel = (page: Page, x: number, y: number): Promise<number> =>
  page.evaluate(([a, b]) => {
    const d = window.__studio!.doc!;
    return d.cel(d.frame, d.layer)[b! * d.width + a!]!;
  }, [x, y]);

const shapes = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__studio!.doc!.shapes())) as Record<string, unknown>[]);

test('M15: draw with vector shapes in the sprite studio, edit them later, and the game still gets plain pixels', async () => {
  test.setTimeout(150_000);
  const { app, page, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Vector Game', 'empty-iso');
  await page.getByTestId('btn-ws-sprites').click();
  await page.getByTestId('sprite-new').click();
  await page.getByTestId('new-sprite-name').fill('logo');
  await page.getByTestId('new-sprite-w').fill('24');
  await page.getByTestId('new-sprite-h').fill('24');
  await page.getByTestId('new-sprite-ok').click();
  await expect(page.getByTestId('studio-title')).toHaveText('logo');
  await page.waitForTimeout(200);

  // ---- a pixel layer refuses shapes, a shape layer refuses pixels ----
  await page.getByTestId('stool-vrect').click();
  await click(page, 5, 5);
  expect(await shapes(page)).toHaveLength(0);
  await page.getByTestId('layer-add-vector').click();
  await expect(page.getByTestId('shape-list')).toBeVisible();
  await page.getByTestId('stool-pencil').click();
  await drag(page, [3, 3], [6, 3]);
  expect(await pixel(page, 4, 3)).toBe(0);

  // ---- a rectangle and an ellipse, dragged with the mouse ----
  await page.getByTestId('stool-vrect').click();
  await page.getByTestId('swatch-3').click();
  await drag(page, [5, 5], [13, 13]);
  expect((await shapes(page))[0]).toMatchObject({ type: 'rect', x: 5, y: 5, w: 8, h: 8, fill: 3, stroke: 0 });
  expect(await pixel(page, 6, 6)).toBe(3);
  expect(await pixel(page, 4, 6)).toBe(0);
  await page.getByTestId('stool-vellipse').click();
  await page.getByTestId('swatch-4').click();
  await drag(page, [15, 15], [23, 23]);
  expect((await shapes(page))[1]).toMatchObject({ type: 'ellipse', cx: 19, cy: 19, rx: 4, ry: 4, fill: 4 });
  expect(await pixel(page, 19, 19)).toBe(4);
  expect(await pixel(page, 15, 15)).toBe(0); // a round shape: the corner of its box is empty

  // ---- a path of three clicks, outline only, finished with Enter ----
  await page.getByTestId('stool-vpath').click();
  await page.getByTestId('vfill').click();
  await expect(page.getByTestId('vfill')).not.toBeChecked();
  await page.getByTestId('swatch-6').click();
  await page.getByTestId('vstroke-color').click();
  await expect(page.getByTestId('vstroke-value')).toHaveText('colour 6');
  await click(page, 2, 20);
  await click(page, 8, 16);
  await click(page, 14, 20);
  await page.keyboard.press('Enter');
  const all = await shapes(page);
  expect(all).toHaveLength(3);
  expect(all[2]).toMatchObject({ type: 'path', fill: 0, stroke: 6, closed: false });
  expect((all[2]!.points as unknown[]).length).toBe(3);
  await page.screenshot({ path: shot('m15-vector-shapes.png') });

  // ---- select and edit: recolour, move, resize ----
  await page.getByTestId('stool-vselect').click();
  await click(page, 9, 9);
  await expect(page.getByTestId('shape-inspector')).toBeVisible();
  await page.getByTestId('swatch-5').click();
  await page.getByTestId('shape-fill-color').click();
  expect(await pixel(page, 9, 9)).toBe(5);
  await drag(page, [9, 9], [11, 8]); // move by (2, -1)
  expect((await shapes(page))[0]).toMatchObject({ x: 7, y: 4 });
  expect(await pixel(page, 14, 5)).toBe(5);
  expect(await pixel(page, 5, 9)).toBe(0);
  // the bottom-right handle of the rectangle (now at 15, 12) stretches it
  await drag(page, [15, 12], [18, 14]);
  expect((await shapes(page))[0]).toMatchObject({ x: 7, y: 4, w: 11, h: 10 });
  await page.getByTestId('shape-radius').fill('4');
  await page.getByTestId('shape-radius').press('Enter');
  expect(await pixel(page, 7, 4)).toBe(0); // the rounded corner
  expect(await pixel(page, 12, 4)).toBe(5);

  // ---- every edit is one undo step ----
  await page.getByTestId('studio-undo').click(); // the corner radius
  expect(await pixel(page, 7, 4)).toBe(5);
  await page.getByTestId('studio-undo').click(); // the resize
  expect((await shapes(page))[0]).toMatchObject({ w: 8, h: 8 });
  await page.getByTestId('studio-redo').click();
  await page.getByTestId('studio-redo').click();
  expect((await shapes(page))[0]).toMatchObject({ w: 11, h: 10, radius: 4 });

  // ---- order, duplicate, delete ----
  await page.getByTestId('shape-row-1').click();
  await page.getByTestId('shape-back').click();
  expect((await shapes(page))[0]).toMatchObject({ type: 'ellipse' });
  await page.getByTestId('shape-dup').click();
  expect(await shapes(page)).toHaveLength(4);
  await page.getByTestId('shape-delete').click();
  expect(await shapes(page)).toHaveLength(3);
  await page.keyboard.press('Delete'); // the key removes the selected shape too
  await page.waitForTimeout(80);

  // ---- save: the file holds the shapes and the pixels; the sheet export draws from the pixels ----
  await page.keyboard.press('Control+s');
  const file = path.join(workDir, 'Vector Game', 'assets', 'sprites', 'logo.sprite.json');
  await expect.poll(() => fs.existsSync(file)).toBe(true);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(saved.layers.map((l: { kind?: string }) => l.kind)).toEqual([undefined, 'vector']);
  const vectorId = saved.layers[1].id as string;
  expect(saved.frames[0].vectors[vectorId].length).toBeGreaterThan(0);
  expect(typeof saved.frames[0].cels[vectorId]).toBe('string');
  await page.getByTestId('sec-export').locator('summary').click();
  await page.getByTestId('export-sheet').click();
  await expect(page.getByTestId('export-result')).toContainText('sheet written');
  const sheet = decodePng(new Uint8Array(fs.readFileSync(path.join(workDir, 'Vector Game', 'assets', 'sprites', 'logo.sheet.png'))));
  expect(sheet.rgba.filter((_, i) => i % 4 === 3).some((a) => a > 0)).toBe(true);

  // ---- turn into pixels: the picture stays, the shapes go ----
  const before = await pixel(page, 12, 5);
  await page.getByTestId('layer-rasterize').click();
  await expect(page.getByTestId('shape-list')).toHaveCount(0);
  expect(await pixel(page, 12, 5)).toBe(before);
  await page.getByTestId('stool-pencil').click();
  await page.getByTestId('swatch-2').click();
  await click(page, 1, 1);
  expect(await pixel(page, 1, 1)).toBe(2); // now an ordinary pixel layer
  expect(errors).toEqual([]);
  await app.close();
});
