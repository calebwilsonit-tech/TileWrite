import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { clickCell, createProjectViaUi, launchEditor, pickTool, shot } from './helpers';

async function play(page: Page, ticks: number): Promise<void> {
  await page.evaluate((n) => {
    window.__store!.set({ paused: true });
    const r = window.__play!.runner;
    r.paused = true;
    r.inputSource = () => ({});
    for (let i = 0; i < n; i++) r.step();
  }, ticks);
  await page.waitForTimeout(60);
}

const byName = (page: Page, name: string): Promise<string> => page.evaluate((n) => window.__store!.doc!.entities.find((e) => e.name === n)!.id, name);

async function clickEntity(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, id);
  await page.mouse.click(p.x, p.y);
}

/** Replace everything in the code editor with `text`. */
async function writeCode(page: Page, text: string): Promise<void> {
  // typing into Monaco auto-indents and auto-closes brackets, which would mangle pasted code: set the model like a paste would
  await page.getByTestId('code-editor').locator('.monaco-editor').click();
  await page.evaluate((t) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__monaco.editor.getEditors()[0].getModel().setValue(t);
  }, text);
}

const SPINNER = `export default defineScript({
  name: 'Spinner',
  settings: { everySeconds: 0.5 },
  start(me, game) {
    console.log('Spinner started on', me.name);
  },
  update(me, game) {
    me.state.t = (me.state.t ?? 0) + game.dt;
    if (me.state.t >= me.settings.everySeconds) {
      me.state.t = 0;
      me.facing += 1;
    }
  },
});
`;

/** Pause, run `ticks` steps, and return every change of the crate's facing (in steps, clockwise). */
const turns = (page: Page, ticks: number): Promise<number[]> =>
  page.evaluate((n) => {
    window.__store!.set({ paused: true });
    const r = window.__play!.runner;
    r.paused = true;
    r.inputSource = () => ({});
    const crate = window.__play!.sim.world.all().find((e) => e.name === 'Crate')!;
    const get = (): number => crate.get<{ facing: number }>('transform')!.facing;
    const out: number[] = [];
    let last = get();
    for (let i = 0; i < n; i++) {
      r.step();
      const now = get();
      if (now !== last) out.push((now - last + 8) % 8);
      last = now;
    }
    return out;
  }, ticks);

test('M10: write a script in the code editor, use it on an object, change it while the game runs, stop at a breakpoint, and turn an event sheet into code', async () => {
  test.setTimeout(240_000);
  const { app, page, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Code Game', 'empty-iso');
  const projectDir = path.join(workDir, 'Code Game');

  // ---- the code editor, with the engine's own types ----
  await page.getByTestId('btn-ws-code').click();
  await page.getByTestId('script-new-name').fill('Spinner');
  await page.getByTestId('script-template').selectOption('empty');
  await page.getByTestId('script-new').click();
  const ed = page.getByTestId('code-editor');
  await expect(ed.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
  await expect(ed).toContainText('defineScript');
  // a type mistake is underlined: this only works if Monaco's TypeScript worker started and knows the engine's API
  await writeCode(page, `export default defineScript({\n  update(me, game) {\n    me.nonsense = 5;\n  },\n});\n`);
  await expect(ed.locator('.squiggly-error').first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: shot('m10-type-error.png') });
  await writeCode(page, SPINNER);
  await expect(ed.locator('.squiggly-error')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId('script-problems')).toContainText('No problems in your scripts');
  await expect.poll(() => fs.existsSync(path.join(projectDir, 'assets', 'scripts', 'Spinner.script.ts'))).toBe(true);
  await expect.poll(() => fs.readFileSync(path.join(projectDir, 'assets', 'scripts', 'Spinner.script.ts'), 'utf8')).toContain("name: 'Spinner'");

  // ---- a script with a mistake is explained, with its line ----
  await page.getByTestId('script-new-name').fill('Broken');
  await page.getByTestId('script-new').click();
  await writeCode(page, `export default defineScript({\n  name: 'Broken',\n  update(me, game) {\n    const x = ;\n  },\n});\n`);
  await expect(page.getByTestId('script-problems')).toContainText('Broken:4', { timeout: 20_000 });
  await page.getByTestId('script-delete').click();
  await expect(page.getByTestId('script-problems')).toContainText('No problems in your scripts', { timeout: 20_000 });
  await page.getByTestId('script-Spinner').click();

  // ---- use it: it is an ordinary behaviour with Inspector settings ----
  await page.getByTestId('btn-ws-world').click();
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption('crate');
  await clickCell(page, 18, 16);
  await pickTool(page, 'select');
  await clickEntity(page, await byName(page, 'Crate'));
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  await page.getByTestId('add-behavior').selectOption('script_Spinner');
  await page.getByTestId('add-behavior-ok').click();
  await expect(page.getByTestId('behavior-script_Spinner')).toBeVisible();
  const every = page.getByTestId('behavior-script_Spinner').getByTestId('bf-everySeconds');
  await every.fill('0.2');
  await every.press('Enter');
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  const first = await turns(page, 90);
  expect(first.length).toBeGreaterThan(3); // every 0.2 s
  expect(first.every((s) => s === 1)).toBe(true); // one step per turn
  expect(await page.evaluate(() => window.__store!.state.log.some((l) => l.text === 'Spinner started on Crate'))).toBe(true);

  // ---- change the script while the game runs: the new code takes over without a restart ----
  await page.getByTestId('btn-ws-code').click();
  await writeCode(page, SPINNER.replace('me.facing += 1;', 'me.facing += 2;'));
  await expect.poll(() => page.evaluate(() => window.__store!.scripts.get('Spinner')!.includes('+= 2'))).toBe(true);
  await page.waitForTimeout(1800); // saved and recompiled
  const steps = await turns(page, 90);
  expect(steps.length).toBeGreaterThan(2);
  expect(steps.every((s) => s === 2)).toBe(true); // every turn is now two steps, not one
  await page.getByTestId('btn-stop').click(); // the play controls stay in reach in the Code window

  // ---- a breakpoint: click beside a line number; the game stops after the step that reached it ----
  await page.getByTestId('btn-ws-code').click();
  await writeCode(page, SPINNER);
  await page.waitForTimeout(1500);
  await page.getByTestId('code-editor').locator('.margin-view-overlays .line-numbers', { hasText: /^11$/ }).click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.breakpoints['Spinner'])).toEqual([11]);
  await expect(page.getByTestId('code-editor').locator('.tw-bp-glyph')).toHaveCount(1);
  await page.waitForTimeout(1500);
  await page.getByTestId('btn-ws-world').click();
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, 40);
  expect(await page.evaluate(() => window.__store!.state.debugHit)).toEqual({ script: 'Spinner', line: 11 });
  await page.getByTestId('btn-ws-code').click();
  await expect(page.getByTestId('debug-hit')).toContainText('Stopped at line 11 of "Spinner"');
  await expect(page.getByTestId('watch-value-me.x')).toHaveText('18.5', { timeout: 10_000 }); // the crate the script is on
  await page.screenshot({ path: shot('m10-breakpoint.png') });
  await page.getByTestId('debug-hit').getByRole('button', { name: 'Stop' }).click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.debugHit)).toBeNull();

  // ---- an event sheet becomes code ----
  await page.getByTestId('btn-ws-world').click();
  await page.locator('.dv-tab').getByText('Events', { exact: true }).click();
  await page.getByTestId('add-row').click();
  await page.getByTestId('events-to-code').click();
  await expect(page.getByTestId('code-view')).toBeVisible();
  await expect(page.getByTestId('script-Event sheet')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('code-editor')).toContainText('Made from the scene', { timeout: 20_000 });
  expect(fs.readFileSync(path.join(projectDir, 'assets', 'scripts', 'Event sheet.script.ts'), 'utf8')).toContain('game.test');

  expect(errors).toEqual([]);
  await app.close();
});
