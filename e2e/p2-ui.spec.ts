import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor } from './helpers';

const widgetNamed = (page: Page, name: string) => page.getByTestId(`ui-outline-${name}`);

async function addWidget(page: Page, type: string): Promise<void> {
  await page.getByTestId(`ui-palette-${type}`).click();
}

test('Phase 2: screens are designed in the UI designer - widgets, layout, bindings, actions, flow, resolutions - and played', async () => {
  test.setTimeout(240_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'UI Game', 'empty');
  await page.getByTestId('btn-ws-ui').click();
  await expect(page.getByTestId('ui-designer')).toBeVisible();

  // ---- a Title screen: a column of buttons ----
  await page.getByTestId('ui-new-screen-name').fill('Title');
  await page.getByTestId('ui-new-screen').click();
  await expect(page.getByTestId('ui-screen-Title')).toBeVisible();
  await page.getByTestId('ui-screen-modal').check();
  await page.getByTestId('ui-screen-start').check();
  await addWidget(page, 'panel');
  await page.getByTestId('ui-name').fill('Menu');
  await page.getByTestId('ui-name').press('Enter');
  await page.getByTestId('ui-anchor-c').click();
  await page.getByTestId('ui-layout').selectOption('column');
  await page.getByTestId('ui-align').selectOption('stretch');
  await addWidget(page, 'text');
  await page.getByTestId('ui-text').fill('Guild of Lanterns');
  await page.getByTestId('ui-text').press('Enter');
  for (const label of ['New game', 'Settings', 'Quit']) {
    await addWidget(page, 'button');
    await page.getByTestId('ui-text').fill(label);
    await page.getByTestId('ui-text').press('Enter');
    await page.getByTestId('ui-name').fill(label);
    await page.getByTestId('ui-name').press('Enter');
  }
  // the buttons sit inside the panel, in order
  const doc1 = await page.evaluate(() => window.__store!.uiDoc.screens[0]!.root.children[0]!.children.map((c) => `${c.type}:${c.name}`));
  expect(doc1).toEqual(['text:Text', 'button:New game', 'button:Settings', 'button:Quit']);

  // ---- a second screen: Settings, with a slider and a tick box tied to the player's settings ----
  await page.getByTestId('ui-new-screen-name').fill('Settings');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-modal').check();
  await addWidget(page, 'panel');
  await page.getByTestId('ui-name').fill('Box');
  await page.getByTestId('ui-name').press('Enter');
  await page.getByTestId('ui-anchor-c').click();
  await page.getByTestId('ui-layout').selectOption('column');
  await addWidget(page, 'slider');
  await page.getByTestId('ui-name').fill('Music');
  await page.getByTestId('ui-name').press('Enter');
  await page.getByTestId('ui-bind-value').click();
  await page.getByTestId('bind-search').fill('settings.music');
  await page.getByTestId('bind-item-settings.music').click();
  await page.getByTestId('ui-max').fill('1');
  await page.getByTestId('ui-max').press('Enter');
  await page.getByTestId('ui-step').fill('0.1');
  await page.getByTestId('ui-step').press('Enter');
  await addWidget(page, 'toggle');
  await page.getByTestId('ui-text').fill('Show frame rate');
  await page.getByTestId('ui-text').press('Enter');
  await page.getByTestId('ui-value').fill('settings.showFps');
  await page.getByTestId('ui-value').press('Enter');
  await addWidget(page, 'button');
  await page.getByTestId('ui-text').fill('Back');
  await page.getByTestId('ui-text').press('Enter');
  await page.getByTestId('ui-name').fill('Back');
  await page.getByTestId('ui-name').press('Enter');
  await page.getByTestId('ui-on-click-add').selectOption('uiScreen');
  await page.getByTestId('ui-on-click-p0-op').selectOption('back');

  // ---- the Title's Settings button opens it; New game closes the title ----
  await page.getByTestId('ui-screen-Title').click();
  await widgetNamed(page, 'Settings').click();
  await page.getByTestId('ui-on-click-add').selectOption('uiScreen');
  await page.getByTestId('ui-on-click-p0-screen').selectOption('Settings');
  await widgetNamed(page, 'New game').click();
  await page.getByTestId('ui-on-click-add').selectOption('uiScreen');
  await page.getByTestId('ui-on-click-p0-op').selectOption('close');
  await page.getByTestId('ui-on-click-p0-screen').selectOption('Title');
  await widgetNamed(page, 'Quit').click();
  await page.getByTestId('ui-on-click-add').selectOption('quitGame');
  // a hover colour and a click movement for the New game button
  await widgetNamed(page, 'New game').click();
  await page.getByTestId('ui-state-hover').click();
  await page.getByTestId('ui-st-hover-fill').fill('#ff5d6c');
  await page.getByTestId('ui-add-anim').click();

  // ---- drag a widget from the palette to the bottom right of the picture: it pins itself there ----
  const box = await page.getByTestId('ui-stage').boundingBox();
  expect(box!.width).toBeGreaterThan(300);
  const pal = await page.getByTestId('ui-palette-text').boundingBox();
  await page.mouse.move(pal!.x + 10, pal!.y + 10);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5, { steps: 6 });
  await page.mouse.move(box!.x + box!.width * 0.92, box!.y + box!.height * 0.92, { steps: 6 });
  await page.mouse.up();
  const dropped = await page.evaluate(() => window.__store!.uiDoc.screens[0]!.root.children.find((c) => c.type === 'text')!);
  expect(dropped).toMatchObject({ type: 'text', anchor: 'br' });
  expect(dropped.x).toBeLessThan(0);
  // dragging the selected widget in the picture moves it, and a handle resizes it
  const sel = await page.getByTestId('ui-selbox').boundingBox();
  await page.mouse.move(sel!.x + sel!.width / 2, sel!.y + sel!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.1, box!.y + box!.height * 0.1, { steps: 8 });
  await page.mouse.up();
  expect((await page.evaluate(() => window.__store!.uiDoc.screens[0]!.root.children.find((c) => c.type === 'text')!)).anchor).toBe('tl');
  const handle = await page.getByTestId('ui-handle-se').boundingBox();
  const wBefore = (await page.evaluate(() => window.__store!.uiDoc.screens[0]!.root.children.find((c) => c.type === 'text')!)).w;
  await page.mouse.move(handle!.x + 5, handle!.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 85, handle!.y + 25, { steps: 5 });
  await page.mouse.up();
  expect((await page.evaluate(() => window.__store!.uiDoc.screens[0]!.root.children.find((c) => c.type === 'text')!)).wMode).toBe('fixed');
  // undo takes the last change back
  await page.getByTestId('ui-undo').click();
  expect((await page.evaluate(() => window.__store!.uiDoc.screens[0]!.root.children.find((c) => c.type === 'text')!)).w).toBe(wBefore);

  // ---- the flow map shows the arrows ----
  await page.getByTestId('ui-mode-flow').click();
  await expect(page.getByTestId('ui-flow-edge')).toHaveCount(1);
  await expect(page.getByTestId('ui-flow-screen-Title')).toBeVisible();
  await page.getByTestId('ui-mode-layout').click();

  // ---- different pictures: widescreen, ultrawide, 4:3 ----
  for (const [id, w, h] of [['21:9', 1680, 720], ['4:3', 960, 720], ['16:10', 1280, 800]] as const) {
    await page.getByTestId('ui-resolution').selectOption(id);
    await expect(page.getByTestId('ui-stage')).toHaveAttribute('data-res', id);
    const size = await page.getByTestId('ui-stage').evaluate((e) => ({ w: (e as HTMLElement).style.width, h: (e as HTMLElement).style.height }));
    expect(size).toEqual({ w: `${w}px`, h: `${h}px` });
  }
  await page.getByTestId('ui-resolution').selectOption('16:9');

  // ---- play: the Title opens first, Settings opens on top, the slider changes the music volume, Back returns, New game starts ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await expect(page.getByTestId('tw-screen-Title')).toBeVisible();
  expect(await page.evaluate(() => window.__play!.sim.runtime.ui.modal)).toBe(true);
  await page.getByTestId('tw-ui-Settings').click();
  await expect(page.getByTestId('tw-screen-Settings')).toBeVisible();
  const music = page.getByTestId('tw-ui-Music').locator('input');
  await music.fill('0.3');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('tilewright.settings') ?? '{}').music)).toBeCloseTo(0.3, 1);
  await page.getByTestId('tw-ui-Back').click();
  await expect(page.getByTestId('tw-screen-Settings')).toHaveCount(0);
  await page.getByTestId('tw-ui-New game').click();
  await expect(page.getByTestId('tw-screen-Title')).toHaveCount(0);
  expect(await page.evaluate(() => window.__play!.sim.runtime.ui.modal)).toBe(false);
  await page.getByTestId('btn-stop').click();

  expect(errors).toEqual([]);
  await app.close();
});
