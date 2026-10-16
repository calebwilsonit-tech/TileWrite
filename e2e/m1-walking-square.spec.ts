import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shot = (name: string): string => path.join(root, 'screenshots', name);

test('M1: the square walks on the tiled floor and the camera follows', async () => {
  const app = await electron.launch({ args: [path.join(root, 'packages', 'editor')] });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.getByTestId('open-sample-m1').click();
  await page.waitForFunction(() => window.__sample !== undefined);
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('m1-start.png') });

  const pos = () =>
    page.evaluate(() => {
      const e = window.__sample!.sim.world.findByName('player')!;
      const t = e.get<{ x: number; y: number }>('transform')!;
      return { x: t.x, y: t.y, tick: window.__sample!.sim.tick };
    });

  const before = await pos();
  await page.keyboard.down('s'); // screen-down = grid (+1,+1)
  await page.waitForTimeout(700);
  await page.keyboard.up('s');
  const after = await pos();
  expect(after.tick).toBeGreaterThan(before.tick);
  expect(after.x).toBeGreaterThan(before.x + 1);
  expect(after.y).toBeGreaterThan(before.y + 1);
  expect(Math.abs(after.x - before.x - (after.y - before.y))).toBeLessThan(0.01); // pure diagonal

  await page.keyboard.down('d'); // screen-right = grid (+1,-1)
  await page.waitForTimeout(700);
  await page.keyboard.up('d');
  const right = await pos();
  expect(right.x).toBeGreaterThan(after.x + 1);
  expect(right.y).toBeLessThan(after.y - 1);

  await page.screenshot({ path: shot('m1-walked.png') });
  expect(errors).toEqual([]);
  await app.close();
});
