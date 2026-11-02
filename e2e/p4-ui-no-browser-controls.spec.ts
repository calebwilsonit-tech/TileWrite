import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { ASPECTS, fakePad, fitGame, noBrowserControls, padTap } from './ui-helpers';

/**
 * Add-on, "done when": no browser scrollbar, range input or select box appears in any game screen, at any of the four shapes of screen,
 * and every row of the engine's own long screens (Settings, Controls) is reachable and in view when it has the focus, with the keyboard
 * and with a gamepad. These are the screens every new game has, so this is also the old screens under the new controls.
 */
const SCREENS = ['Title', 'Pause', 'Inventory', 'Map', 'Save game', 'Load game', 'Settings', 'Controls'];

test('Add-on: no browser control in any of the game’s screens, at four shapes; long screens keep the chosen row in view', async () => {
  test.setTimeout(420_000);
  const { page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Screens', 'empty');
  await page.evaluate(() => window.__store!.updateProjectSettings({ plugins: ['inventory'] }));
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await fakePad(page);

  const open = async (name: string): Promise<void> => {
    await page.evaluate((n) => {
      const sim = window.__play!.sim;
      sim.runtime.ui.stack = [n];
      sim.runtime.vars.difficulty_locked = 0;
    }, name);
    await page.waitForTimeout(500);
  };
  /** Is the chosen widget in view: inside the screen and inside every scrolling window around it? */
  const focusedInView = (): Promise<{ ok: boolean; what: string }> =>
    page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('[data-focus="1"]');
      if (!el) return { ok: false, what: 'nothing has the focus' };
      const r = el.getBoundingClientRect();
      let ok = true;
      const box: Element | null = document.querySelector('[data-testid="tw-ui"]');
      const windows: Element[] = box ? [box] : [];
      for (let p = el.parentElement; p; p = p.parentElement) if (p.classList.contains('tw-scroller')) windows.push(p);
      for (const w of windows) {
        const b = w.getBoundingClientRect();
        if (r.top < b.top - 2 || r.bottom > b.bottom + 2 || r.left < b.left - 2 || r.right > b.right + 2) ok = false;
      }
      return { ok, what: el.dataset.testid ?? el.className };
    });

  for (const shape of ASPECTS) {
    await fitGame(page, shape.w, shape.h);
    for (const name of SCREENS) {
      await open(name);
      await expect(page.locator(`[data-testid="tw-screen-${name}"]`), `${shape.id}: ${name} is open`).toBeVisible();
      await noBrowserControls(page);
    }

    // Settings: sliders and choices are the engine's own, and the keyboard walks every row of it
    await open('Settings');
    expect(await page.locator('[data-testid="tw-ui"] .engine-slider').count(), `${shape.id}: the settings sliders are drawn by the engine`).toBeGreaterThan(2);
    await page.screenshot({ path: shot(`p4-settings-engine-${shape.id.replace(':', 'x')}.png`) });
    const rows = await page.evaluate(() => document.querySelectorAll('[data-testid="tw-screen-Settings"] .clickable, [data-testid="tw-screen-Settings"] .engine-slider, [data-testid="tw-screen-Settings"] .engine-control').length);
    expect(rows).toBeGreaterThan(8);
    for (let i = 0; i < rows + 2; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(190);
      const v = await focusedInView();
      expect(v.ok, `${shape.id}: Settings, key press ${i}: ${v.what} is in view`).toBe(true);
    }
    for (let i = 0; i < rows + 2; i++) {
      await padTap(page, 12);
      await page.waitForTimeout(120);
      const v = await focusedInView();
      expect(v.ok, `${shape.id}: Settings, pad press ${i}: ${v.what} is in view`).toBe(true);
    }

    // Controls: a long list of controls, every one in reach
    await open('Controls');
    const controls = await page.locator('[data-testid="tw-screen-Controls"] [data-testid="tw-ui-Control"]').count();
    expect(controls, `${shape.id}: the Controls screen lists the controls`).toBeGreaterThan(8);
    for (let i = 0; i < controls + 2; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(170);
      const v = await focusedInView();
      expect(v.ok, `${shape.id}: Controls, key press ${i}: ${v.what} is in view`).toBe(true);
    }
    await page.screenshot({ path: shot(`p4-controls-engine-${shape.id.replace(':', 'x')}.png`) });
  }
  expect(errors).toEqual([]);
});
