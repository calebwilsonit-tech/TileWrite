import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { cellInfo, cellXY, clickCell, createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';

type Snapshot = Record<string, number>;
const GRID_PLUS_X: Snapshot = { move_right: 1, move_down: 1 };
const GRID_PLUS_Y: Snapshot = { move_left: 1, move_down: 1 };
const GRID_MINUS_Y: Snapshot = { move_right: 1, move_up: 1 };

/** Hold `snapshot` as the player's actions for `ticks` ticks of the running play session. */
async function play(page: Page, snapshot: Snapshot, ticks: number): Promise<void> {
  await page.evaluate(
    ({ snapshot, ticks }) => {
      const r = window.__play!.runner;
      // pausing through the store keeps the editor from resuming the runner when a toast comes or goes
      window.__store!.set({ paused: true });
      r.paused = true;
      r.inputSource = () => snapshot;
      for (let i = 0; i < ticks; i++) r.step();
    },
    { snapshot, ticks },
  );
}

const player = (page: Page) =>
  page.evaluate(() => {
    const e = window.__play!.sim.world.withTag('player')[0]!;
    const t = e.get<{ x: number; y: number; h: number }>('transform')!;
    return { x: t.x, y: t.y, h: t.h, state: e.get<{ state: string }>('body')!.state };
  });

test('M3: build a small game with the editor tools (mouse and keyboard only), save it, reopen it and play it', async () => {
  test.setTimeout(120_000);
  const { app, page, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Island Quest', 'empty-iso');

  // ---- paint: a sand path with the brush ----
  await page.getByTestId('tile-sand').click();
  await pickTool(page, 'paint');
  await dragCells(page, [2, 20], [12, 20]);
  expect((await cellInfo(page, 6, 20)).tile).toBe(3);
  expect((await cellInfo(page, 6, 21)).tile).toBe(1);

  // ---- a stone platform, two levels up, with the cliff tool ----
  await page.getByTestId('tile-stone').click();
  await pickTool(page, 'cliff');
  await page.getByTestId('opt-height').fill('2');
  await dragCells(page, [20, 10], [26, 15]);
  expect(await cellInfo(page, 22, 12)).toMatchObject({ tile: 2, height: 2 });
  expect((await cellInfo(page, 19, 12)).height).toBe(0);

  // ---- stairs up to the platform: drag two cells northward ----
  await pickTool(page, 'stairs');
  await dragCells(page, [23, 17], [23, 16]);
  expect(await cellInfo(page, 23, 17)).toMatchObject({ height: 0, slope: 1 });
  expect(await cellInfo(page, 23, 16)).toMatchObject({ height: 1, slope: 1 }); // second flight starts where the first ends

  // ---- a river with water, a bridge and ramps ----
  await pickTool(page, 'water');
  await page.getByTestId('opt-size').fill('3');
  await dragCells(page, [9, 2], [9, 29]);
  await page.getByTestId('opt-size').fill('1');
  expect((await cellInfo(page, 9, 10)).flags & 8).toBe(8);
  expect((await cellInfo(page, 12, 10)).flags & 8).toBe(0);
  await pickTool(page, 'bridge');
  await dragCells(page, [8, 16], [10, 16]);
  expect((await cellInfo(page, 9, 16)).deck).toBe(1);
  await pickTool(page, 'ramp');
  await page.getByTestId('dir-2').click(); // climbs east
  await clickCell(page, 7, 16);
  await page.getByTestId('dir-4').click(); // climbs west
  await clickCell(page, 11, 16);
  expect(await cellInfo(page, 7, 16)).toMatchObject({ slope: 2, height: 0 });
  expect(await cellInfo(page, 11, 16)).toMatchObject({ slope: 4, height: 0 });

  // ---- a pit, a crate, and a room region ----
  await pickTool(page, 'pit');
  await dragCells(page, [14, 22], [15, 22]);
  expect((await cellInfo(page, 14, 22)).flags & 1).toBe(1);
  await pickTool(page, 'place');
  await clickCell(page, 17, 19);
  await pickTool(page, 'region');
  await dragCells(page, [2, 2], [8, 8]);
  const counts = await page.evaluate(() => ({ e: window.__store!.doc!.entities.length, r: window.__store!.doc!.regions.length }));
  expect(counts).toEqual({ e: 2, r: 1 });

  // ---- the walk test says the far bank is reachable from the west bank (over the bridge) ----
  await page.locator('.dv-tab', { hasText: 'Layers' }).click();
  await page.getByTestId('view-collision').check();
  await pickTool(page, 'walktest');
  await clickCell(page, 5, 16);
  await expect(page.getByTestId('toast').last()).toContainText('can walk to');
  const walkCount = Number(/walk to (\d+) cells/.exec((await page.getByTestId('toast').last().textContent()) ?? '')![1]);
  expect(walkCount).toBeGreaterThan(300);
  await page.screenshot({ path: shot('m3-walktest.png') });
  await page.getByTestId('view-collision').uncheck();
  await pickTool(page, 'select');

  // ---- nothing wrong with the level ----
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- undo / redo through the keyboard ----
  const before = await page.evaluate(() => window.__store!.doc!.regions.length);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__store!.doc!.regions.length)).toBe(before - 1);
  await page.keyboard.press('Control+y');
  expect(await page.evaluate(() => window.__store!.doc!.regions.length)).toBe(before);

  // ---- save, check the file on disk ----
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty')).toHaveText('Saved');
  const sceneFile = path.join(workDir, 'Island Quest', 'scenes', 'main.scene.json');
  const saved = JSON.parse(fs.readFileSync(sceneFile, 'utf8'));
  expect(saved.map.heights[12][22]).toBe(2);
  expect(saved.map.decks[16][9]).toBe(1);
  expect(saved.entities.map((e: { name: string }) => e.name).sort()).toEqual(['Crate', 'Player']);
  expect(saved.regions).toHaveLength(1);
  await page.screenshot({ path: shot('m3-built.png') });

  // ---- close the project and reopen it from the recent list ----
  await page.getByText('Tilewright', { exact: true }).first().click();
  await page.getByTestId('project-screen').waitFor();
  await page.getByTestId('recent-item').first().click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport?.doc !== null && window.__store!.doc!.map.getDeck(9, 16) === 1);
  expect(await cellInfo(page, 22, 12)).toMatchObject({ tile: 2, height: 2 });

  // ---- play from the cell under the mouse: cross the bridge ----
  const hover = await cellXY(page, 5, 16);
  await page.mouse.move(hover.x, hover.y);
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__play !== undefined);
  await expect(page.getByTestId('play-badge')).toBeVisible();
  await play(page, GRID_PLUS_X, 20);
  const onRamp = await player(page);
  expect(onRamp.x).toBeGreaterThan(6);
  await play(page, GRID_PLUS_X, 60);
  const onDeck = await player(page);
  expect(onDeck.x).toBeGreaterThan(8);
  expect(onDeck.h).toBeGreaterThan(0.9); // on the bridge, one level up
  await page.screenshot({ path: shot('m3-play-bridge.png') });
  await play(page, GRID_PLUS_X, 60);
  const across = await player(page);
  expect(across.x).toBeGreaterThan(12);
  expect(across.h).toBeCloseTo(0, 5);
  await page.keyboard.press('Escape'); // stop
  await expect(page.getByTestId('btn-play')).toBeVisible();
  expect(await page.evaluate(() => window.__play)).toBeUndefined();

  // ---- play from the start: climb the stairs onto the platform ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  expect((await player(page)).x).toBeCloseTo(16.5, 1); // the player start
  await play(page, GRID_PLUS_Y, 75); // south to y = 21.5, below the crate
  await play(page, GRID_PLUS_X, 105); // east to x = 23.5, in line with the stairs
  await play(page, GRID_MINUS_Y, 105); // north up both flights onto the platform
  const up = await player(page);
  expect(up.h).toBeCloseTo(2, 5);
  expect(up.state).toBe('ground');
  await page.screenshot({ path: shot('m3-play-platform.png') });
  await page.getByTestId('btn-stop').click();

  // ---- walking into the pit makes you fall (and the game reports it instead of crashing) ----
  // the camera eases back after Stop: keep pointing until the pointer really is over the pit cell
  await expect
    .poll(async () => {
      const pit = await cellXY(page, 14, 20);
      await page.mouse.move(pit.x, pit.y);
      return page.evaluate(() => JSON.stringify(window.__viewport!.hoverCell));
    })
    .toBe(JSON.stringify({ x: 14, y: 20 }));
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, GRID_PLUS_Y, 60);
  const fell = await page.evaluate(() => window.__play!.sim.world.withTag('player')[0]!.get<{ state: string }>('body')!.state);
  expect(fell).toBe('pit');
  await page.getByTestId('btn-stop').click();

  expect(errors).toEqual([]);
  await app.close();
});
