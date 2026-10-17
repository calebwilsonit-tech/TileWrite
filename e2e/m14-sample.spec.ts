import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchEditor } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

test('M14: the finished sample game opens as a copy, passes every check, and its playthrough still reaches the exit', async () => {
  test.setTimeout(150_000);
  const first = await launchEditor();
  const { page, app, errors, workDir } = first;
  await expect(page.getByTestId('sample-last-storytender')).toBeVisible();
  await page.getByTestId('sample-last-storytender').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);

  // it is a copy in the folder that was chosen, so changing it never changes the original
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);
  expect(path.dirname(dir)).toBe(workDir);
  expect(fs.existsSync(path.join(dir, 'scenes', 'dungeon.scene.json'))).toBe(true);
  expect(await page.evaluate(() => window.__store!.state.project!.project.scenes)).toEqual(['scenes/main.scene.json', 'scenes/dungeon.scene.json']);

  await tab(page, 'Problems').click();
  await page.getByTestId('check-project').click();
  await expect(page.getByTestId('project-check')).toContainText('all clear');

  await page.evaluate(() => window.__store!.loadPlaythroughNames());
  await tab(page, 'Playbot').click();
  await page.getByTestId('playthrough-run-Storytender slice').click();
  await expect(page.getByTestId('bot-log-item').first()).toContainText('Playthrough "Storytender slice" still works');

  // opening it again makes a second copy instead of overwriting the first
  await app.close();
  const again = await launchEditor(first.base);
  await again.page.getByTestId('sample-last-storytender').click();
  await again.page.getByTestId('editor-shell').waitFor();
  const dir2 = await again.page.evaluate(() => window.__store!.state.project!.dir);
  expect(path.basename(dir2)).toBe(`${path.basename(dir)} 2`);
  expect(errors).toEqual([]);
  expect(again.errors).toEqual([]);
  await again.app.close();
});
