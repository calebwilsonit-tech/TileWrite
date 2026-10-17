import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { cellXY, clickCell, dragCells, launchEditor, pickTool, shot } from './helpers';

type Snapshot = Record<string, number>;
const GRID_MINUS_X: Snapshot = { move_left: 1, move_up: 1 };

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
  await page.waitForTimeout(450); // the tutorial looks at the game a few times a second
}

/** Drag a brush along a straight line of cells, one mouse move per cell (a person's hand does the same). */
async function dragLine(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const n = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  const a = await cellXY(page, ...from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= n; i++) {
    const p = await cellXY(page, from[0] + Math.round(((to[0] - from[0]) * i) / n), from[1] + Math.round(((to[1] - from[1]) * i) / n));
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
}

const byName = (page: Page, name: string): Promise<string> => page.evaluate((n) => window.__store!.doc!.entities.find((e) => e.name === n)!.id, name);

async function dragEntities(page: Page, a: string, b: string): Promise<void> {
  const pa = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, a);
  const pb = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, b);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(pa.x + ((pb.x - pa.x) * i) / 8, pa.y + ((pb.y - pa.y) * i) / 8);
  await page.mouse.up();
}

const step = (page: Page) => page.getByTestId('tutorial').getAttribute('data-step');

test('M14: a new user follows the tutorial and builds a playable plate-and-gate room, with no code', async () => {
  test.setTimeout(240_000);
  const started = Date.now();
  const { app, page, workDir, errors } = await launchEditor();

  // ---- from the first screen ----
  await expect(page.getByTestId('project-screen')).toBeVisible();
  await page.getByTestId('btn-tutorial').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('tutorial')).toBeVisible();
  expect(await step(page)).toBe('welcome');
  await expect(page.getByTestId('tutorial-text')).toContainText('about ten minutes');
  await page.screenshot({ path: shot('m14-tutorial-welcome.png') });
  await page.getByTestId('tutorial-next').click();

  // ---- a floor ----
  expect(await step(page)).toBe('floor');
  await expect(page.getByTestId('tile-stone')).toHaveClass(/tw-tutorial-pulse/); // it points at what to use
  await page.getByTestId('tile-stone').click();
  await pickTool(page, 'rect');
  await dragCells(page, [10, 13], [18, 19]);
  await expect.poll(() => step(page)).toBe('plate');

  // ---- a plate, a crate, a gate ----
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption('plate');
  await clickCell(page, 12, 16);
  await expect.poll(() => step(page)).toBe('crate');
  await page.getByTestId('opt-prefab').selectOption('crate');
  await clickCell(page, 14, 16);
  await expect.poll(() => step(page)).toBe('gate');
  await page.getByTestId('opt-prefab').selectOption('gate');
  await clickCell(page, 20, 16);
  await expect.poll(() => step(page)).toBe('raise');
  await page.screenshot({ path: shot('m14-tutorial-plate.png') });

  // ---- a wall through the gate's column, leaving the gate's cell ----
  await pickTool(page, 'raise');
  for (let pass = 0; pass < 2; pass++) {
    await dragLine(page, [20, 0], [20, 15]);
    await dragLine(page, [20, 17], [20, 31]);
  }
  await expect.poll(() => step(page)).toBe('wire');

  // ---- the wire ----
  await pickTool(page, 'wire');
  await dragEntities(page, await byName(page, 'Pressure plate'), await byName(page, 'Gate'));
  await page.getByTestId('connect-ok').click();
  await expect.poll(() => step(page)).toBe('play');
  await pickTool(page, 'select');

  // ---- play: push the crate onto the plate ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, {}, 5);
  await play(page, GRID_MINUS_X, 75);
  await play(page, {}, 70);
  await page.screenshot({ path: shot('m14-tutorial-gate-open.png') });
  await page.getByTestId('btn-stop').click();
  await expect.poll(() => step(page)).toBe('save');

  // ---- save, and the end ----
  await page.keyboard.press('Control+s');
  await expect.poll(() => step(page)).toBe('finish');
  await expect(page.getByTestId('tutorial-title')).toHaveText('You built a puzzle');
  await expect(page.getByTestId('tutorial')).toContainText('You got here in about');
  await page.screenshot({ path: shot('m14-tutorial-done.png') });
  await page.getByTestId('tutorial-next').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);

  // what it made is a real project, saved, with nothing wrong in it
  const sceneFile = path.join(workDir, 'Tutorial Room', 'scenes', 'main.scene.json');
  if (process.env.TILEWRIGHT_KEEP_SLICE) fs.cpSync(path.dirname(path.dirname(sceneFile)), process.env.TILEWRIGHT_KEEP_SLICE, { recursive: true });
  const saved = JSON.parse(fs.readFileSync(sceneFile, 'utf8'));
  expect(saved.wires).toHaveLength(1);
  expect(saved.entities.map((e: { name: string }) => e.name).sort()).toEqual(['Crate', 'Gate', 'Player', 'Pressure plate']);
  await page.locator('.dv-tab').getByText('Problems', { exact: true }).click();
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // a minute or two of clicking, not fifteen (the test is far faster than a person, so this only guards the step count)
  expect(Date.now() - started).toBeLessThan(15 * 60_000);

  // it can be started again from the command palette
  await page.getByTestId('btn-palette').click();
  await page.getByPlaceholder(/command/i).fill('tutorial');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tutorial')).toBeVisible();
  await page.getByTestId('tutorial-close').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);

  expect(errors).toEqual([]);
  await app.close();
});
