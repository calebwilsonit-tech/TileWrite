import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchEditor, shot } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

async function press(page: Page, snapshot: Record<string, number>, ticks = 1): Promise<void> {
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
  await page.waitForTimeout(80);
}

const board = (page: Page) => page.getByTestId('worldmap-board');

/** Page position of a place on the board. */
async function placeXY(page: Page, id: string): Promise<{ x: number; y: number }> {
  const b = (await page.getByTestId(`worldmap-place-${id}`).locator('circle').first().boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('M15: a world map is drawn in the Story panel, and the player opens it in the game and travels with it', async () => {
  test.setTimeout(150_000);
  const { page, app, errors, workDir } = await launchEditor();
  await page.getByTestId('sample-last-storytender').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  await page.evaluate(() => localStorage.removeItem('tilewright.settings'));

  // ---- make a map from the project's scenes ----
  await tab(page, 'Story').click();
  await page.getByTestId('story-tab-map').click();
  // the finished sample ships with a map of its own; start over to build one
  await expect(board(page)).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('worldmap-remove').click();
  await page.getByTestId('worldmap-create').click();
  await expect(board(page)).toBeVisible();
  const ids = await page.evaluate(() => window.__store!.worldMap!.nodes.map((n) => n.id));
  expect(ids).toHaveLength(2);
  const [hub, other] = ids as [string, string];
  await expect(page.getByTestId('worldmap-ok')).toBeVisible(); // a hub and a place joined by a path
  await page.getByTestId('worldmap-big').click(); // the whole window: the board is tall
  await page.waitForTimeout(250);

  // ---- drag a place to a new spot ----
  const from = await placeXY(page, other);
  const to = { x: from.x - 60, y: from.y + 50 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
  const before = await page.evaluate((id) => window.__store!.worldMap!.nodes.find((n) => n.id === id)!, other);
  expect(before.x % 10).toBe(0); // snapped to the grid
  expect(Math.abs(before.x - 0)).toBeGreaterThan(0);

  // ---- edit it: a name, a picture, when it opens ----
  await page.getByTestId('worldmap-label').fill('The Deep Dark');
  await page.getByTestId('worldmap-label').press('Enter');
  await page.getByTestId('worldmap-icon').selectOption('cave');
  await page.getByTestId('worldmap-unlock').selectOption('always');
  const node = await page.evaluate((id) => JSON.parse(JSON.stringify(window.__store!.worldMap!.nodes.find((n) => n.id === id))), other);
  expect(node).toMatchObject({ label: 'The Deep Dark', icon: 'cave', unlock: { kind: 'always' } });
  await page.screenshot({ path: shot('m15-worldmap-editor.png') });
  await page.getByTestId('worldmap-big').click();

  // ---- saved with the project ----
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);
  const file = path.join(dir, 'assets', 'worldmap.json');
  await expect
    .poll(() => (fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')).nodes.find((n: { id: string }) => n.id === other)?.label as string) : ''), { timeout: 8000 })
    .toBe('The Deep Dark');

  // ---- in the game: M opens the map, the player's place is marked, arrows move between places, E travels ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await press(page, {}, 2);
  const sceneBefore = await page.evaluate(() => window.__play!.sim.runtime.scene);
  expect(sceneBefore).toMatch(/main/);
  await press(page, { map: 1 });
  await expect(page.getByTestId('tw-map')).toBeVisible();
  await expect(page.getByTestId(`tw-place-${hub}`)).toHaveAttribute('data-state', 'here');
  await expect(page.getByTestId(`tw-place-${other}`)).toHaveAttribute('data-state', 'open');
  await page.screenshot({ path: shot('m15-worldmap-game.png') });
  await press(page, {}, 1);
  await press(page, { move_right: 1, move_down: 1 }, 1); // an arrow key towards the other place
  await press(page, {}, 1);
  await press(page, { move_left: 1, move_down: 1 }, 1);
  await press(page, {}, 1);
  await page.getByTestId(`tw-place-${other}`).click(); // click it
  await expect.poll(() => page.evaluate(() => window.__play!.sim.runtime.scene), { timeout: 10_000 }).toMatch(/dungeon/);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars['visited:' + window.__play!.sim.runtime.scene])).toBe(true);
  expect(await page.evaluate(() => window.__play!.sim.runtime.menuOpen)).toBe(false);

  // ---- a place that is not unlocked yet is a question mark, and a place that is secret is not drawn ----
  await press(page, {}, 3);
  await page.evaluate((id) => {
    const m = window.__play!.sim.assets.worldMap!;
    m.nodes = m.nodes.map((n) => (n.id === id ? { ...n, unlock: { kind: 'variable', name: 'open_sesame', atLeast: 1 } } : n));
  }, hub);
  await press(page, { map: 1 });
  await expect(page.getByTestId(`tw-place-${hub}`)).toHaveAttribute('data-state', 'locked');
  await expect(page.getByTestId(`tw-place-${hub}`)).toContainText('?');
  await page.evaluate((id) => {
    const m = window.__play!.sim.assets.worldMap!;
    m.nodes = m.nodes.map((n) => (n.id === id ? { ...n, hidden: true } : n));
  }, hub);
  await press(page, {}, 2);
  await press(page, { pause: 1 }); // close, then open again to redraw
  await press(page, { map: 1 });
  await expect(page.getByTestId(`tw-place-${hub}`)).toHaveCount(0);
  expect(errors).toEqual([]);
  await app.close();
  void workDir;
});
