import { expect, test, type Page } from '@playwright/test';
import { clickCell, createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';

const byName = (page: Page, name: string): Promise<string> => page.evaluate((n) => window.__store!.doc!.entities.find((e) => e.name === n)!.id, name);

async function dragEntities(page: Page, a: string, b: string): Promise<void> {
  const pa = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, a);
  const pb = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, b);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(pa.x + ((pb.x - pa.x) * i) / 8, pa.y + ((pb.y - pa.y) * i) / 8);
  await page.mouse.up();
}

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

test('M15: the puzzle solver searches echoes, plates, levers and crates until the bot can reach the goal', async () => {
  test.setTimeout(240_000);
  const { app, page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Solver Game', 'empty-iso');

  // ---- a walled room, a doorway shut by a gate, a plate that opens it only while it is held ----
  await pickTool(page, 'block');
  await dragCells(page, [22, 0], [22, 15]);
  await dragCells(page, [22, 18], [22, 31]);
  await pickTool(page, 'place');
  const place = async (prefab: string, x: number, y: number): Promise<void> => {
    await page.getByTestId('opt-prefab').selectOption(prefab);
    await clickCell(page, x, y);
  };
  await place('gate', 22, 16);
  await place('gate', 22, 17);
  await place('goal', 26, 16);
  await place('plate', 18, 12);
  await pickTool(page, 'select');
  const plate = await byName(page, 'Pressure plate');
  const gate = await byName(page, 'Gate');
  const gate2 = await byName(page, 'Gate 2');
  for (const g of [gate, gate2]) {
    await pickTool(page, 'wire');
    await dragEntities(page, plate, g);
    await page.getByTestId('connect-ok').click();
    await pickTool(page, 'select');
  }

  // ---- with no way to hold the plate while walking away, the search reports that honestly ----
  await tab(page, 'Playbot').click();
  await page.getByTestId('bot-search').click();
  await expect(page.getByTestId('bot-log-item').first()).toContainText('No way to reach the goal was found', { timeout: 60_000 });

  // ---- give the player an Echo Recorder (Inspector -> Add a behaviour) and search again ----
  const playerId = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.tags.includes('player'))!.id);
  await page.evaluate((id) => window.__store!.select([id]), playerId);
  await tab(page, 'Inspector').click();
  await page.getByTestId('add-behavior').selectOption('echoRecorder');
  await page.getByTestId('add-behavior-ok').click();
  await expect(page.getByTestId('behavior-echoRecorder')).toBeVisible();
  await tab(page, 'Playbot').click();
  await page.getByTestId('bot-search').click();
  await expect(page.getByTestId('bot-log-item').first()).toContainText('Solved in 1 step: record an echo onto "Pressure plate"', { timeout: 90_000 });
  await page.screenshot({ path: shot('m15-solver.png') });
  expect(errors).toEqual([]);
  await app.close();
});
