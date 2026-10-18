import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { addBehaviors, addObject, loadSampleGame, saveSample, setFields, tab } from './sample-helpers';

const outline = (page: Page, name: string) => page.getByTestId(`ui-outline-${name}`);
const addWidget = (page: Page, type: string) => page.getByTestId(`ui-palette-${type}`).click();
async function setText(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).fill(value);
  await page.getByTestId(testId).press('Enter');
}

/** Colour and size of the selected object, from the Inspector's Look and Collision groups. */
async function look(page: Page, o: { color: string; w: number; d: number; height: number }): Promise<void> {
  await page.getByTestId('insp-color').fill(o.color);
  const lookBox = page.getByRole('group', { name: 'Look' });
  for (const [label, v] of [['Width', o.w], ['Depth', o.d], ['Height', o.height]] as const) {
    await lookBox.getByLabel(label).fill(String(v));
    await lookBox.getByLabel(label).press('Enter');
  }
  const hit = page.getByRole('group', { name: 'Collision' });
  for (const [label, v] of [['Width', o.w], ['Depth', o.d]] as const) {
    await hit.getByLabel(label).fill(String(v));
    await hit.getByLabel(label).press('Enter');
  }
}

async function makePrefab(page: Page, name: string): Promise<void> {
  await page.locator('.prefab-make summary').click();
  await page.getByTestId('prefab-name').fill(name);
  await page.getByTestId('prefab-make').click();
  await expect(page.getByTestId('prefab-banner')).toBeVisible();
}

async function addRow(page: Page, table: string, cells: Record<string, string>): Promise<void> {
  await page.getByTestId('row-add').click();
  const rows = await page.evaluate((t) => window.__store!.tables.find((x) => x.name === t)!.rows.length, table);
  const rowId = await page.evaluate(([t, n]) => window.__store!.tables.find((x) => x.name === t)!.rows[(n as number) - 1]!.id, [table, rows] as const);
  const id = cells.id ?? rowId;
  if (cells.id) await setText(page, `cell-${rowId}-id`, cells.id);
  for (const [col, v] of Object.entries(cells)) {
    if (col === 'id') continue;
    const cell = page.getByTestId(`cell-${id}-${col}`);
    if ((await cell.evaluate((el) => el.tagName)) === 'SELECT') await cell.selectOption(v);
    else {
      await cell.fill(v);
      await cell.press('Enter');
    }
  }
}

/**
 * Sample 2 of Phase 2: a small colony. Footprints and a build menu from a table, resources that are plain variables, producers chained
 * into food -> people -> gold, villagers who walk to their jobs, a speed-up clock, and a goal of 20 people. Everything is made in the
 * editor; the playbot then plays it with the mouse and the on-screen buttons.
 */
test('Phase 2 sample: colony builder - build menu, producers, villagers, speed-up clock, goal of 20 people', async () => {
  test.setTimeout(480_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Colony', 'builder');

  // ---- buildings: a Farm, a Market, and the House learns to turn food into people ----
  const farm = await addObject(page, 'crate', [6, 6], 'Farm', ['farm']);
  await look(page, { color: '#58b368', w: 1.8, d: 1.8, height: 0.8 });
  await addBehaviors(page, farm, ['producer']);
  await setFields(page, 'producer', { makes: 'food:3', uses: '', seconds: 4 });
  await makePrefab(page, 'Farm');
  await page.getByTestId('insp-delete').click();

  const shop = await addObject(page, 'crate', [6, 6], 'Market', ['market']);
  await look(page, { color: '#e0a04a', w: 1.8, d: 1.8, height: 1 });
  await addBehaviors(page, shop, ['producer']);
  await setFields(page, 'producer', { makes: 'gold:6', uses: 'food:1', seconds: 5 });
  await makePrefab(page, 'Market');
  await page.getByTestId('insp-delete').click();

  const house = await addObject(page, 'prefab:House', [6, 6], undefined, undefined);
  await addBehaviors(page, house, ['producer']);
  await setFields(page, 'producer', { makes: 'pop:1', uses: 'food:1', seconds: 6 });
  await page.getByTestId('prefab-apply').click();
  await page.getByTestId('insp-delete').click();
  expect(await page.evaluate(() => [...window.__store!.prefabs.keys()].sort())).toEqual(expect.arrayContaining(['Farm', 'House', 'Market', 'Wall']));
  expect(await page.evaluate(() => window.__store!.prefabs.get('House')!.root.components.producer)).toMatchObject({ makes: 'pop:1', uses: 'food:1' });

  // ---- the build menu table gets the two new rows ----
  await tab(page, 'Data').click();
  await page.getByTestId('data-tab-tables').click();
  await page.getByTestId('table-pick-Buildings').click();
  await addRow(page, 'Buildings', { id: 'farm', name: 'Farm', prefab: 'Farm', w: '2', d: '2', cost: '20' });
  await addRow(page, 'Buildings', { id: 'market', name: 'Market', prefab: 'Market', w: '2', d: '2', cost: '40' });
  await setText(page, 'cell-house-cost', '30');
  expect(await page.evaluate(() => window.__store!.tables.find((t) => t.name === 'Buildings')!.rows.map((r) => `${r.id}:${r.cost}`))).toEqual(['house:30', 'wall:2', 'farm:20', 'market:40']);

  // ---- what villagers do: a table of activities ----
  await page.getByTestId('table-new-name').fill('Activities');
  await page.getByTestId('table-new-create').click();
  for (const [col, type] of [['need', 'text'], ['gain', 'number'], ['target', 'text'], ['seconds', 'number'], ['weight', 'number'], ['when', 'text'], ['makes', 'text']] as const) {
    await page.getByTestId('col-add-id').fill(col);
    await page.getByTestId('col-add-type').selectOption(type);
    await page.getByTestId('col-add').click();
  }
  await addRow(page, 'Activities', { id: 'tend', target: 'farm', seconds: '3', weight: '30', when: 'any', makes: 'food:1' });
  await addRow(page, 'Activities', { id: 'trade', target: 'market', seconds: '3', weight: '25', when: 'any', makes: 'gold:2' });
  expect(await page.evaluate(() => window.__store!.tables.find((t) => t.name === 'Activities')!.rows.length)).toBe(2);

  // ---- two villagers and a clock for the days ----
  await page.getByTestId('btn-ws-world').click();
  for (const [n, x] of [['Villager A', 30], ['Villager B', 32]] as const) {
    const v = await addObject(page, 'crate', [x, 30], n, ['villager']);
    await addBehaviors(page, v, ['utilityAgent']);
    await setFields(page, 'utilityAgent', { table: 'Activities', needs: 'hunger:0.1', speed: 3 });
  }
  const cam = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Camera')!.id);
  await addBehaviors(page, cam, ['calendar']);
  await setFields(page, 'calendar', { dayLength: 60, startHour: 8 });

  // ---- the goal: 20 people. The scene starts with the resources at zero, so the screen can show them from the first moment ----
  await tab(page, 'Events').click();
  for (const [i, name] of [[1, 'food'], [2, 'pop']] as const) {
    await page.getByTestId('add-variable').click();
    await setText(page, `var-name-${i}`, name);
  }
  expect(await page.evaluate(() => window.__store!.doc!.variables)).toEqual([{ name: 'gold', value: 100 }, { name: 'food', value: 0 }, { name: 'pop', value: 0 }]);
  await page.getByTestId('add-row').click();
  const rowId = await page.evaluate(() => window.__store!.doc!.events.at(-1)!.id);
  await page.getByTestId(`cond-type-${rowId}-0`).selectOption('variable');
  await setText(page, `param-${rowId}-c0-name`, 'pop');
  await page.getByTestId(`param-${rowId}-c0-op`).selectOption('>=');
  await setText(page, `param-${rowId}-c0-value`, '20');
  await page.getByTestId(`once-${rowId}`).click();
  await page.getByTestId(`add-action-${rowId}`).selectOption('message');
  await setText(page, `param-${rowId}-a0-text`, 'Your town has {pop} people. It is a real town now!');
  await page.getByTestId(`add-action-${rowId}`).selectOption('setVariable');
  await setText(page, `param-${rowId}-a1-name`, 'won');
  await setText(page, `param-${rowId}-a1-value`, '1');

  // ---- the screen: numbers, speed buttons, and the build menu from the table ----
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-new-screen-name').fill('HUD');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-start').check();
  await addWidget(page, 'panel');
  await setText(page, 'ui-name', 'Bar');
  await page.getByTestId('ui-layout').selectOption('column');
  await addWidget(page, 'text');
  await setText(page, 'ui-name', 'Numbers');
  await setText(page, 'ui-text', 'Gold {gold}   Food {food}   People {pop} / 20   Day {time.day}');
  for (const [name, speed] of [['1x', '1'], ['2x', '2'], ['4x', '4']] as const) {
    await outline(page, 'Bar').click();
    await addWidget(page, 'button');
    await setText(page, 'ui-name', name);
    await setText(page, 'ui-text', name);
    await page.getByTestId('ui-on-click-add').selectOption('setClock');
    await page.getByTestId('ui-on-click-p0-speed').selectOption(speed);
  }
  await outline(page, 'Bar').click();
  await addWidget(page, 'list');
  await setText(page, 'ui-name', 'Menu');
  await page.getByTestId('ui-source').selectOption('table:Buildings');
  await addWidget(page, 'panel');
  await setText(page, 'ui-name', 'Row');
  await page.getByTestId('ui-layout').selectOption('row');
  await addWidget(page, 'button');
  await setText(page, 'ui-name', 'Pick');
  await setText(page, 'ui-text', '{row.name} ({row.cost})');
  await setText(page, 'ui-enabled', '{gold} >= {row.cost}');
  await page.getByTestId('ui-on-click-add').selectOption('selectBuilding');
  await setText(page, 'ui-on-click-p0-row', '{row.id}');
  await outline(page, 'Row').click();
  await page.getByTestId('ui-prefab-name').fill('BuildRow');
  await page.getByTestId('ui-prefab-make').click();
  await outline(page, 'Menu').click();
  await page.getByTestId('ui-template').selectOption('BuildRow');
  await outline(page, 'BuildRow').click();
  await page.getByTestId('ui-delete').click();
  const hud = await page.evaluate(() => window.__store!.uiDoc.screens.find((s) => s.name === 'HUD')!);
  expect(hud.opensOnStart).toBe(true);
  expect(hud.root.children[0]!.children.map((c) => c.name)).toEqual(['Numbers', '1x', '2x', '4x', 'Menu']);
  await page.getByTestId('btn-ws-world').click();
  await tab(page, 'Problems').click();
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- play by hand: the screen is there, a building follows the pointer, speed buttons change the clock ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await expect(page.getByTestId('tw-screen-HUD')).toBeVisible();
  await expect(page.getByTestId('tw-screen-HUD')).toContainText('Gold 100   Food 0   People 0 / 20');
  await page.getByTestId('tw-ui-4x').click();
  expect(await page.evaluate(() => window.__play!.sim.runtime.clock.speed)).toBe(4);
  await page.getByTestId('tw-ui-1x').click();
  await page.screenshot({ path: shot('p2-builder-play.png') });
  expect(await page.evaluate(() => window.__store!.state.runtimeError)).toBeNull();
  await page.getByTestId('btn-stop').click();

  const dir = await saveSample(page, 'colony');
  expect(errors).toEqual([]);
  await app.close();

  // ---- the playbot builds the town with the mouse and the on-screen buttons, at four times the speed ----
  const { game, bot } = await loadSampleGame(dir);
  bot.wait(0.3);
  expect(bot.screenText().join(' ')).toContain('Gold 100');
  expect(bot.pressWidget('4x')).toBe(true);
  expect(game.sim.runtime.clock.speed).toBe(4);
  const build = (button: string, cell: { x: number; y: number }, turn = 0): void => {
    expect(bot.pressWidget(button), `the ${button} button`).toBe(true);
    bot.hover(cell, 2);
    for (let i = 0; i < turn; i++) bot.press('build_rotate');
    expect(game.sim.runtime.vars['build.valid'], String(game.sim.runtime.vars['build.why'])).toBe(true);
    bot.click(cell);
  };
  build('Farm (20)', { x: 12, y: 12 });
  build('Farm (20)', { x: 12, y: 16 });
  build('House (30)', { x: 16, y: 12 });
  build('House (30)', { x: 16, y: 16 });
  expect(game.sim.world.withTag('building').length).toBe(4);
  expect(game.sim.runtime.vars.gold).toBe(0);
  const spots = [[20, 12], [20, 16], [24, 12], [24, 16], [28, 12]] as const;
  let houses = 2;
  let marketBuilt = false;
  for (let i = 0; i < 4000 && Number(game.sim.runtime.vars.pop ?? 0) < 20; i++) {
    bot.wait(1);
    const gold = Number(game.sim.runtime.vars.gold ?? 0);
    if (!marketBuilt && gold >= 40) {
      build('Market (40)', { x: 12, y: 20 });
      marketBuilt = true;
    } else if (marketBuilt && houses < 7 && gold >= 30) {
      const [x, y] = spots[houses - 2]!;
      build('House (30)', { x, y });
      houses++;
    }
  }
  expect(Number(game.sim.runtime.vars.pop)).toBeGreaterThanOrEqual(20);
  expect(game.sim.runtime.vars.won).toBe(1);
  expect(bot.screenText().join(' ')).toMatch(/People 2\d \/ 20/);
  // villagers walked to work: the activities made food and gold beyond what the buildings make
  expect(game.sim.world.withTag('villager').length).toBe(2);
});
