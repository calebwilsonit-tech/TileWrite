import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchEditor } from './helpers';
import { SAMPLES_DIR } from './sample-helpers';
import { Recorder } from './menus-scenario';

/**
 * Round 2, item 3.2. The keyboard and the pad in menus made in the designer: a project made before (the UI showcase sample, which has no
 * `menuKeys` flag) works as it always did; with the flag (every new project) the first row is chosen when a menu opens, going past the
 * last row comes round, and left and right change a choice or a tick box.
 */
async function playTitle(page: Page, workDir: string, flag: boolean): Promise<Recorder> {
  await page.waitForFunction(() => window.__store !== undefined);
  await page.evaluate(() => window.__store!.closeProject());
  const copy = path.join(workDir, `showcase-${flag ? 'with' : 'without'}`);
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(path.join(SAMPLES_DIR, 'ui-showcase'), copy, { recursive: true });
  await page.evaluate((d) => window.tilewright.recent.add(d, 'showcase'), copy);
  await page.evaluate((d) => window.__store!.openRecent(d), copy);
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  await page.evaluate((on) => window.__store!.updateProjectSettings({ compat: { fadeBySight: true, blockPhysics: true, menuKeys: on } as never }), flag);
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  const rec = new Recorder(page);
  await rec.hold({}, 10);
  await page.waitForTimeout(300);
  await rec.hold({}, 3);
  return rec;
}

const focused = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const stack = window.__play!.sim.runtime.ui.stack;
    const layer = document.querySelector(`[data-testid="tw-screen-${stack[stack.length - 1]}"]`);
    return [...(layer?.querySelectorAll('[data-focus="1"]') ?? [])].map((e) => e.getAttribute('data-name') ?? '');
  });
const widgets = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const stack = window.__play!.sim.runtime.ui.stack;
    const layer = document.querySelector(`[data-testid="tw-screen-${stack[stack.length - 1]}"]`);
    return [...(layer?.querySelectorAll('.tw-w.clickable') ?? [])].filter((e) => !e.closest('.hidden')).map((e) => e.getAttribute('data-name') ?? '');
  });

test('Round 2: menus made in the designer keep the older keyboard rules unless the project has menuKeys, and use the menus\' rules with it', async () => {
  test.setTimeout(300_000);
  const { page, app, workDir, errors } = await launchEditor();

  // ---- without the flag: nothing is chosen until the first press, which chooses the first widget; the last widget is the end ----
  const old = await playTitle(page, workDir, false);
  const names = await widgets(page);
  expect(names.length).toBeGreaterThan(2);
  expect(await focused(page)).toEqual([]);
  await old.press('move_down');
  expect(await focused(page)).toEqual([names[0]]);
  await old.press('move_down');
  expect(await focused(page)).toEqual([names[1]]);
  for (let i = 0; i < names.length + 2; i++) await old.press('move_down');
  expect(await focused(page)).toEqual([names[names.length - 1]]); // it stops at the last one
  await page.getByTestId('btn-stop').click();

  // ---- with it: the first widget is chosen at once, and going past the last comes round to the first ----
  const now = await playTitle(page, workDir, true);
  expect(await focused(page)).toEqual([names[0]]);
  await now.press('move_down');
  expect(await focused(page)).toEqual([names[1]]);
  for (let i = 0; i < names.length - 2; i++) await now.press('move_down');
  expect(await focused(page)).toEqual([names[names.length - 1]]);
  await now.press('move_down');
  expect(await focused(page)).toEqual([names[0]]); // round to the first
  await now.press('move_up');
  expect(await focused(page)).toEqual([names[names.length - 1]]); // and back to the last
  expect(errors).toEqual([]);
  await app.close();
});
