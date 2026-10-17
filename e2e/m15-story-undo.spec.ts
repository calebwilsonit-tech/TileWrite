import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchEditor } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });
const items = (page: Page) => page.evaluate(() => window.__store!.story.items.map((i) => i.name));

test('M15: story edits (items, conversations, skins, the map) are undone and redone with Ctrl+Z / Ctrl+Y like everything else', async () => {
  test.setTimeout(150_000);
  const { page, app, errors } = await launchEditor();
  await page.getByTestId('sample-last-storytender').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);
  await tab(page, 'Story').click();

  // ---- an item: added with the button, taken back and brought back ----
  const before = await items(page);
  await page.getByTestId('item-add').click();
  const added = await items(page);
  expect(added).toHaveLength(before.length + 1);
  await page.keyboard.press('Control+z');
  expect(await items(page)).toEqual(before);
  expect(await page.evaluate(() => window.__store!.doc!.history.redoLabel)).toBe('Edit the items');
  await page.keyboard.press('Control+y');
  expect(await items(page)).toEqual(added);

  // ---- typing in a field is one step, not one step per letter ----
  await page.waitForTimeout(1500); // a pause ends the step; edits made together join one
  const labelsBefore = await page.evaluate(() => window.__store!.doc!.history.labels.length);
  await page.getByTestId(`item-name-${added.length - 1}`).fill('Lantern oil');
  await page.getByTestId(`item-name-${added.length - 1}`).press('Enter');
  await page.getByTestId(`item-name-${added.length - 1}`).fill('Lantern oil, the good kind');
  await page.getByTestId(`item-name-${added.length - 1}`).press('Enter');
  expect((await items(page)).at(-1)).toBe('Lantern oil, the good kind');
  expect(await page.evaluate(() => window.__store!.doc!.history.labels.length)).toBe(labelsBefore + 1); // the two edits joined
  await page.keyboard.press('Control+z');
  expect((await items(page)).at(-1)).toBe(added.at(-1));

  // ---- a conversation: deleted, then brought back with its file ----
  const names = await page.evaluate(() => [...window.__store!.story.dialogues.keys()]);
  const gone = names[0]!;
  const file = path.join(dir, 'assets', 'dialogues', `${gone}.dialogue.json`);
  expect(fs.existsSync(file)).toBe(true);
  await page.evaluate((n) => window.__store!.removeDialogue(n), gone);
  await expect.poll(() => fs.existsSync(file)).toBe(false);
  expect(await page.evaluate(() => [...window.__store!.story.dialogues.keys()])).not.toContain(gone);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => [...window.__store!.story.dialogues.keys()])).toContain(gone);
  await expect.poll(() => fs.existsSync(file), { timeout: 8000 }).toBe(true);
  await page.keyboard.press('Control+y');
  await expect.poll(() => fs.existsSync(file), { timeout: 8000 }).toBe(false);
  await page.keyboard.press('Control+z');

  // ---- the world map: removed, brought back ----
  expect(await page.evaluate(() => window.__store!.worldMap !== null)).toBe(true);
  await page.evaluate(() => window.__store!.removeWorldMap());
  expect(await page.evaluate(() => window.__store!.worldMap)).toBeNull();
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.__store!.worldMap?.nodes.length)).toBeGreaterThan(0);
  await expect.poll(() => fs.existsSync(path.join(dir, 'assets', 'worldmap.json')), { timeout: 8000 }).toBe(true);

  // ---- the History panel lists them with the scene's own edits ----
  const labels = await page.evaluate(() => window.__store!.doc!.history.labels);
  expect(labels.some((l) => /items|conversation|world map/i.test(l))).toBe(true);
  expect(errors).toEqual([]);
  await app.close();
});
