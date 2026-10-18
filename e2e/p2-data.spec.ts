import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { clickCell, createProjectViaUi, launchEditor, pickTool } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

test('Phase 2: tables, custom components and custom behaviours are made in the Data panel, used on an object, and run in the game', async () => {
  test.setTimeout(180_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Data Game', 'empty');
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);
  await tab(page, 'Data').click();

  // ---- a table: Units with hp and cost ----
  await page.getByTestId('table-new-name').fill('Units');
  await page.getByTestId('table-new-create').click();
  await page.getByTestId('col-add-id').fill('hp');
  await page.getByTestId('col-add-type').selectOption('number');
  await page.getByTestId('col-add').click();
  await page.getByTestId('col-add-id').fill('cost');
  await page.getByTestId('col-add-type').selectOption('number');
  await page.getByTestId('col-add').click();
  await page.getByTestId('row-add').click();
  await page.getByTestId('cell-row1-id').fill('knight');
  await page.getByTestId('cell-row1-id').press('Enter');
  await page.getByTestId('cell-knight-hp').fill('10');
  await page.getByTestId('cell-knight-hp').press('Enter');
  await page.getByTestId('cell-knight-cost').fill('25');
  await page.getByTestId('cell-knight-cost').press('Enter');
  await page.getByTestId('row-add').click();
  await page.getByTestId('cell-row2-id').fill('archer');
  await page.getByTestId('cell-row2-id').press('Enter');
  await page.getByTestId('cell-archer-hp').fill('6');
  await page.getByTestId('cell-archer-hp').press('Enter');
  await page.getByTestId('cell-archer-cost').fill('30');
  await page.getByTestId('cell-archer-cost').press('Enter');
  const file = path.join(dir, 'assets/tables/Units.table.json');
  await expect.poll(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).rows.map((r: { id: string; hp: number }) => `${r.id}:${r.hp}`).join()).toBe('knight:10,archer:6');
  // CSV round trip
  await page.getByTestId('table-csv-show').click();
  await expect(page.getByTestId('table-csv-text')).toHaveValue('id,name,hp,cost\nknight,,10,25\narcher,,6,30\n');
  await page.getByTestId('table-csv-text').fill('id,name,hp,cost\nknight,Knight,10,25\narcher,Archer,6,30\nmage,Mage,4,40\n');
  await page.getByTestId('table-csv-apply').click();
  await expect(page.getByTestId('cell-mage-cost')).toHaveValue('40');

  // ---- a custom component with a number and a row of the table ----
  await page.getByTestId('data-tab-components').click();
  await page.getByTestId('component-new-name').fill('Stats');
  await page.getByTestId('component-new-create').click();
  await page.getByTestId('cmp-newfield').fill('power');
  await page.getByTestId('cmp-addfield').click();
  await page.getByTestId('cmp-default-power').fill('3');
  await page.getByTestId('cmp-default-power').press('Enter');
  await page.getByTestId('cmp-newfield').fill('unit');
  await page.getByTestId('cmp-addfield').click();
  await page.getByTestId('cmp-type-unit').selectOption('tableRow');
  await page.getByTestId('cmp-table-unit').selectOption('Units');
  await expect.poll(() => fs.existsSync(path.join(dir, 'assets/components/Stats.component.json'))).toBe(true);
  // a name the engine uses is refused with a reason
  await page.getByTestId('component-new-name').fill('health');
  await page.getByTestId('component-new-create').click();
  await expect(page.getByText('is already used by the engine')).toBeVisible();

  // ---- a custom behaviour: adds the unit's cost, read from the table, to a counter every tick it runs ----
  await page.getByTestId('data-tab-behaviours').click();
  await page.getByTestId('behavior-new-name').fill('Payer');
  await page.getByTestId('behavior-new-create').click();
  await page.getByTestId('bhv-newfield').fill('unit');
  await page.getByTestId('bhv-addfield').click();
  await page.getByTestId('bhv-type-unit').selectOption('tableRow');
  await page.getByTestId('bhv-table-unit').selectOption('Units');
  await page.getByTestId('rows-add').click();
  const rowId = await page.evaluate(() => window.__store!.customBehaviors.find((b) => b.name === 'Payer')!.rows[0]!.id);
  await page.getByTestId(`action-type-${rowId}-0`).count(); // (a new row has no action yet)
  await page.getByTestId(`add-action-${rowId}`).selectOption('setVariable');
  await page.getByTestId(`param-${rowId}-a0-name`).fill('paid');
  await page.getByTestId(`param-${rowId}-a0-name`).press('Enter');
  await page.getByTestId(`param-${rowId}-a0-op`).selectOption('add');
  await page.getByTestId(`param-${rowId}-a0-value`).fill('{Units.{self.unit}.cost}');
  await page.getByTestId(`param-${rowId}-a0-value`).press('Enter');
  await expect.poll(() => fs.existsSync(path.join(dir, 'assets/behaviors/Payer.behavior.json'))).toBe(true);

  // ---- use both on an object ----
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption('crate');
  await clickCell(page, 12, 12);
  await expect.poll(() => page.evaluate(() => window.__store!.doc!.entities.length)).toBe(1);
  await pickTool(page, 'select');
  const id = await page.evaluate(() => window.__store!.doc!.entities[0]!.id);
  await page.evaluate((i) => window.__store!.select([i]), id);
  await tab(page, 'Inspector').click();
  await page.getByTestId('add-behavior').selectOption('Stats');
  await page.getByTestId('add-behavior-ok').click();
  await page.getByTestId('add-behavior').selectOption('Payer');
  await page.getByTestId('add-behavior-ok').click();
  await expect(page.getByTestId('behavior-Stats').getByTestId('bf-power')).toHaveValue('3');
  await page.getByTestId('behavior-Payer').getByTestId('bf-unit').selectOption('archer');
  await page.getByTestId('behavior-Stats').getByTestId('bf-unit').selectOption('mage');
  expect(await page.evaluate((i) => window.__store!.doc!.getEntity(i)!.components, id)).toMatchObject({ Stats: { power: 3, unit: 'mage' }, Payer: { unit: 'archer' } });

  // ---- the game runs the behaviour: each tick adds the archer's cost (30) ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.evaluate(() => {
    window.__store!.set({ paused: true });
    window.__play!.runner.paused = true;
  });
  const before = Number(await page.evaluate(() => window.__play!.sim.runtime.vars['paid'] ?? 0));
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) window.__play!.runner.step();
  });
  expect(Number(await page.evaluate(() => window.__play!.sim.runtime.vars['paid'])) - before).toBe(120);
  expect(await page.evaluate(() => Object.keys(window.__play!.sim.runtime.vars).filter((k) => k.startsWith('self.')))).toEqual([]);
  await page.getByTestId('btn-stop').click();

  // ---- it all comes back after reopening the project ----
  await page.evaluate(() => window.__store!.flushStory());
  expect(fs.existsSync(path.join(dir, 'assets/tables/Units.table.json'))).toBe(true);
  await page.evaluate(() => window.__store!.closeProject());
  await page.evaluate((d) => window.__store!.openRecent(d), dir);
  await page.getByTestId('editor-shell').waitFor();
  expect(await page.evaluate(() => ({ t: window.__store!.tables.map((t) => `${t.name}:${t.rows.length}`), c: window.__store!.components.map((c) => c.name), b: window.__store!.customBehaviors.map((b) => b.name) }))).toEqual({ t: ['Units:3'], c: ['Stats'], b: ['Payer'] });
  expect(errors).toEqual([]);
  await app.close();
});
