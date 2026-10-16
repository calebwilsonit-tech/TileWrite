import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { clickCell, createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';

const byName = (page: Page, name: string): Promise<string> => page.evaluate((n) => window.__store!.doc!.entities.find((e) => e.name === n)!.id, name);

async function clickEntity(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, id);
  await page.mouse.click(p.x, p.y);
}

async function dragEntities(page: Page, a: string, b: string): Promise<void> {
  const pa = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, a);
  const pb = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, b);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(pa.x + ((pb.x - pa.x) * i) / 8, pa.y + ((pb.y - pa.y) * i) / 8);
  await page.mouse.up();
}

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

test('M9: check a level for bypasses, let the bot play it, record a playthrough, use the debugging aids, and read a crash report', async () => {
  test.setTimeout(240_000);
  const { app, page, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Check Game', 'empty-iso');
  const projectDir = path.join(workDir, 'Check Game');

  // ---- a walled room with a doorway two cells wide, but a gate only one cell wide ----
  await pickTool(page, 'block');
  await dragCells(page, [22, 0], [22, 15]); // the wall runs the full height of the map
  await dragCells(page, [22, 18], [22, 31]);
  await pickTool(page, 'place');
  const place = async (prefab: string, x: number, y: number): Promise<void> => {
    await page.getByTestId('opt-prefab').selectOption(prefab);
    await clickCell(page, x, y);
  };
  await place('gate', 22, 16);
  await place('goal', 26, 16);
  await place('plate', 18, 12);
  await pickTool(page, 'select');
  const plate = await byName(page, 'Pressure plate');
  const gate = await byName(page, 'Gate');
  const wire = async (from: string, to: string): Promise<void> => {
    await pickTool(page, 'wire');
    await dragEntities(page, from, to);
    await page.getByTestId('connect-ok').click();
    await pickTool(page, 'select');
  };
  await wire(plate, gate);

  // ---- the puzzle check finds the hole ----
  await tab(page, 'Problems').click();
  await page.getByTestId('check-puzzles').click();
  await expect(page.getByTestId('problems-panel')).toContainText('can be reached without opening any gate');
  await expect(page.getByTestId('problems-panel')).toContainText('blocks nothing');
  await page.screenshot({ path: shot('m9-bypass-found.png') });

  // ---- the bot proves it: it simply walks through the gap ----
  await tab(page, 'Playbot').click();
  await page.getByTestId('bot-walk').click();
  await expect(page.getByTestId('bot-log-item').first()).toContainText('Reached "Exit" in');

  // ---- fix it: a second gate closes the doorway ----
  await pickTool(page, 'place');
  await place('gate', 22, 17);
  await pickTool(page, 'select');
  const gate2 = await byName(page, 'Gate 2');
  await wire(plate, gate2);
  await tab(page, 'Problems').click();
  await page.getByTestId('check-puzzles').click();
  await expect(page.getByTestId('problems-panel')).not.toContainText('can be reached without opening any gate');
  await expect(page.getByTestId('problems-panel')).not.toContainText('blocks nothing');
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- now the bot cannot just walk there ... ----
  await tab(page, 'Playbot').click();
  await page.getByTestId('bot-walk').click();
  await expect(page.getByTestId('bot-log-item').first()).toContainText('There is no way to walk to "Exit" from here.');

  // ... and with a plate that has to be held it cannot finish; make the plate stay down and it can
  await page.getByTestId('bot-solve').click();
  await expect(page.getByTestId('bot-log-item').first()).toContainText('Switches tried: "Pressure plate"');
  await clickEntity(page, plate);
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  await page.getByTestId('behavior-pressurePlate').getByTestId('bf-latch').click();
  await tab(page, 'Playbot').click();
  await page.getByTestId('bot-solve').click();
  await expect(page.getByTestId('bot-log-item').first()).toContainText(/Reached "Exit" in [\d.]+s after using "Pressure plate"\./);

  // ---- keep the bot's run as a playthrough and replay it ----
  await page.getByTestId('bot-save-run').click();
  await expect(page.getByTestId('playthrough-list')).toContainText('Playthrough 1');
  expect(fs.existsSync(path.join(projectDir, 'playthroughs', 'Playthrough 1.playthrough.json'))).toBe(true);
  await page.getByTestId('playthrough-run-Playthrough 1').click();
  await expect(page.getByTestId('bot-log-item').first()).toContainText('Playthrough "Playthrough 1" still works');
  await page.screenshot({ path: shot('m9-bot-report.png') });

  // ---- the whole project checks out ----
  await tab(page, 'Problems').click();
  await page.getByTestId('check-project').click();
  await expect(page.getByTestId('project-check')).toContainText('all clear');

  // ---- debugging aids while playing ----
  await page.locator('.dv-tab', { hasText: 'Layers' }).click();
  for (const id of ['view-triggers', 'view-lights', 'view-depth', 'view-profiler']) await page.getByTestId(id).click();
  expect(await page.evaluate(() => window.__store!.state.view.profiler)).toBe(true);
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await expect(page.getByTestId('tw-profiler')).toContainText('frames per second');
  await expect(page.getByTestId('tw-profiler')).toContainText('objects');
  expect(await page.evaluate(() => window.__play!.sim.profiler.enabled)).toBe(true);
  await page.screenshot({ path: shot('m9-debug-overlays.png') });

  // ---- a script that fails: the game pauses and the panel says what and where ----
  await page.evaluate(() => {
    window.__play!.sim.addSystem('my-script', () => {
      throw new Error('this script is broken');
    });
  });
  await expect(page.getByTestId('toolbar')).toBeVisible();
  await tab(page, 'Problems').click();
  await expect(page.getByTestId('runtime-error')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('runtime-error-headline')).toContainText('The game stopped in its "my-script" step: this script is broken');
  await page.getByTestId('runtime-error').locator('summary').click();
  await expect(page.getByTestId('runtime-error-details')).toContainText('Technical details');
  await expect(page.getByTestId('runtime-error-details')).toContainText('Variables');
  await page.screenshot({ path: shot('m9-crash-report.png') });
  await page.getByTestId('btn-stop').click();
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('runtime-error')).toHaveCount(0);

  expect(errors).toEqual([]);
  await app.close();
});
