import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Exporting from the INSTALLED editor (its code lives inside app.asar), then running the exported game.
 * Skipped unless pointed at a packaged build (the CI "windows-build" job does this after `npm run dist:win`):
 *
 *   $env:TILEWRIGHT_PACKAGED_EXE = 'packages\editor\release\win-unpacked\Tilewright.exe'; npx playwright test e2e/packaged-export.spec.ts
 */
const packaged = process.env.TILEWRIGHT_PACKAGED_EXE;

test.skip(!packaged, 'set TILEWRIGHT_PACKAGED_EXE to a packaged Tilewright.exe to run this');

test('packaged editor: export a game and run it', async () => {
  test.setTimeout(300_000);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-e2e-'));
  const work = path.join(base, 'projects');
  fs.mkdirSync(work, { recursive: true });
  const app = await electron.launch({ executablePath: path.resolve(packaged!), args: [`--user-data-dir=${path.join(base, 'userdata')}`], env: { ...process.env, TILEWRIGHT_TEST_DIR: work } });
  const page = await app.firstWindow();
  await page.getByTestId('btn-new-project').click();
  await page.getByTestId('project-name-input').fill('Packaged Game');
  await page.getByTestId('template-starter-room').check({ force: true });
  await page.getByTestId('btn-create-project').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForTimeout(1500);
  await page.getByTestId('btn-export').click();
  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('export-go').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 240_000 });
  const exe = (await page.getByTestId('export-exe').textContent())!;
  expect(fs.existsSync(exe)).toBe(true);
  expect(fs.existsSync(path.join(path.dirname(exe), 'resources', 'app.asar'))).toBe(false); // none of the editor
  await app.close();

  const game = await electron.launch({ executablePath: exe, env: { ...process.env, TILEWRIGHT_GAME_TEST: '1', TILEWRIGHT_GAME_USERDATA: path.join(base, 'gamedata') } });
  const gp = await game.firstWindow();
  await gp.waitForFunction(() => (window as unknown as { __game?: unknown }).__game !== undefined, undefined, { timeout: 60_000 });
  await gp.waitForTimeout(500);
  expect(await gp.evaluate(() => (window as unknown as { __game: { session: { sim: { tick: number } } } }).__game.session.sim.tick)).toBeGreaterThan(10);
  await game.close();
});
