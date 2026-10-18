import { _electron as electron, expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { SAMPLES_DIR } from './sample-helpers';

type Snapshot = Record<string, number>;

async function launchGame(exe: string) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-game-'));
  const app = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, TILEWRIGHT_GAME_TEST: '1', TILEWRIGHT_GAME_USERDATA: userData } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => (window as unknown as { __game?: unknown }).__game !== undefined, undefined, { timeout: 60_000 });
  return { app, page, errors };
}

/** Hold the game still and give it exactly these buttons for some ticks (the mouse's cell and button reach the game this way). */
async function feed(page: Page, snapshot: Snapshot, ticks: number): Promise<void> {
  await page.evaluate(
    ({ snapshot, ticks }) => {
      const s = (window as unknown as { __game: { session: { runner: { paused: boolean; inputSource: () => Snapshot; step(): void } } } }).__game.session;
      s.runner.paused = true;
      s.runner.inputSource = () => snapshot;
      for (let i = 0; i < ticks; i++) s.runner.step();
    },
    { snapshot, ticks },
  );
}

const sim = <T>(page: Page, fn: (s: { tick: number; runtime: { vars: Record<string, unknown>; clock: { speed: number } }; world: { all(): { name: string; tags: Set<string>; get<U>(n: string): U | undefined }[]; withTag(t: string): unknown[] } }) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__game.session.sim)`) as Promise<T>;

/** Open a sample project (a copy of it), export it from the editor's Export dialog, and return the exe. */
async function exportSample(page: Page, workDir: string, sample: string, gameName: string): Promise<string> {
  const copy = path.join(workDir, sample);
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(path.join(SAMPLES_DIR, sample), copy, { recursive: true });
  if (await page.getByTestId('editor-shell').isVisible()) await page.evaluate(() => window.__store!.closeProject());
  await page.evaluate(([d, n]) => window.tilewright.recent.add(d!, n!), [copy, sample]); // a folder is only reopened when it is in the recent list
  await page.evaluate((d) => window.__store!.openRecent(d), copy);
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  await page.getByTestId('btn-export').click();
  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('export-name').fill(gameName);
  await page.getByTestId('export-name').blur();
  await expect(page.getByTestId('export-ready')).toBeVisible();
  await page.getByTestId('export-go').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 300_000 });
  const exe = (await page.getByTestId('export-exe').textContent())!;
  await page.getByTestId('export-close').click();
  await page.evaluate(() => window.__store!.closeProject());
  expect(fs.existsSync(exe)).toBe(true);
  return exe;
}

/**
 * Two of the genre samples are exported to programs of their own and played with no editor on the computer: the tactics battle with the
 * mouse reaching the game as cells, and the colony builder with its screen buttons clicked and a building placed.
 */
test('Phase 2: the tactics and colony samples export to games that run with no editor and play correctly', async () => {
  test.setTimeout(900_000);
  const { page, app, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Scratch', 'empty'); // opening a project is what makes the editor's hooks available; the samples are opened next
  const tactics = await exportSample(page, workDir, 'tactics', 'Tactics Game');
  const colony = await exportSample(page, workDir, 'colony', 'Colony Game');
  expect(errors).toEqual([]);
  await app.close();
  expect(path.basename(path.dirname(tactics))).toContain('Tactics Game');
  for (const exe of [tactics, colony]) {
    const folder = path.dirname(exe);
    expect(fs.existsSync(path.join(folder, 'resources', 'app.asar'))).toBe(false); // none of the editor's code
    expect(fs.existsSync(path.join(folder, 'resources', 'app', 'data', 'game.json'))).toBe(true);
  }

  // ---- tactics ----
  const t = await launchGame(tactics);
  await feed(t.page, {}, 30);
  expect(await sim(t.page, (s) => String(s.runtime.vars['turn.unit']))).toBe('Knight');
  const knightAt = () => sim(t.page, (s) => { const k = s.world.all().find((e) => e.name === 'Knight')!.get<{ x: number; y: number }>('transform')!; return { x: k.x, y: k.y }; });
  const before = await knightAt();
  const cell = { x: Math.floor(before.x), y: Math.floor(before.y) };
  const click = async (c: { x: number; y: number }): Promise<void> => {
    await feed(t.page, { pointer_cx: c.x + 1, pointer_cy: c.y + 1, pointer_primary: 1 }, 2);
    await feed(t.page, { pointer_cx: c.x + 1, pointer_cy: c.y + 1 }, 2);
  };
  await click(cell);
  await click({ x: cell.x + 2, y: cell.y - 1 });
  await feed(t.page, {}, 120);
  const after = await knightAt();
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(1.5); // walked where it was told
  await t.page.screenshot({ path: shot('p2-export-tactics.png') });
  expect(await t.page.evaluate(() => ({ store: typeof (window as unknown as { __store?: unknown }).__store, assistant: typeof (window.tilewright as unknown as { assistant?: unknown }).assistant }))).toEqual({ store: 'undefined', assistant: 'undefined' });
  expect(t.errors).toEqual([]);
  await t.app.close();

  // ---- colony ----
  const c = await launchGame(colony);
  await feed(c.page, {}, 10);
  await expect(c.page.getByTestId('tw-screen-HUD')).toContainText('Gold 100   Food 0   People 0 / 20');
  await c.page.getByTestId('tw-ui-4x').click(); // a real click on the game's own screen
  expect(await sim(c.page, (s) => s.runtime.clock.speed)).toBe(4);
  await c.page.getByTestId('tw-ui-Pick').nth(2).click(); // Farm (20)
  expect(await sim(c.page, (s) => String(s.runtime.vars['build.selected']))).toBe('farm');
  await feed(c.page, { pointer_cx: 13, pointer_cy: 13 }, 3);
  await feed(c.page, { pointer_cx: 13, pointer_cy: 13, pointer_primary: 1 }, 2);
  await feed(c.page, { pointer_cx: 13, pointer_cy: 13 }, 3);
  expect(await sim(c.page, (s) => s.world.withTag('building').length)).toBe(1);
  expect(await sim(c.page, (s) => s.runtime.vars.gold)).toBe(80);
  await feed(c.page, {}, 60 * 12);
  expect(Number(await sim(c.page, (s) => s.runtime.vars.food))).toBeGreaterThan(0); // the farm makes food
  await c.page.screenshot({ path: shot('p2-export-colony.png') });
  expect(c.errors).toEqual([]);
  await c.app.close();
});
