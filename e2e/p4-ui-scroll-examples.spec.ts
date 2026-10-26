import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { add, fakePad, noBrowserControls, outline, padTap, setText } from './ui-helpers';

/**
 * Add-on, section 2 (scrolling), the examples besides the long settings menu, each built in the UI designer only: a horizontal item
 * carousel that snaps, a credits roll that scrolls by itself, a chat log that sticks to the bottom, and a grid inventory with a page
 * indicator.
 */
const attr = async (page: Page, testId: string, name: string): Promise<number> => Number((await page.getByTestId(testId).first().getAttribute(name)) ?? 0);

async function newScreen(page: Page, name: string): Promise<void> {
  await page.getByTestId('ui-new-screen-name').fill(name);
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-modal').check();
}

test('Add-on: a snapping carousel, a credits roll, a chat log that sticks to the bottom, a paged grid with a page indicator', async () => {
  test.setTimeout(480_000);
  const { page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Scrolls', 'empty');
  await page.getByTestId('btn-ws-ui').click();

  // ---- the carousel: a row of cards that scrolls sideways and sticks to a card ----
  await newScreen(page, 'Carousel');
  await add(page, 'list');
  await setText(page, 'ui-name', 'Cards');
  await page.getByTestId('ui-anchor-c').click();
  await setText(page, 'ui-w', '460');
  await setText(page, 'ui-h', '130');
  await page.getByTestId('ui-layout').selectOption('row');
  await setText(page, 'ui-source-custom', 'slots:10');
  await page.getByTestId('ui-scroll-on').check();
  await page.getByTestId('ui-scroll-dir').selectOption('horizontal');
  await page.getByTestId('ui-scroll-snap').selectOption('rows');
  await page.getByTestId('ui-scroll-follow').selectOption('center');
  await add(page, 'button');
  await setText(page, 'ui-name', 'Card');
  await setText(page, 'ui-text', 'Card {slot}');
  await setText(page, 'ui-w', '140');
  await setText(page, 'ui-h', '90');

  // ---- the credits roll: lines that move by themselves, again and again ----
  await newScreen(page, 'Credits');
  await add(page, 'list');
  await setText(page, 'ui-name', 'Roll');
  await page.getByTestId('ui-anchor-c').click();
  await setText(page, 'ui-w', '420');
  await setText(page, 'ui-h', '200');
  await setText(page, 'ui-source-custom', 'slots:30');
  await page.getByTestId('ui-scroll-on').check();
  await setText(page, 'ui-scroll-auto', '160');
  await page.getByTestId('ui-scroll-loop').check();
  await page.getByTestId('ui-scroll-wheel').uncheck();
  await add(page, 'text');
  await setText(page, 'ui-name', 'Credit');
  await setText(page, 'ui-text', 'Made by person {slot}');
  await page.getByTestId('ui-st-normal-align').selectOption('center');
  await page.getByTestId('ui-wmode').selectOption('fill');

  // ---- the chat log: lines arrive, it stays at the bottom, and lets go when the player scrolls up ----
  await newScreen(page, 'Chat');
  await add(page, 'list');
  await setText(page, 'ui-name', 'Log');
  await page.getByTestId('ui-anchor-c').click();
  await setText(page, 'ui-w', '420');
  await setText(page, 'ui-h', '180');
  await setText(page, 'ui-source-custom', 'var:chat_lines');
  await page.getByTestId('ui-scroll-on').check();
  await page.getByTestId('ui-scroll-stick').selectOption('end');
  await page.getByTestId('ui-scroll-motion').selectOption('instant');
  await page.getByTestId('ui-bar-add').click();
  await add(page, 'text');
  await setText(page, 'ui-name', 'Line');
  await setText(page, 'ui-text', 'Message {index}');
  await page.getByTestId('ui-hmode').selectOption('fixed');
  await setText(page, 'ui-h', '28');

  // ---- a grid inventory with pages: it scrolls a page at a time, and a counter says which one ----
  await newScreen(page, 'Bag');
  await add(page, 'panel');
  await setText(page, 'ui-name', 'Bag box');
  await page.getByTestId('ui-anchor-c').click();
  await setText(page, 'ui-w', '420');
  await setText(page, 'ui-h', '340');
  await page.getByTestId('ui-layout').selectOption('column');
  await add(page, 'text');
  await setText(page, 'ui-name', 'Page counter');
  await setText(page, 'ui-text', 'Page {bag.page} of {bag.pages}');
  await outline(page, 'Bag box').click();
  await add(page, 'grid');
  await setText(page, 'ui-name', 'Slots');
  await setText(page, 'ui-w', '400');
  await setText(page, 'ui-h', '280');
  await page.getByTestId('ui-columns').fill('5');
  await page.getByTestId('ui-columns').press('Enter');
  await setText(page, 'ui-source-custom', 'slots:40');
  await page.getByTestId('ui-scroll-on').check();
  await page.getByTestId('ui-scroll-snap').selectOption('pages');
  await setText(page, 'ui-scroll-bind', 'bag');
  await page.getByTestId('ui-bar-add').click();
  await page.getByTestId('ui-bar-pages').check();
  await page.getByTestId('ui-scroll-motion').selectOption('instant');
  await add(page, 'button');
  await setText(page, 'ui-name', 'Slot');
  await setText(page, 'ui-text', '{slot}');
  await setText(page, 'ui-w', '70');
  await setText(page, 'ui-h', '70');
  await expect(page.getByTestId('ui-problems')).toContainText('No problems');

  // ---- play ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await fakePad(page);
  const open = async (name: string): Promise<void> => {
    await page.evaluate((n) => (window.__play!.sim.runtime.ui.stack = [n]), name);
    await page.waitForTimeout(600);
  };

  // the carousel: right on the pad moves to the next card, and the cards slide to sit in whole steps
  await open('Carousel');
  await expect(page.getByTestId('tw-ui-Cards')).toBeVisible();
  const first = (await page.locator('[data-testid="tw-ui-Card"]').nth(0).boundingBox())!;
  const second = (await page.locator('[data-testid="tw-ui-Card"]').nth(1).boundingBox())!;
  const pitch = second.x - first.x;
  for (let i = 0; i < 7; i++) {
    await padTap(page, 15);
    await page.waitForTimeout(350);
    const x = await attr(page, 'tw-ui-Cards', 'data-scroll-x');
    expect(Math.abs(x / pitch - Math.round(x / pitch)), `after ${i + 1} presses the cards sit on a whole step (${x} of ${pitch})`).toBeLessThan(0.03);
    // the chosen card is wholly inside the window
    const inside = await page.evaluate(() => {
      const c = document.querySelector('[data-focus="1"]')!.getBoundingClientRect();
      const w = document.querySelector('[data-testid="tw-ui-Cards"]')!.getBoundingClientRect();
      return c.left >= w.left - 1 && c.right <= w.right + 1;
    });
    expect(inside).toBe(true);
  }
  expect(await attr(page, 'tw-ui-Cards', 'data-scroll-x')).toBeGreaterThan(pitch);
  await page.screenshot({ path: shot('p4-scroll-carousel.png') });

  // the credits: nobody touches anything, and the lines move; after a while they begin again
  await open('Credits');
  await page.waitForTimeout(400);
  const seen: number[] = [];
  for (let i = 0; i < 18; i++) {
    seen.push(await attr(page, 'tw-ui-Roll', 'data-scroll-y'));
    await page.waitForTimeout(400);
  }
  expect(seen[2]!).toBeGreaterThan(seen[0]!);
  expect(seen.some((v, i) => i > 0 && v < seen[i - 1]! - 20), 'it came round to the start again').toBe(true);
  await page.screenshot({ path: shot('p4-scroll-credits.png') });

  // the chat log
  await open('Chat');
  await page.evaluate(() => (window.__play!.sim.runtime.vars.chat_lines = 4));
  await page.waitForTimeout(300);
  expect(await attr(page, 'tw-ui-Log', 'data-scroll-y')).toBe(0); // it all fits
  const grow = async (n: number): Promise<void> => {
    await page.evaluate((count) => (window.__play!.sim.runtime.vars.chat_lines = count), n);
    await page.waitForTimeout(300);
  };
  await grow(20);
  const atEnd = async (): Promise<boolean> =>
    page.evaluate(() => {
      const w = document.querySelector('[data-testid="tw-ui-Log"]')!;
      const last = [...w.querySelectorAll('[data-testid="tw-ui-Line"]')].pop()!.getBoundingClientRect();
      return last.bottom <= w.getBoundingClientRect().bottom + 3 && last.bottom > w.getBoundingClientRect().bottom - 40;
    });
  expect(await atEnd(), 'it follows the newest line').toBe(true);
  await grow(21);
  expect(await atEnd(), 'and the next one').toBe(true);
  await page.getByTestId('tw-ui-Log').hover();
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  const held = await attr(page, 'tw-ui-Log', 'data-scroll-y');
  await grow(23);
  expect(await attr(page, 'tw-ui-Log', 'data-scroll-y'), 'scrolled up: it does not jump back down').toBe(held);
  await page.screenshot({ path: shot('p4-scroll-chat.png') });

  // the bag: a page at a time, and the counter says which
  await open('Bag');
  await page.waitForTimeout(400);
  await expect(page.getByTestId('tw-ui-Page counter')).toHaveText('Page 1 of 3');
  await page.screenshot({ path: shot('p4-scroll-bag-1.png') });
  await padTap(page, 5); // the right shoulder button: a page
  await page.waitForTimeout(400);
  await expect(page.getByTestId('tw-ui-Page counter')).toHaveText('Page 2 of 3');
  const y = await attr(page, 'tw-ui-Slots', 'data-scroll-y');
  expect(y).toBeGreaterThan(100);
  await padTap(page, 5);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('tw-ui-Page counter')).toHaveText('Page 3 of 3');
  await padTap(page, 4);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('tw-ui-Page counter')).toHaveText('Page 2 of 3');
  await page.screenshot({ path: shot('p4-scroll-bag-2.png') });
  await noBrowserControls(page);
  expect(errors).toEqual([]);
});
