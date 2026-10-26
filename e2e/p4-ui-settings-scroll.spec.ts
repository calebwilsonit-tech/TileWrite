import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { ASPECTS, add, fakePad, fitGame, noBrowserControls, outline, outsideBy, padStick, padTap, scrollY, setText } from './ui-helpers';

/**
 * Add-on, section 2 (scrolling), built in the UI designer only: a settings screen longer than the window, with a scrollbar made of the
 * designer's own widgets, played with the keyboard and a gamepad at four shapes of screen. Every row is reachable and in view when it
 * has the focus, and no browser scrollbar, range input or select box appears in the game.
 */
test('Add-on: a settings screen longer than the window, a custom scrollbar, keyboard and pad, four screen shapes', async () => {
  test.setTimeout(420_000);
  const { page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Long settings', 'empty');
  await page.getByTestId('btn-ws-ui').click();

  // ---- a piece for the scrollbar's thumb, made like any other UI prefab ----
  await page.getByTestId('ui-new-screen-name').fill('Parts');
  await page.getByTestId('ui-new-screen').click();
  await add(page, 'panel');
  await setText(page, 'ui-name', 'Brass thumb');
  await setText(page, 'ui-w', '14');
  await setText(page, 'ui-h', '48');
  await page.getByTestId('ui-st-normal-fill-theme').selectOption('var(--tw-accent)');
  await page.getByTestId('ui-st-normal-radius').fill('7');
  await page.getByTestId('ui-st-normal-radius').press('Enter');
  await page.getByTestId('ui-prefab-name').fill('Brass thumb');
  await page.getByTestId('ui-prefab-make').click();
  await expect(page.getByTestId('ui-prefab-Brass thumb')).toBeVisible();

  // ---- the settings screen: a panel that scrolls, with a slider, a drop-down, a tick box and twelve rows ----
  await page.getByTestId('ui-new-screen-name').fill('Long settings');
  await page.getByTestId('ui-new-screen').click();
  await add(page, 'panel');
  await setText(page, 'ui-name', 'Options');
  await page.getByTestId('ui-anchor-c').click();
  await setText(page, 'ui-w', '520');
  await setText(page, 'ui-h', '340');
  await page.getByTestId('ui-layout').selectOption('column');
  await page.getByTestId('ui-scroll-on').check();
  await expect(page.getByTestId('ui-flag-note')).toHaveCount(0); // a new project has the engine's scrolling on
  await page.getByTestId('ui-bar-add').click();
  await page.getByTestId('ui-bar-show').selectOption('always');
  await setText(page, 'ui-bar-size', '14');
  await page.getByTestId('ui-bar-part-thumb').selectOption('Brass thumb');
  await page.getByTestId('ui-scroll-follow').selectOption('margin');
  await setText(page, 'ui-scroll-margin', '1');

  await add(page, 'slider');
  await setText(page, 'ui-name', 'Volume');
  await setText(page, 'ui-value', 'volume');
  await setText(page, 'ui-step', '5');
  await outline(page, 'Options').click();
  await add(page, 'dropdown');
  await setText(page, 'ui-name', 'Language');
  await setText(page, 'ui-value', 'language');
  await setText(page, 'ui-options', 'English, French, German, Spanish');
  await outline(page, 'Options').click();
  await add(page, 'toggle');
  await setText(page, 'ui-name', 'Music');
  await setText(page, 'ui-text', 'Music');
  await setText(page, 'ui-value', 'music');
  await outline(page, 'Options').click();
  await add(page, 'list');
  await setText(page, 'ui-name', 'Rows');
  await page.getByTestId('ui-hmode').selectOption('auto');
  await page.getByTestId('ui-source').selectOption('slots:12');
  await add(page, 'button');
  await setText(page, 'ui-name', 'Row');
  await setText(page, 'ui-text', 'Option {slot}');
  await setText(page, 'ui-w', '440');
  const doc = await page.evaluate(() => window.__store!.uiDoc);
  const options = doc.screens.find((s) => s.name === 'Long settings')!.root.children[0]!;
  expect(options.scroller?.bar?.parts?.thumb).toBe('Brass thumb');
  expect(options.children.map((c) => c.name)).toEqual(['Volume', 'Language', 'Music', 'Rows']);
  await expect(page.getByTestId('ui-problems')).toContainText('No problems');

  // ---- play it ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.evaluate(() => {
    window.__play!.sim.runtime.vars.volume = 40;
    window.__play!.sim.runtime.ui.stack.push('Long settings');
  });
  await fakePad(page);
  await expect(page.getByTestId('tw-ui-Options')).toBeVisible();
  await page.waitForTimeout(600);
  await noBrowserControls(page);
  // the scrollbar is the designer's own thumb
  await expect(page.locator('[data-testid="tw-ui-Options"] [data-name="Brass thumb"]')).toHaveCount(1);
  await page.screenshot({ path: shot('p4-settings-scroll-start.png') });

  for (const shape of ASPECTS) {
    await fitGame(page, shape.w, shape.h);
    await page.evaluate(() => {
      // back to the top for each shape, with the first thing chosen
      const sim = window.__play!.sim;
      sim.runtime.ui.stack = ['Long settings'];
    });
    await page.waitForTimeout(300);
    // the keyboard: down through everything; each row is wholly in view when it has the focus
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(260);
      const focused = await page.evaluate(() => document.querySelector('[data-focus="1"]')?.getAttribute('data-testid') ?? '');
      if (focused === 'tw-ui-Row') expect(await outsideBy(page, 'tw-ui-Row', 'tw-ui-Options'), `${shape.id}: row on key press ${i}`).toBeLessThanOrEqual(2);
    }
    const lastRow = await page.evaluate(() => document.querySelector('[data-focus="1"]')?.getAttribute('data-row-id'));
    expect(lastRow, `${shape.id}: it reached the last row`).toBe('12');
    expect(await scrollY(page, 'tw-ui-Options')).toBeGreaterThan(100);
    await page.screenshot({ path: shot(`p4-settings-scroll-${shape.id.replace(':', 'x')}.png`) });
    // up again with the pad's d-pad, past the last rows, to the top
    for (let i = 0; i < 14; i++) await padTap(page, 12);
    await page.waitForTimeout(400);
    const top = await page.evaluate(() => document.querySelector('[data-focus="1"]')?.getAttribute('data-testid'));
    expect(top, `${shape.id}: the d-pad walked back to the top`).toBe('tw-ui-Volume');
    expect(await scrollY(page, 'tw-ui-Options')).toBeLessThanOrEqual(2);
  }

  // the right stick scrolls and the shoulder buttons page, without moving the focus
  await fitGame(page, 1280, 720);
  const before = await scrollY(page, 'tw-ui-Options');
  await padStick(page, 3, 1, 700);
  await page.waitForTimeout(500);
  const afterStick = await scrollY(page, 'tw-ui-Options');
  expect(afterStick).toBeGreaterThan(before + 30);
  await padTap(page, 5);
  await page.waitForTimeout(500);
  expect(await scrollY(page, 'tw-ui-Options')).toBeGreaterThan(afterStick);
  await padTap(page, 4);
  await page.waitForTimeout(500);
  // the mouse wheel and dragging the content, with the pointer
  await page.getByTestId('tw-ui-Options').hover();
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(600);
  expect(await scrollY(page, 'tw-ui-Options')).toBeLessThanOrEqual(2);
  // dragging the thumb of the scrollbar
  const thumb = page.locator('[data-testid="tw-ui-Options"] [data-name="Brass thumb"]');
  const tb = (await thumb.boundingBox())!;
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await scrollY(page, 'tw-ui-Options')).toBeGreaterThan(40);
  // touch: dragging the content with a finger
  const y0 = await scrollY(page, 'tw-ui-Options');
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="tw-ui-Row"]')!;
    const r = el.getBoundingClientRect();
    const fire = (type: string, y: number): void => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: r.left + 30, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }));
    fire('pointerdown', r.top + 20);
    for (let i = 1; i <= 8; i++) fire('pointermove', r.top + 20 - i * 12);
    fire('pointerup', r.top - 80);
  });
  await page.waitForTimeout(500);
  expect(await scrollY(page, 'tw-ui-Options')).toBeGreaterThan(y0 + 30);
  await noBrowserControls(page);
  expect(errors).toEqual([]);
});
