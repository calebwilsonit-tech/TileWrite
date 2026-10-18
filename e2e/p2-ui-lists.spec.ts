import { expect, test, type Page } from '@playwright/test';
import { clickCell, createProjectViaUi, launchEditor, pickTool } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });
const outline = (page: Page, name: string) => page.getByTestId(`ui-outline-${name}`);
const add = (page: Page, type: string) => page.getByTestId(`ui-palette-${type}`).click();

async function setText(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).fill(value);
  await page.getByTestId(testId).press('Enter');
}

test('Phase 2: lists repeat a UI prefab for every table row, buttons use the row, focus arrows are drawn, and objects carry their own interface', async () => {
  test.setTimeout(240_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Shop Game', 'empty');

  // ---- a table of goods, made in the Data panel ----
  await tab(page, 'Data').click();
  await page.getByTestId('table-new-name').fill('Shop');
  await page.getByTestId('table-new-create').click();
  await page.getByTestId('col-add-id').fill('cost');
  await page.getByTestId('col-add-type').selectOption('number');
  await page.getByTestId('col-add').click();
  for (const [id, name, cost] of [['sword', 'Sword', '30'], ['bow', 'Bow', '45']] as const) {
    await page.getByTestId('row-add').click();
    const rows = await page.evaluate(() => window.__store!.tables.find((t) => t.name === 'Shop')!.rows.length);
    const rowId = `row${rows}`;
    await page.getByTestId(`cell-${rowId}-id`).fill(id);
    await page.getByTestId(`cell-${rowId}-id`).press('Enter');
    await page.getByTestId(`cell-${id}-name`).fill(name);
    await page.getByTestId(`cell-${id}-name`).press('Enter');
    await page.getByTestId(`cell-${id}-cost`).fill(cost);
    await page.getByTestId(`cell-${id}-cost`).press('Enter');
  }

  // ---- a Shop screen: a list whose rows are "name, cost, Buy" ----
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-new-screen-name').fill('Shop');
  await page.getByTestId('ui-new-screen').click();
  await add(page, 'list');
  await setText(page, 'ui-name', 'Goods');
  await page.getByTestId('ui-anchor-c').click();
  await page.getByTestId('ui-source').selectOption('table:Shop');
  await add(page, 'panel');
  await setText(page, 'ui-name', 'Row');
  await page.getByTestId('ui-layout').selectOption('row');
  await page.getByTestId('ui-wmode').selectOption('fill');
  await page.getByTestId('ui-hmode').selectOption('auto');
  await add(page, 'text');
  await setText(page, 'ui-name', 'Label');
  await page.getByTestId('ui-bind-text').click();
  await page.getByTestId('bind-search').fill('row.name');
  await page.getByTestId('bind-item-row.name').click();
  await expect(page.getByTestId('ui-text')).toHaveValue('Some text {row.name}');
  await setText(page, 'ui-text', '{row.name}  -  {row.cost} gold');
  await add(page, 'button');
  await setText(page, 'ui-text', 'Buy');
  await setText(page, 'ui-name', 'Buy');
  await setText(page, 'ui-enabled', '{gold} >= {row.cost}');
  await page.getByTestId('ui-on-click-add').selectOption('setVariable');
  await page.getByTestId('ui-on-click-p0-name').fill('gold');
  await page.getByTestId('ui-on-click-p0-name').press('Enter');
  await page.getByTestId('ui-on-click-p0-op').selectOption('subtract');
  await page.getByTestId('ui-on-click-p0-value').fill('{row.cost}');
  await page.getByTestId('ui-on-click-p0-value').press('Enter');
  await page.getByTestId('ui-on-click-add').selectOption('setVariable');
  await page.getByTestId('ui-on-click-p1-name').fill('owned');
  await page.getByTestId('ui-on-click-p1-name').press('Enter');
  await page.getByTestId('ui-on-click-p1-value').fill('{row.id}');
  await page.getByTestId('ui-on-click-p1-value').press('Enter');

  // ---- the Row becomes a UI prefab; the list repeats it ----
  await outline(page, 'Row').click();
  await page.getByTestId('ui-prefab-name').fill('ShopRow');
  await page.getByTestId('ui-prefab-make').click();
  await expect(page.getByTestId('ui-prefab-ShopRow')).toContainText('(1)');
  await outline(page, 'Goods').click();
  await page.getByTestId('ui-template').selectOption('ShopRow');
  // the leftover instance inside the list is no longer needed
  await outline(page, 'ShopRow').click();
  await page.getByTestId('ui-delete').click();
  const doc = await page.evaluate(() => window.__store!.uiDoc);
  expect(doc.prefabs.map((p) => p.name)).toEqual(['ShopRow']);
  expect(doc.screens[0]!.root.children[0]).toMatchObject({ source: 'table:Shop', template: 'ShopRow' });
  // the preview shows both rows, with the cells filled in
  await expect(page.getByTestId('ui-stage')).toContainText('Sword  -  30 gold');
  await expect(page.getByTestId('ui-stage')).toContainText('Bow  -  45 gold');
  // editing the prefab changes every row (the designer opens the prefab in the same picture)
  await page.getByTestId('ui-prefab-edit-ShopRow').click();
  await expect(page.getByTestId('ui-prefab-banner')).toBeVisible();
  await outline(page, 'Buy').click();
  await setText(page, 'ui-text', 'Purchase');
  await page.getByTestId('ui-prefab-back').click();
  await expect(page.getByTestId('ui-stage').getByText('Purchase')).toHaveCount(2);
  // a question the list asks of a row, with a value to try
  await page.getByTestId('ui-pv-gold').fill('40');
  await expect(page.getByTestId('ui-problems')).toContainText('No problems');

  // ---- focus order: draw an arrow, or make them all ----
  await page.getByTestId('ui-screen-Shop').click();
  await page.getByTestId('ui-mode-focus').click();
  await page.getByTestId('ui-autofocus').click();
  expect(await page.evaluate(() => JSON.stringify(window.__store!.uiDoc.prefabs[0]!.widget.focus))).toBeDefined();
  await page.getByTestId('ui-mode-layout').click();

  // ---- an object with its own interface: a name tag above a crate ----
  await tab(page, 'Inspector').count();
  await page.getByTestId('ui-new-screen-name').fill('Tags');
  await page.getByTestId('ui-new-screen').click();
  await add(page, 'panel');
  await setText(page, 'ui-name', 'Tag');
  await page.getByTestId('ui-wmode').selectOption('fixed');
  await add(page, 'text');
  await setText(page, 'ui-name', 'TagText');
  await setText(page, 'ui-text', '{self.name}');
  await page.getByTestId('ui-outline-Tag').click();
  await page.getByTestId('ui-prefab-name').fill('NameTag');
  await page.getByTestId('ui-prefab-make').click();
  await page.getByTestId('btn-ws-world').click();
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption('crate');
  await clickCell(page, 12, 12);
  await pickTool(page, 'select');
  const crate = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Crate')!.id);
  const p = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, crate);
  await page.mouse.click(p.x, p.y);
  await tab(page, 'Inspector').click();
  await page.getByTestId('add-behavior').selectOption('worldUi');
  await page.getByTestId('add-behavior-ok').click();
  await page.getByTestId('bf-prefab').fill('NameTag');
  await page.getByTestId('bf-prefab').press('Enter');

  // ---- play: the shop screen is opened by the game, buying works, the crate wears its tag ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.evaluate(() => {
    const s = window.__play!.sim;
    s.runtime.vars.gold = 40;
    s.runtime.ui.stack = ['Shop'];
  });
  await expect(page.getByTestId('tw-screen-Shop')).toBeVisible();
  const buy = page.getByTestId('tw-ui-Buy');
  await expect(buy).toHaveCount(2);
  await buy.first().click();
  await expect.poll(() => page.evaluate(() => window.__play!.sim.runtime.vars.gold)).toBe(10);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars.owned)).toBe('sword');
  // 10 gold cannot buy a bow (45): the second Buy is disabled and does nothing
  await buy.nth(1).click({ force: true });
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars.gold)).toBe(10);
  await expect(page.getByTestId('tw-ui-TagText')).toContainText('Crate');
  await page.getByTestId('btn-stop').click();

  expect(errors).toEqual([]);
  await app.close();
});
