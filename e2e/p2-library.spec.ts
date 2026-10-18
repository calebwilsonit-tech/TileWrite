import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectViaUi, launchEditor } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

async function fillCanvas(page: Page, swatch: number): Promise<void> {
  await page.getByTestId(`swatch-${swatch}`).click();
  await page.getByTestId('stool-fill').click();
  const box = await page.getByTestId('studio-canvas').boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

test('Phase 2: the personal library keeps a tall prop with its versions, shares it as a pack file, and adds it to another project as a link', async () => {
  test.setTimeout(300_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-lib-'));
  const out = path.join(tmp, 'out');
  const { page, app, errors, base } = await launchEditor(undefined, { TILEWRIGHT_LIBRARY: path.join(tmp, 'library'), TILEWRIGHT_TEST_SAVE: out, TILEWRIGHT_TEST_IMPORT: path.join(out, 'Oak tree.twpack') });
  await createProjectViaUi(page, 'Lib A', 'empty-iso');

  // ---- a tree drawn in the tile studio ----
  await page.getByTestId('btn-ws-sprites').click();
  await page.getByTestId('studio-mode-tile').click();
  await page.getByTestId('ts-preset').selectOption('tree');
  await page.getByTestId('ts-name').fill('oak');
  await page.getByTestId('ts-create').click();
  await fillCanvas(page, 6);
  await page.getByTestId('studio-save').click();
  await page.getByTestId('btn-ws-world').click();

  // ---- keep it in the library ----
  await tab(page, 'Library').click();
  await expect(page.getByTestId('library-empty')).toBeVisible();
  await page.getByTestId('library-save-kind').selectOption('prop');
  await page.getByTestId('library-pick-oak').check();
  await page.getByTestId('library-save-name').fill('Oak tree');
  await page.getByTestId('library-save-tags').fill('tree, green');
  await page.getByTestId('library-save-licence').selectOption('CC-BY-4.0');
  await page.getByTestId('library-save-go').click();
  await expect(page.getByTestId('library-save-message')).toContainText('version 1');
  await expect(page.getByTestId('library-item-oak-tree')).toBeVisible();

  // ---- search, tags, folders ----
  await page.getByTestId('library-search').fill('banana');
  await expect(page.getByTestId('library-item-oak-tree')).toHaveCount(0);
  await page.getByTestId('library-search').fill('GREEN');
  await expect(page.getByTestId('library-item-oak-tree')).toBeVisible();
  await page.getByTestId('library-search').fill('');
  await page.getByTestId('library-newfolder').fill('Forest');
  await page.getByTestId('library-newfolder').press('Enter');
  await expect(page.getByTestId('library-folder-Forest')).toBeVisible();
  await page.getByTestId('library-item-oak-tree').locator('.library-thumb').click();
  await page.getByTestId('library-move').selectOption('Forest');
  await page.getByTestId('library-folder-Forest').click();
  await expect(page.getByTestId('library-item-oak-tree')).toBeVisible();
  await page.getByTestId('library-folder-none').click();
  await expect(page.getByTestId('library-item-oak-tree')).toHaveCount(0);
  await page.getByTestId('library-folder-all').click();

  // ---- redraw the tree and save a new version; the old one can be brought back ----
  await page.getByTestId('btn-ws-sprites').click();
  await page.getByTestId('sprite-oak').click();
  await fillCanvas(page, 7);
  await page.getByTestId('studio-save').click();
  await page.getByTestId('btn-ws-world').click();
  await tab(page, 'Library').click();
  await page.getByTestId('library-save-kind').selectOption('prop');
  await page.getByTestId('library-pick-oak').check();
  await page.getByTestId('library-save-name').fill('Oak tree');
  await page.getByTestId('library-save-as').selectOption('oak-tree');
  await page.getByTestId('library-save-go').click();
  await expect(page.getByTestId('library-save-message')).toContainText('version 2');
  await expect(page.getByTestId('library-versions')).toContainText('v2');
  await page.getByTestId('library-restore-1').click();
  await expect(page.getByTestId('library-item-oak-tree')).toContainText('v1');
  await page.getByTestId('library-restore-2').click();

  // ---- a pack file anyone can be given ----
  await page.getByTestId('library-export').click();
  const packFile = path.join(out, 'Oak tree.twpack');
  await expect.poll(() => fs.existsSync(packFile)).toBe(true);
  const pack = JSON.parse(fs.readFileSync(packFile, 'utf8')) as { format: string; kind: string; licence: string; files: { path: string }[] };
  expect(pack).toMatchObject({ format: 'tilewright-pack', kind: 'prop', licence: 'CC-BY-4.0' });
  expect(pack.files.map((f) => f.path)).toEqual(['assets/sprites/oak.sprite.json']);

  // ---- a second project follows the library ----
  await page.evaluate(() => window.__store!.closeProject());
  await createProjectViaUi(page, 'Lib B', 'empty-iso');
  await tab(page, 'Library').click();
  expect(await page.evaluate(() => window.__studio!.assets.has('oak'))).toBe(false);
  await page.getByTestId('library-add-oak-tree').click();
  await expect(page.getByTestId('library-add-contents')).toContainText('sprite oak');
  await expect(page.getByTestId('library-clashes')).toHaveCount(0);
  await page.getByTestId('library-add-confirm').click();
  await expect(page.getByTestId('library-add-result')).toContainText('Added "Oak tree"');
  await expect.poll(() => page.evaluate(() => window.__studio!.assets.has('oak'))).toBe(true);
  const links = fs.readFileSync(path.join(base, 'projects', 'Lib B', 'assets', 'library-links.json'), 'utf8');
  expect(JSON.parse(links).links[0]).toMatchObject({ itemId: 'oak-tree', mode: 'link', version: 2 });

  // adding again flags the clash, and keeping both gives the copy a new name
  await page.getByTestId('library-add-confirm').scrollIntoViewIfNeeded();
  await page.getByTestId('library-add-oak-tree').click();
  await page.getByTestId('library-add-oak-tree').click();
  await expect(page.getByTestId('library-clashes')).toContainText('assets/sprites/oak.sprite.json');
  await page.getByTestId('library-mode').selectOption('copy');
  await page.getByTestId('library-how').selectOption('rename');
  await page.getByTestId('library-add-confirm').click();
  await expect.poll(() => page.evaluate(() => window.__studio!.assets.has('oak_2'))).toBe(true);

  // ---- delete it from the library, then bring it back from the pack file ----
  await page.getByTestId('library-item-oak-tree').locator('.library-thumb').click();
  await page.getByTestId('library-delete').click();
  await expect(page.getByTestId('library-item-oak-tree')).toHaveCount(0);
  await page.getByTestId('library-import').click();
  await expect(page.locator('[data-testid^="library-item-oak"]').first()).toBeVisible();

  expect(errors).toEqual([]);
  await app.close();
});
