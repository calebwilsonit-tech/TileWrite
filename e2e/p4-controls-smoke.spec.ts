import { expect, test } from '@playwright/test';
import { UiDocSchema, newWidget, type UiNode } from '@tilewright/runtime';
import { createProjectViaUi, launchEditor, shot, ui } from './helpers';

let n = 0;
const w = (type: Parameters<typeof newWidget>[0], patch: Partial<UiNode> = {}): UiNode => ({ ...newWidget(type, `w${++n}`), ...patch }) as UiNode;

test('Phase 4 smoke: the controls the engine draws appear, with no browser slider, select or scrollbar', async () => {
  test.setTimeout(180_000);
  const { page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Controls', 'empty');
  const doc = UiDocSchema.parse({
    screens: [
      {
        id: 'smoke',
        name: 'Smoke',
        modal: true,
        root: w('panel', {
          name: 'Smoke box',
          anchor: 'c',
          w: 520,
          h: 460,
          layout: 'column',
          children: [
            w('slider', { name: 'Volume', value: 'vol', min: 0, max: '100', step: 5, w: 300, h: 28, wMode: 'fixed' }),
            w('dropdown', { name: 'Language', value: 'lang', options: 'English, French, German', w: 240, h: 32 }),
            w('toggle', { name: 'Music', text: 'Music', value: 'music' }),
            w('textfield', { name: 'Hero name', value: 'hero', w: 240, h: 32, field: { placeholder: 'Your name', maxLength: 12, allow: 'name' } as never }),
            w('list', { name: 'Rows', source: 'var:n', w: 300, h: 160, scroller: { bar: { show: 'always' } } as never, children: [w('button', { name: 'Row', text: 'Row {index}', w: 280, h: 36 })] }),
          ],
        }),
      },
    ],
  });
  await page.evaluate((d) => window.__store!.setUiDoc(d as never), doc as never);
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.evaluate(() => {
    const sim = window.__play!.sim;
    sim.runtime.vars.vol = 40;
    sim.runtime.vars.lang = 'French';
    sim.runtime.vars.n = 30;
    sim.runtime.ui.stack.push('Smoke');
  });
  await expect(ui(page, 'Volume')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('p4-controls-smoke.png') });
  expect(await page.locator('[data-testid="tw-ui"] input[type=range], [data-testid="tw-ui"] select').count()).toBe(0);
  expect(await page.evaluate(() => window.__play!.sim.compat.uiControls)).toBe(true);
  // the list scrolls with the wheel, with no browser scrollbar
  const rows = ui(page, 'Rows');
  await rows.hover();
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(600);
  const y = await rows.getAttribute('data-scroll-y');
  expect(Number(y)).toBeGreaterThan(100);
  await page.screenshot({ path: shot('p4-controls-smoke-scrolled.png') });
  expect(errors).toEqual([]);
});

test('Phase 4 smoke: keys drive the slider, the drop-down, the field and the list (the chosen row stays in view)', async () => {
  test.setTimeout(180_000);
  const { page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Controls2', 'empty');
  const doc = UiDocSchema.parse({
    screens: [
      {
        id: 'smoke',
        name: 'Smoke',
        modal: true,
        root: w('panel', {
          name: 'Box',
          anchor: 'c',
          w: 460,
          h: 420,
          layout: 'column',
          children: [
            w('slider', { name: 'Volume', value: 'vol', min: 0, max: '100', step: 5, w: 300, h: 28 }),
            w('dropdown', { name: 'Language', value: 'lang', options: 'English, French, German', w: 240, h: 32 }),
            w('textfield', { name: 'Hero name', value: 'hero', w: 240, h: 32, field: { maxLength: 12, allow: 'name' } as never }),
            w('list', { name: 'Rows', source: 'var:n', w: 300, h: 160, scroller: { bar: { show: 'always' } } as never, children: [w('button', { name: 'Row', text: 'Row {index}', w: 280, h: 36 })] }),
          ],
        }),
      },
    ],
  });
  await page.evaluate((d) => window.__store!.setUiDoc(d as never), doc as never);
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.evaluate(() => {
    window.__play!.sim.runtime.vars.n = 30;
    window.__play!.sim.runtime.vars.vol = 50;
    window.__play!.sim.runtime.ui.stack.push('Smoke');
  });
  const vars = (): Promise<Record<string, unknown>> => page.evaluate(() => ({ ...window.__play!.sim.runtime.vars }));
  const press = async (k: string, times = 1): Promise<void> => {
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(k);
      await page.waitForTimeout(90);
    }
  };
  await page.waitForTimeout(400);
  // the slider is chosen first: arrows step it by its own mapped buttons (A and D, the arrows)
  await press('ArrowRight');
  expect((await vars()).vol).toBe(55);
  await press('ArrowLeft', 2);
  expect((await vars()).vol).toBe(45);
  // down to the drop-down; Interact opens it, down and Interact choose German
  await press('ArrowDown');
  await press('e');
  await expect(page.locator('[data-popup-list]')).toBeVisible();
  await page.screenshot({ path: shot('p4-controls-dropdown-open.png') });
  await press('ArrowDown');
  await press('ArrowDown');
  await press('e');
  expect((await vars()).lang).toBe('German');
  await expect(page.locator('[data-popup-list]')).toHaveCount(0);
  // Back closes an open list with no change and stays on the screen
  await press('e');
  await expect(page.locator('[data-popup-list]')).toBeVisible();
  await press('p');
  await expect(page.locator('[data-popup-list]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__play!.sim.runtime.ui.stack.includes('Smoke'))).toBe(true);
  // the field: Interact starts typing, Enter keeps it
  await press('ArrowDown');
  await press('e');
  await page.keyboard.type('Ada Lovelace the Great');
  await page.keyboard.press('Enter');
  expect((await vars()).hero).toBe('Ada Lovelace');
  // the list: down through all thirty rows; every chosen row is inside the list's window
  await press('ArrowDown');
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(350); // (it eases to the new place)
    const box = await page.evaluate(() => {
      const focused = document.querySelector('[data-testid="tw-ui-Row"][data-focus="1"]');
      const list = document.querySelector('[data-testid="tw-ui-Rows"]');
      if (!focused || !list) return null;
      const f = focused.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      return { top: f.top - l.top, bottom: l.bottom - f.bottom };
    });
    expect(box, 'row ' + i).not.toBeNull();
    expect(box!.top).toBeGreaterThanOrEqual(-1);
    expect(box!.bottom).toBeGreaterThanOrEqual(-1);
    await press('ArrowDown');
  }
  await page.screenshot({ path: shot('p4-controls-list-end.png') });
  expect(await page.locator('[data-testid="tw-ui"] input[type=range], [data-testid="tw-ui"] select').count()).toBe(0);
  expect(errors).toEqual([]);
});
