import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { ASPECTS, add, fakePad, fitGame, noBrowserControls, padTap, setText } from './ui-helpers';

/**
 * Add-on, section 3 (sliders, drop-downs), built in the UI designer only: a styled slider with two thumbs, and a drop-down that can be
 * searched. Both are drawn by the engine from parts the designer chose; they answer the keyboard, a gamepad, the mouse, the wheel and
 * touch, at four shapes of screen, and nothing in the game is the browser's own range input or select box.
 */
test('Add-on: a styled two-thumb slider and a searchable drop-down, by keys, pad, mouse and touch', async () => {
  test.setTimeout(420_000);
  const { page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Controls', 'empty');
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-new-screen-name').fill('Filters');
  await page.getByTestId('ui-new-screen').click();

  await add(page, 'panel');
  await setText(page, 'ui-name', 'Form');
  await page.getByTestId('ui-anchor-c').click();
  await setText(page, 'ui-w', '460');
  await setText(page, 'ui-h', '300');
  await page.getByTestId('ui-layout').selectOption('column');
  await page.getByTestId('ui-gap').fill('30');
  await page.getByTestId('ui-gap').press('Enter');

  // the slider: two thumbs, steps of five, marks, the value as words, a sci-fi look, one part of it the designer's own
  await add(page, 'slider');
  await setText(page, 'ui-name', 'Price');
  await setText(page, 'ui-value', 'price_low');
  await setText(page, 'ui-step', '5');
  await setText(page, 'ui-w', '380');
  await page.getByTestId('ui-slider-range').check();
  await setText(page, 'ui-slider-value2', 'price_high');
  await setText(page, 'ui-slider-format', '${value}');
  await page.getByTestId('ui-slider-ticks').selectOption('steps');
  await page.getByTestId('ui-slider-style').selectOption('scifi');
  await page.getByTestId('ui-slider-style-apply').click();
  await page.getByTestId('ui-slider-part-value').selectOption('Sci-fi slider value');
  await page.getByTestId('ui-slider-part-tick').selectOption('Sci-fi slider tick');
  await page.getByTestId('ui-preview-pressed').click(); // the designer shows the pressed look
  await page.getByTestId('ui-preview-normal').click();

  // the drop-down: type to search, a paper look
  await page.getByTestId('ui-outline-Form').click();
  await add(page, 'dropdown');
  await setText(page, 'ui-name', 'Country');
  await setText(page, 'ui-value', 'country');
  await setText(page, 'ui-options', 'Norway, Sweden, Denmark, Finland, Iceland, Estonia, Latvia, Lithuania, Poland, Germany');
  await setText(page, 'ui-w', '260');
  await page.getByTestId('ui-popup-search').check();
  await setText(page, 'ui-popup-rows', '5');
  await page.getByTestId('ui-popup-style').selectOption('paper');
  await page.getByTestId('ui-popup-style-apply').click();
  await page.getByTestId('ui-preview-open').click(); // see it open in the designer
  await expect(page.locator('[data-popup-list]')).toBeVisible();
  await page.screenshot({ path: shot('p4-dropdown-designer-open.png') });
  await page.getByTestId('ui-preview-open').click();
  await expect(page.getByTestId('ui-problems')).toContainText('No problems');

  const doc = await page.evaluate(() => window.__store!.uiDoc);
  const form = doc.screens.find((s) => s.name === 'Filters')!.root.children[0]!;
  expect(form.children[0]!.slider).toMatchObject({ value2: 'price_high', ticks: 'steps', parts: { thumb: 'Sci-fi slider thumb', value: 'Sci-fi slider value' } });
  expect(form.children[1]!.popup).toMatchObject({ search: true, maxRows: 5, parts: { option: 'Old paper pop-up option' } });

  // ---- play it ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.evaluate(() => {
    Object.assign(window.__play!.sim.runtime.vars, { price_low: 20, price_high: 70 });
    window.__play!.sim.runtime.ui.stack.push('Filters');
  });
  await fakePad(page);
  await expect(page.getByTestId('tw-ui-Price')).toBeVisible();
  await page.waitForTimeout(500);
  await noBrowserControls(page);
  const vars = (): Promise<Record<string, unknown>> => page.evaluate(() => ({ ...window.__play!.sim.runtime.vars }));
  const tap = async (k: string): Promise<void> => {
    await page.keyboard.press(k);
    await page.waitForTimeout(110);
  };

  // keys: the low thumb, then Interact chooses the high one, a big step, the pad's d-pad
  await tap('ArrowRight');
  expect((await vars()).price_low).toBe(25);
  await tap('ArrowLeft');
  await tap('ArrowLeft');
  expect((await vars()).price_low).toBe(15);
  await tap('e');
  await tap('ArrowRight');
  expect((await vars()).price_high).toBe(75);
  await tap('PageDown'); // a big step: ten steps
  expect((await vars()).price_high).toBe(100);
  await padTap(page, 14); // the pad: left on the d-pad
  expect((await vars()).price_high).toBe(95);
  await padTap(page, 4); // the left shoulder button: a big step down
  expect((await vars()).price_high).toBe(45);
  // the thumbs never cross
  for (let i = 0; i < 12; i++) await padTap(page, 14, 60);
  expect((await vars()).price_high).toBe(15);
  expect((await vars()).price_low).toBe(15);
  await page.screenshot({ path: shot('p4-slider-range.png') });

  // the mouse: drag a thumb, click the track, the wheel
  const track = (await page.getByTestId('tw-ui-Price').boundingBox())!;
  const thumbs = page.locator('[data-testid="tw-ui-Price"] [data-name="Sci-fi slider thumb"]');
  expect(await thumbs.count()).toBe(2);
  const t2 = (await thumbs.nth(1).boundingBox())!;
  await page.mouse.move(t2.x + t2.width / 2, t2.y + t2.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.9, t2.y + t2.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(((await vars()).price_high as number) >= 85).toBe(true);
  await page.mouse.click(track.x + track.width * 0.1, track.y + track.height / 2);
  await page.waitForTimeout(200);
  expect((await vars()).price_low).toBeLessThanOrEqual(15);
  // touch: a finger on the track
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="tw-ui-Price"]')!;
    const r = el.getBoundingClientRect();
    const fire = (type: string, x: number): void => {
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 3, pointerType: 'touch', isPrimary: true, clientX: x, clientY: r.top + r.height / 2, buttons: type === 'pointerup' ? 0 : 1 }));
    };
    fire('pointerdown', r.left + r.width * 0.45);
    fire('pointermove', r.left + r.width * 0.5);
    fire('pointerup', r.left + r.width * 0.5);
  });
  await page.waitForTimeout(200);
  const mid = (await vars()).price_low as number;
  expect(mid).toBeGreaterThanOrEqual(35);
  expect(mid).toBeLessThanOrEqual(60);

  // ---- the drop-down: Interact opens, typing filters, Back closes with no change ----
  await tap('ArrowDown');
  await tap('e');
  await expect(page.locator('[data-popup-list]')).toBeVisible();
  await page.keyboard.type('sw');
  await page.waitForTimeout(250);
  await expect(page.locator('[data-popup-list] [data-name="Old paper pop-up option"]')).toHaveCount(1);
  await expect(page.locator('[data-popup-list]')).toContainText('Sweden');
  await page.screenshot({ path: shot('p4-dropdown-search.png') });
  await padTap(page, 9); // Back: the pad's Start (P is a letter to search with, and Esc stops the editor's Play)
  await expect(page.locator('[data-popup-list]')).toHaveCount(0);
  expect((await vars()).country).toBeUndefined();
  expect(await page.evaluate(() => window.__play!.sim.runtime.ui.stack)).toEqual(['HUD', 'Filters']); // Back closed the list and nothing else
  await tap('e');
  await page.keyboard.type('land');
  await page.waitForTimeout(250);
  await expect(page.locator('[data-popup-list] [data-name="Old paper pop-up option"]')).toHaveCount(3); // Finland, Iceland, Poland
  await tap('ArrowDown');
  await padTap(page, 0); // the pad's A button chooses
  await expect(page.locator('[data-popup-list]')).toHaveCount(0);
  expect(['Finland', 'Iceland', 'Poland']).toContain(String((await vars()).country));
  // the mouse: open, click an option; clicking outside closes it
  await page.getByTestId('tw-ui-Country').click();
  await expect(page.locator('[data-popup-list]')).toBeVisible();
  await page.locator('[data-popup-list] [data-name="Old paper pop-up option"]', { hasText: 'Estonia' }).click();
  expect((await vars()).country).toBe('Estonia');
  await page.getByTestId('tw-ui-Country').click();
  await expect(page.locator('[data-popup-list]')).toBeVisible();
  await page.mouse.click(40, 560);
  await expect(page.locator('[data-popup-list]')).toHaveCount(0);
  expect((await vars()).country).toBe('Estonia');
  // left and right on the closed box step through the options
  await page.getByTestId('tw-ui-Country').click();
  await page.locator('[data-popup-list] [data-name="Old paper pop-up option"]', { hasText: 'Norway' }).click();
  await tap('ArrowRight');
  expect((await vars()).country).toBe('Sweden');

  for (const shape of ASPECTS) {
    await fitGame(page, shape.w, shape.h);
    await page.getByTestId('tw-ui-Country').click();
    await expect(page.locator('[data-popup-list]')).toBeVisible();
    const inside = await page.evaluate(() => {
      const list = document.querySelector('[data-popup-list]')!.getBoundingClientRect();
      const ui = document.querySelector('[data-testid="tw-ui"]')!.getBoundingClientRect();
      return list.left >= ui.left - 1 && list.right <= ui.right + 1 && list.top >= ui.top - 1 && list.bottom <= ui.bottom + 1;
    });
    expect(inside, `${shape.id}: the list stays inside the screen`).toBe(true);
    await page.screenshot({ path: shot(`p4-dropdown-${shape.id.replace(':', 'x')}.png`) });
    await padTap(page, 9);
  }
  await noBrowserControls(page);
  expect(errors).toEqual([]);
});
