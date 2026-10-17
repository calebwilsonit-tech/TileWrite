import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor } from './helpers';

type GameWindow = { __game: { session: { sim: { tick: number; world: { all(): { name: string; get<T>(n: string): T | undefined }[] } } } } };

test('M14: the game runs in a window of its own beside the editor, restarts with the latest edits, and can only touch its own files', async () => {
  test.setTimeout(150_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Window Game', 'starter-room');
  const crateId = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Crate')!.id);

  const open = async (): Promise<Page> => {
    const next = app.waitForEvent('window');
    await page.getByTestId('btn-run-window').click();
    const win = await next;
    await win.waitForFunction(() => (window as unknown as { __game?: unknown }).__game !== undefined, undefined, { timeout: 60_000 });
    return win;
  };
  const crateX = (w: Page) => w.evaluate(() => (window as unknown as GameWindow).__game.session.sim.world.all().find((e) => e.name === 'Crate')!.get<{ x: number }>('transform')!.x);

  // ---- the first window ----
  const first = await open();
  expect(await first.title()).toBe('Window Game (running from the editor)');
  expect(app.windows()).toHaveLength(2);
  const t0 = await first.evaluate(() => (window as unknown as GameWindow).__game.session.sim.tick);
  await first.waitForTimeout(600);
  expect(await first.evaluate(() => (window as unknown as GameWindow).__game.session.sim.tick)).toBeGreaterThan(t0 + 20); // it is running
  expect(await crateX(first)).toBe(11.5);
  await expect(page.getByTestId('btn-run-window')).toBeVisible(); // and the editor is still there to use

  // it is the exported game's page: no editor code, and a file bridge limited to its own folders
  const probe = await first.evaluate(async () => {
    const api = window.tilewright as unknown as { fs: { read(f: string): Promise<string>; write(f: string, t: string): Promise<void> }; game: { info(): Promise<{ dataDir: string; savesDir: string }> }; assistant?: unknown };
    const info = await api.game.info();
    const attempt = async (f: () => Promise<unknown>): Promise<string> => f().then(() => 'allowed', (e) => String((e as Error).message));
    return {
      editorApi: typeof api.assistant,
      outside: await attempt(() => api.fs.read('C:\\Windows\\win.ini')),
      writeData: await attempt(() => api.fs.write(`${info.dataDir}\\game.json`, '{}')),
    };
  });
  expect(probe.editorApi).toBe('undefined');
  expect(probe.outside).toContain('outside its own folders');
  expect(probe.writeData).toContain('only write to its save folder');

  // ---- edit, run again: the old window is replaced by a new one with the edit in it ----
  await page.evaluate((id) => {
    window.__store!.doc!.updateEntities([id], 'Move crate', (e) => {
      (e.components.transform as { x: number }).x = 14.5;
    });
  }, crateId);
  const closed = first.waitForEvent('close');
  const second = await open();
  await closed;
  expect(await crateX(second)).toBe(14.5); // the unsaved edit was saved and used
  expect(app.windows().filter((w) => !w.isClosed())).toHaveLength(2);

  // ---- closing the editor closes the game windows with it ----
  expect(errors).toEqual([]);
  await app.close();
});
