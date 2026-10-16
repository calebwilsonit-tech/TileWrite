import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('editor window opens and shows the welcome screen', async () => {
  const app = await electron.launch({
    args: [path.join(root, 'packages', 'editor')],
  });
  const page = await app.firstWindow();
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.locator('h1')).toHaveText('Tilewright');
  await page.screenshot({ path: path.join(root, 'screenshots', 'm0-welcome.png') });
  await app.close();
});
