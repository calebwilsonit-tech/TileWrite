import { _electron as electron, expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectViaUi, launchEditor, shot } from './helpers';

const SPINNER_BAD = `export default defineScript({
  name: 'Spinner',
  update(me, game) {
    me.state.n = (me.state.n ?? 0) + 1;
    if (me.state.n > 30) throw new Error('Boom from the script');
  },
});
`;

async function writeCode(page: Page, text: string): Promise<void> {
  await page.getByTestId('code-editor').locator('.monaco-editor').click();
  await page.evaluate((t) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__monaco.editor.getEditors()[0].getModel().setValue(t);
  }, text);
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

async function launchGame(exe: string, userData: string) {
  const app = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, TILEWRIGHT_GAME_TEST: '1', TILEWRIGHT_GAME_USERDATA: userData } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { app, page, errors };
}

test('M12: export a game from the editor, run it with no editor, see its script work, saves stay safe, and a crash gives a friendly screen and a log', async () => {
  test.setTimeout(420_000);
  const { app, page, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Export Game', 'starter-room');
  const projectDir = path.join(workDir, 'Export Game');

  // ---- a script, written in the Code window and attached to the crate ----
  await page.getByTestId('btn-ws-code').click();
  await page.getByTestId('script-new-name').fill('Spinner');
  await page.getByTestId('script-template').selectOption('spinner');
  await page.getByTestId('script-new').click();
  await expect(page.getByTestId('code-editor').locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('script-problems')).toContainText('No problems in your scripts', { timeout: 30_000 });
  await page.getByTestId('btn-ws-world').click();
  const crateId = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Crate')!.id);
  await expect
    .poll(async () => {
      // the viewport has just come back on screen: click until the crate is really selected
      const p = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, crateId);
      await page.mouse.click(p.x, p.y);
      return page.evaluate(() => window.__store!.state.selection);
    }, { timeout: 15_000 })
    .toEqual([crateId]);
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  await page.getByTestId('add-behavior').selectOption('script_Spinner');
  await page.getByTestId('add-behavior-ok').click();
  const fast = page.getByTestId('behavior-script_Spinner').getByTestId('bf-everySeconds');
  await fast.fill('0.2');
  await fast.press('Enter');
  await page.keyboard.press('Control+s');

  // ---- an error in the project stops the export, and says why ----
  const playerId = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Player')!.id);
  await page.evaluate((i) => window.__store!.doc!.removeEntities([i], 'Delete'), playerId);
  await page.getByTestId('btn-export').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await expect(page.getByTestId('export-errors')).toContainText(/player/i);
  await expect(page.getByTestId('export-go')).toBeDisabled();
  await page.screenshot({ path: shot('m12-export-blocked.png') });
  await page.getByTestId('export-close').click();
  await page.evaluate(() => window.__store!.doc!.undo());
  await page.keyboard.press('Control+s');

  // ---- settings, then export ----
  await page.getByTestId('btn-export').click();
  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('export-name').fill('Cave Quest');
  await page.getByTestId('export-version').fill('1.2');
  await page.getByTestId('export-width').fill('960');
  await page.getByTestId('export-height').fill('600');
  await page.getByTestId('export-splash').fill('Cave Quest');
  await page.getByTestId('export-height').blur();
  await expect(page.getByTestId('export-ready')).toBeVisible();
  await page.screenshot({ path: shot('m12-export-dialog.png') });
  await page.getByTestId('export-go').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 240_000 });
  const exe = (await page.getByTestId('export-exe').textContent())!;
  const zip = (await page.getByTestId('export-zip').textContent())!;
  const folder = path.dirname(exe);
  expect(path.basename(folder)).toBe('Cave Quest-1.2-windows');
  expect(path.basename(exe)).toBe('Cave Quest.exe');
  expect(fs.existsSync(exe)).toBe(true);
  expect(fs.statSync(zip).size).toBeGreaterThan(5_000_000);

  // what is in the folder: the runtime, the game, and nothing of the editor or the project's private files
  const data = path.join(folder, 'resources', 'app', 'data');
  const manifest = JSON.parse(fs.readFileSync(path.join(data, 'game.json'), 'utf8'));
  expect(manifest).toMatchObject({ name: 'Cave Quest', version: '1.2', window: { width: 960, height: 600, fullscreen: false }, splashText: 'Cave Quest', scripts: ['Spinner'] });
  expect(JSON.parse(fs.readFileSync(path.join(data, 'scripts.json'), 'utf8')).scripts.Spinner.js).toContain('defineScript');
  expect(fs.existsSync(path.join(data, 'scenes', 'main.scene.json'))).toBe(true);
  const shipped = walk(data).map((f) => path.relative(data, f).replace(/\\/g, '/'));
  expect(shipped.some((f) => f.endsWith('.ts') || f.startsWith('.') || f.startsWith('saves') || f.includes('autosave') || f === 'export-settings.json' || f === 'project-notes.md')).toBe(false);
  expect(fs.existsSync(path.join(folder, 'resources', 'app.asar'))).toBe(false); // none of the editor's code
  expect(fs.readFileSync(path.join(folder, 'resources', 'app', 'game-main.mjs'), 'utf8')).not.toContain('assistant');
  expect(fs.existsSync(path.join(projectDir, 'export-settings.json'))).toBe(true); // remembered for next time
  await page.getByTestId('export-close').click();

  // ---- run it: no editor, no internet ----
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-game-'));
  const g = await launchGame(exe, userData);
  await g.page.waitForFunction(() => (window as unknown as { __game?: unknown }).__game !== undefined, undefined, { timeout: 60_000 });
  expect(await g.page.title()).toBe('Cave Quest');
  const size = await g.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentSize());
  expect(Math.abs(size[0]! - 960)).toBeLessThanOrEqual(2); // (display scaling can add a pixel)
  expect(Math.abs(size[1]! - 600)).toBeLessThanOrEqual(2);
  expect(await g.page.evaluate(() => ({ store: typeof (window as unknown as { __store?: unknown }).__store, assistant: typeof (window.tilewright as unknown as { assistant?: unknown }).assistant, exporter: typeof (window.tilewright as unknown as { exporter?: unknown }).exporter }))).toEqual({ store: 'undefined', assistant: 'undefined', exporter: 'undefined' });

  const state = () =>
    g.page.evaluate(() => {
      const s = (window as unknown as { __game: { session: { sim: { tick: number; world: { all(): { name: string; get<T>(n: string): T | undefined }[] } } } } }).__game.session.sim;
      const t = (n: string) => s.world.all().find((e) => e.name === n)!.get<{ x: number; y: number; facing: number }>('transform')!;
      return { tick: s.tick, player: { x: t('Player').x, y: t('Player').y }, crateFacing: t('Crate').facing };
    });
  const a = await state();
  await g.page.waitForTimeout(1200);
  const b = await state();
  expect(b.tick).toBeGreaterThan(a.tick + 30); // the game is running
  expect(b.crateFacing).not.toBe(a.crateFacing); // and the script made the crate turn
  await g.page.keyboard.down('ArrowRight');
  await g.page.waitForTimeout(700);
  await g.page.keyboard.up('ArrowRight');
  const c = await state();
  expect(Math.hypot(c.player.x - b.player.x, c.player.y - b.player.y)).toBeGreaterThan(0.5); // the real keyboard moves the player
  await g.page.screenshot({ path: shot('m12-exported-game.png') });

  // the pause menu's video settings: a game in its own window can go full screen (the editor's Play cannot offer that)
  await g.page.evaluate(() => (window as unknown as { __game: { session: { ui: { openMenu(): void } } } }).__game.session.ui.openMenu()); // (the real pause key is exercised by the story test)
  await g.page.getByTestId('tw-row-settings').click();
  await expect(g.page.getByTestId('tw-row-set-zoom')).toBeVisible();
  await g.page.getByTestId('tw-row-set-fullscreen').click();
  await expect.poll(() => g.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(true);
  await g.page.getByTestId('tw-row-set-fullscreen').click();
  await expect.poll(() => g.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen())).toBe(false);
  await g.page.evaluate(() => (window as unknown as { __game: { session: { ui: { closeMenu(): void } } } }).__game.session.ui.closeMenu());

  // it may only touch its own files
  const probe = await g.page.evaluate(async () => {
    const fsApi = window.tilewright.fs;
    const info = await (window.tilewright as unknown as { game: { info(): Promise<{ dataDir: string; savesDir: string }> } }).game.info();
    const attempt = async (f: () => Promise<unknown>): Promise<string> => f().then(() => 'allowed', (e) => String(e.message));
    return {
      outside: await attempt(() => fsApi.read('C:\\Windows\\win.ini')),
      writeData: await attempt(() => fsApi.write(`${info.dataDir}\\game.json`, '{}')),
      writeSaves: await attempt(() => fsApi.write(`${info.savesDir}\\probe.json`, '{}')),
    };
  });
  expect(probe.outside).toContain('outside its own folders');
  expect(probe.writeData).toContain('only write to its save folder');
  expect(probe.writeSaves).toBe('allowed');

  // saving goes to the player's own folder, not the game folder
  await g.page.evaluate(() => (window as unknown as { __game: { session: { saveTo(s: string): Promise<string> } } }).__game.session.saveTo('slot1'));
  await expect.poll(() => fs.existsSync(path.join(userData, 'saves', 'slot1.save.json'))).toBe(true);
  expect(fs.existsSync(path.join(data, 'saves'))).toBe(false);
  expect(g.errors).toEqual([]);
  await g.app.close();

  // ---- a script that fails: a friendly screen, and a log file ----
  await page.getByTestId('btn-ws-code').click();
  await page.getByTestId('script-Spinner').click();
  await writeCode(page, SPINNER_BAD);
  await expect.poll(() => fs.readFileSync(path.join(projectDir, 'assets', 'scripts', 'Spinner.script.ts'), 'utf8')).toContain('Boom from the script');
  await page.waitForTimeout(1500);
  await page.getByTestId('btn-ws-world').click();
  await page.getByTestId('btn-export').click();
  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('export-go').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 240_000 }); // replaces the earlier export
  const exe2 = (await page.getByTestId('export-exe').textContent())!;
  expect(exe2).toBe(exe);
  await page.getByTestId('export-close').click();

  const userData2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-game-'));
  const bad = await launchGame(exe2, userData2);
  await expect(bad.page.getByTestId('game-crash')).toBeVisible({ timeout: 60_000 });
  await expect(bad.page.getByTestId('game-crash-headline')).toContainText('Boom from the script');
  await expect(bad.page.getByTestId('game-crash-where')).toContainText('logs');
  await bad.page.screenshot({ path: shot('m12-game-crash.png') });
  const logs = fs.readdirSync(path.join(userData2, 'logs'));
  expect(logs.length).toBe(1);
  const log = fs.readFileSync(path.join(userData2, 'logs', logs[0]!), 'utf8');
  expect(log).toContain('Cave Quest 1.2');
  expect(log).toContain('Boom from the script');
  await bad.page.getByTestId('game-crash-quit').click();
  await bad.app.waitForEvent('close', { timeout: 30_000 }).catch(() => undefined);

  expect(errors).toEqual([]);
  await app.close();
});
