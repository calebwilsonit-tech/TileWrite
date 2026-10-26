import { expect, type Locator, type Page } from '@playwright/test';

/** The shapes the games are tried at: width and height of the picture, in pixels. */
export const ASPECTS = [
  { id: '16:9', w: 1280, h: 720 },
  { id: '16:10', w: 1280, h: 800 },
  { id: '21:9', w: 1680, h: 720 },
  { id: '4:3', w: 960, h: 720 },
] as const;

export const add = (page: Page, type: string): Promise<void> => page.getByTestId(`ui-palette-${type}`).click();
export const outline = (page: Page, name: string): Locator => page.getByTestId(`ui-outline-${name}`);

export async function setText(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).fill(value);
  await page.getByTestId(testId).press('Enter');
}

/** Make the game's picture this size (the screens lay themselves out for what they are given, as they do in a window of that shape). */
export async function fitGame(page: Page, w: number, h: number): Promise<void> {
  await page.evaluate(
    ([width, height]) => {
      const ui = document.querySelector<HTMLElement>('[data-testid="tw-ui"]')!;
      Object.assign(ui.style, { inset: 'auto', left: '0px', top: '0px', width: `${width}px`, height: `${height}px`, outline: '1px solid #fff4' });
    },
    [w, h],
  );
  await page.waitForTimeout(250);
}

/** A gamepad the game can read: buttons and sticks set from the test. */
export async function fakePad(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pad = { id: 'test pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true });
  });
}

/** Press a pad button for a moment (standard layout: 0 A, 1 B, 4 LB, 5 RB, 6 LT, 7 RT, 9 Start, 12 to 15 the d-pad). */
export async function padTap(page: Page, button: number, ms = 110): Promise<void> {
  await page.evaluate((b) => {
    const pad = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } }).__pad;
    pad.buttons[b] = { pressed: true, value: 1 } as never;
  }, button);
  await page.waitForTimeout(ms);
  await page.evaluate((b) => {
    const pad = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } }).__pad;
    pad.buttons[b] = { pressed: false, value: 0 } as never;
  }, button);
  await page.waitForTimeout(70);
}

/** Lean a stick (axes 0 and 1 the left one, 2 and 3 the right one) for a while. */
export async function padStick(page: Page, axis: number, value: number, ms = 300): Promise<void> {
  await page.evaluate(([a, v]) => ((window as unknown as { __pad: { axes: number[] } }).__pad.axes[a!] = v!), [axis, value]);
  await page.waitForTimeout(ms);
  await page.evaluate(([a]) => ((window as unknown as { __pad: { axes: number[] } }).__pad.axes[a!] = 0), [axis]);
  await page.waitForTimeout(70);
}

/** Is a widget (by its test id) wholly inside another's window? Returns how far it is outside, in pixels (0 or less means inside). */
export async function outsideBy(page: Page, inner: string, outer: string): Promise<number> {
  return page.evaluate(
    ([i, o]) => {
      const a = document.querySelector(`[data-testid="${i}"][data-focus="1"]`) ?? document.querySelector(`[data-testid="${i}"]`);
      const b = document.querySelector(`[data-testid="${o}"]`);
      if (!a || !b) return 9999;
      const r = a.getBoundingClientRect();
      const w = b.getBoundingClientRect();
      return Math.max(w.top - r.top, r.bottom - w.bottom, w.left - r.left, r.right - w.right);
    },
    [inner, outer],
  );
}

/** The game's screens must never show the browser's own controls: a range input, a select box, a scrollbar. */
export async function noBrowserControls(page: Page): Promise<void> {
  const found = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tw-ui"]');
    if (!root) return ['no game screens'];
    const bad: string[] = [];
    for (const e of root.querySelectorAll('input[type=range], select, input[type=checkbox], progress, meter')) bad.push(`${e.tagName.toLowerCase()} ${(e as HTMLElement).dataset.testid ?? ''}`);
    for (const e of root.querySelectorAll<HTMLElement>('*')) {
      const s = getComputedStyle(e);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflowX === 'auto' || s.overflowX === 'scroll') && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)) bad.push(`a browser scrollbar on ${e.dataset.testid ?? e.className}`);
    }
    return bad;
  });
  expect(found, 'the browser must not draw any control in a game').toEqual([]);
}

/** Where the engine's scrollers are now (their offsets). */
export const scrollY = async (page: Page, testId: string): Promise<number> => Number((await page.getByTestId(testId).first().getAttribute('data-scroll-y')) ?? 0);
