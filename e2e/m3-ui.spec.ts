import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { cellInfo, clickCell, createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';

async function entityId(page: import('@playwright/test').Page, name: string): Promise<string> {
  return page.evaluate((n) => window.__store!.doc!.entities.find((e) => e.name === n)!.id, name);
}

async function clickEntity(page: import('@playwright/test').Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, id);
  await page.mouse.click(p.x, p.y);
}

test('M3: objects, inspector, copy/paste, problems, palette, shortcuts, themes, locks and scenes', async () => {
  test.setTimeout(120_000);
  const { app, page, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Chrome Test', 'starter-room');
  const ents = (): Promise<number> => page.evaluate(() => window.__store!.doc!.entities.length);

  // ---- select an object with the mouse and edit it in the inspector ----
  const crate = await entityId(page, 'Crate');
  await clickEntity(page, crate);
  await expect(page.getByTestId('inspector-entity')).toBeVisible();
  await page.getByTestId('insp-name').fill('Treasure Chest');
  await page.getByTestId('insp-name').press('Enter');
  expect(await page.evaluate((id) => window.__store!.doc!.getEntity(id)!.name, crate)).toBe('Treasure Chest');
  await page.getByTestId('insp-x').fill('13.5');
  await page.getByTestId('insp-x').press('Enter');
  expect(await page.evaluate((id) => (window.__store!.doc!.getEntity(id)!.components.transform as { x: number }).x, crate)).toBe(13.5);

  // ---- copy, paste, delete, undo ----
  await page.getByTestId('viewport').click({ position: { x: 5, y: 5 } }); // focus away from the inspector fields
  await clickEntity(page, crate);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  expect(await ents()).toBe(3);
  const names = await page.evaluate(() => window.__store!.doc!.entities.map((e) => e.name));
  expect(names).toContain('Treasure Chest 2');
  await page.keyboard.press('Delete');
  expect(await ents()).toBe(2);
  await page.keyboard.press('Control+z');
  expect(await ents()).toBe(3);
  await page.keyboard.press('Control+z'); // undo the paste
  expect(await ents()).toBe(2);

  // ---- delete the player: problems appear, Play refuses with a clear message; undo fixes it ----
  const playerId = await entityId(page, 'Player');
  await clickEntity(page, playerId);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('problem-count')).toContainText('problem');
  await page.getByTestId('btn-play').click();
  await expect(page.getByTestId('toast').last()).toContainText('no player start');
  await expect(page.getByTestId('btn-play')).toBeVisible(); // still in edit mode
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- command palette ----
  const gridBefore = await page.evaluate(() => window.__store!.state.view.grid);
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('show / hide grid');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__store!.state.view.grid)).toBe(!gridBefore);

  // ---- rebind a shortcut and use it ----
  await page.getByRole('button', { name: 'Shortcuts' }).click();
  await page.getByTestId('rebind-view.grid').click();
  await page.keyboard.press('F2');
  await expect(page.getByTestId('keys-view.grid')).toHaveText('F2');
  await page.getByTestId('shortcuts').getByRole('button', { name: 'Close' }).click();
  await page.keyboard.press('F2');
  expect(await page.evaluate(() => window.__store!.state.view.grid)).toBe(gridBefore);

  // ---- tool hotkeys and the tool hint ----
  await page.keyboard.press('b');
  expect(await page.evaluate(() => window.__store!.state.tool)).toBe('paint');
  await expect(page.getByTestId('tool-options')).toContainText('Paint the chosen tile');

  // ---- a locked layer refuses edits, with an explanation ----
  await page.locator('.dv-tab', { hasText: 'Layers' }).click();
  await page.getByTestId('lock-ground').check();
  const tileBefore = (await cellInfo(page, 3, 3)).tile;
  await page.getByTestId('tile-stone').click();
  await clickCell(page, 3, 3);
  expect((await cellInfo(page, 3, 3)).tile).toBe(tileBefore);
  await expect(page.getByTestId('toast').last()).toContainText('locked');
  await page.getByTestId('lock-ground').uncheck();
  await clickCell(page, 3, 3);
  expect((await cellInfo(page, 3, 3)).tile).toBe(2);

  // ---- regions get their own inspector ----
  await pickTool(page, 'region');
  await dragCells(page, [4, 4], [9, 9]);
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  await expect(page.getByTestId('inspector-region')).toBeVisible();
  await page.getByTestId('reg-camera').click(); // the inspector updates on the next frame, so click then wait
  await expect.poll(() => page.evaluate(() => window.__store!.doc!.regions[0]!.cameraBounds)).toBe(true);
  await expect(page.getByTestId('reg-camera')).toBeChecked();

  // ---- heights are shown on request ----
  await page.locator('.dv-tab', { hasText: 'Layers' }).click();
  await page.getByTestId('view-heights').check();
  await page.screenshot({ path: shot('m3-ui.png') });

  // ---- theme ----
  await page.getByTestId('btn-theme').click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await page.screenshot({ path: shot('m3-light.png') });
  await page.getByTestId('btn-theme').click();

  // ---- a second scene ----
  await page.getByTestId('btn-save').click();
  await page.getByTestId('btn-new-scene').click();
  await page.getByTestId('new-scene-name').fill('Cave Level');
  await page.getByTestId('new-scene-ok').click();
  await expect(page.getByTestId('scene-select').locator('option')).toHaveCount(2);
  await page.waitForFunction(() => window.__store!.doc!.name === 'Cave Level');
  const project = JSON.parse(fs.readFileSync(path.join(workDir, 'Chrome Test', 'project.json'), 'utf8'));
  expect(project.scenes).toEqual(['scenes/main.scene.json', 'scenes/cave-level.scene.json']);
  expect(fs.existsSync(path.join(workDir, 'Chrome Test', 'scenes', 'cave-level.scene.json'))).toBe(true);
  await page.getByTestId('scene-select').selectOption('scenes/main.scene.json');
  await page.waitForFunction(() => window.__store!.doc!.name === 'Main');
  expect((await cellInfo(page, 3, 3)).tile).toBe(2); // main scene kept its edits (saved before the switch)

  expect(errors).toEqual([]);
  await app.close();
});

test('M3: unsaved work survives a crash and can be recovered', async () => {
  test.setTimeout(90_000);
  const first = await launchEditor();
  await createProjectViaUi(first.page, 'Crash Test', 'empty-iso');
  await first.page.getByTestId('tile-stone').click();
  await pickTool(first.page, 'paint');
  await clickCell(first.page, 5, 5);
  expect((await cellInfo(first.page, 5, 5)).tile).toBe(2);
  await first.page.evaluate(() => window.__store!.autosaveNow());
  const autosaveDir = path.join(first.workDir, 'Crash Test', '.tilewright', 'autosave');
  expect(fs.readdirSync(autosaveDir).length).toBe(1);
  // simulate a crash: kill the process without saving
  first.app.process().kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 500));

  const second = await launchEditor(first.base);
  await second.page.getByTestId('recent-item').first().click();
  await expect(second.page.getByTestId('recovery')).toBeVisible();
  await second.page.getByTestId('recovery-accept').click();
  await second.page.waitForFunction(() => window.__store?.doc?.map.getTile(5, 5) === 2);
  await expect(second.page.getByTestId('dirty')).toHaveText('Unsaved changes');
  await second.page.keyboard.press('Control+s');
  await expect(second.page.getByTestId('dirty')).toHaveText('Saved');
  expect(fs.readdirSync(autosaveDir).length).toBe(0); // saving clears the autosave
  await second.app.close();
});

test('M3: opening a damaged project explains the problem in plain English and keeps running', async () => {
  const { app, page, workDir, errors } = await launchEditor();
  fs.writeFileSync(path.join(workDir, 'project.json'), '{ this is not json');
  await page.getByTestId('btn-open-project').click();
  await expect(page.getByTestId('toast').last()).toContainText('damaged');
  await expect(page.getByTestId('project-screen')).toBeVisible();
  fs.writeFileSync(path.join(workDir, 'project.json'), JSON.stringify({ schemaVersion: 99, name: 'x', scenes: ['a'], startScene: 'a' }));
  await page.getByTestId('btn-open-project').click();
  await expect(page.getByTestId('toast').last()).toContainText('newer Tilewright');
  expect(errors).toEqual([]);
  await app.close();
});
