import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { loadSampleGame, saveSample, selectObject, setFields, tab } from './sample-helpers';
import { battle, playBattle } from '@tilewright/plugin-turns/playbot';

async function setText(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).fill(value);
  await page.getByTestId(testId).press('Enter');
}

async function addRow(page: Page, table: string, cells: Record<string, string>): Promise<void> {
  await page.getByTestId('row-add').click();
  const count = await page.evaluate((t) => window.__store!.tables.find((x) => x.name === t)!.rows.length, table);
  const rowId = await page.evaluate(([t, n]) => window.__store!.tables.find((x) => x.name === t)!.rows[(n as number) - 1]!.id, [table, count] as const);
  await setText(page, `cell-${rowId}-id`, cells.id!);
  for (const [col, v] of Object.entries(cells)) if (col !== 'id') await setText(page, `cell-${cells.id}-${col}`, v);
}

/**
 * Sample 3 of Phase 2: a roguelike. A dungeon made from a seed each run (rooms and corridors), monsters and the hero moving by turns,
 * loot rolled from a data table when a monster falls, permadeath that starts a new run with a new dungeon, and a clear-the-dungeon goal.
 */
test('Phase 2 sample: roguelike - seeded dungeon, loot table, permadeath and a new run, finished by the playbot', async () => {
  test.setTimeout(480_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Roguelike', 'roguelike');

  // ---- the hero is "the player" (the generator puts that object at the start); a sturdier one ----
  const hero = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Hero')!.id);
  await selectObject(page, hero);
  await page.getByLabel('Tags (comma separated)').fill('unit, blue, player');
  await page.getByLabel('Tags (comma separated)').press('Enter');
  await setFields(page, 'health', { max: 40 });
  await setFields(page, 'turnTaker', { attackDamage: 6, apMax: 5 });

  // ---- a rat becomes a prefab the generator can place; the placed ones leave the scene ----
  const rat = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Rat')!.id);
  await selectObject(page, rat);
  await setFields(page, 'health', { max: 6 });
  await page.locator('.prefab-make summary').click();
  await page.getByTestId('prefab-name').fill('Rat');
  await page.getByTestId('prefab-make').click();
  await expect(page.getByTestId('prefab-banner')).toBeVisible();
  for (const e of await page.evaluate(() => window.__store!.doc!.entities.filter((x) => x.name === 'Rat').map((x) => x.id))) {
    await selectObject(page, e);
    await page.getByTestId('insp-delete').click();
  }
  expect(await page.evaluate(() => window.__store!.doc!.entities.map((e) => e.name).sort())).toEqual(['Controls', 'Hero']);

  // ---- the loot table ----
  await tab(page, 'Data').click();
  await page.getByTestId('table-new-name').fill('Loot');
  await page.getByTestId('table-new-create').click();
  for (const [col, type] of [['weight', 'number'], ['gold', 'number'], ['potions', 'number']] as const) {
    await page.getByTestId('col-add-id').fill(col);
    await page.getByTestId('col-add-type').selectOption(type);
    await page.getByTestId('col-add').click();
  }
  await addRow(page, 'Loot', { id: 'coins', name: 'a handful of coins', weight: '6', gold: '5', potions: '0' });
  await addRow(page, 'Loot', { id: 'potion', name: 'a healing potion', weight: '3', gold: '0', potions: '1' });
  await addRow(page, 'Loot', { id: 'hoard', name: 'a hoard of gold', weight: '1', gold: '25', potions: '0' });
  await addRow(page, 'Loot', { id: 'dust', name: 'nothing but dust', weight: '4', gold: '0', potions: '0' });

  // ---- the dungeon: made again from a new seed on every run, with rats in the rooms ----
  await tab(page, 'Generate').click();
  await page.getByTestId('gen-kind').selectOption('dungeon');
  await page.getByTestId('gen-width').fill('36');
  await page.getByTestId('gen-width').press('Enter');
  await page.getByTestId('gen-height').fill('26');
  await page.getByTestId('gen-height').press('Enter');
  await page.getByTestId('gen-rooms').fill('7');
  await page.getByTestId('gen-rooms').press('Enter');
  await page.getByTestId('gen-seed').fill('11');
  await page.getByTestId('gen-seed').press('Enter');
  await page.getByTestId('gen-lock').uncheck();
  await page.getByTestId('gen-atstart').check();
  await page.getByTestId('gen-add-rule').click();
  await page.getByTestId('gen-rule-prefab-0').selectOption('Rat');
  await page.getByTestId('gen-rule-where-0').selectOption('room');
  await page.getByTestId('gen-rule-count-0').fill('4');
  await page.getByTestId('gen-rule-count-0').press('Enter');
  await expect(page.getByTestId('gen-preview')).toContainText('You can walk from the start to the exit');
  await page.getByTestId('gen-apply').click();
  await page.getByTestId('gen-save').click();
  const made = await page.evaluate(() => ({ w: window.__store!.doc!.map.width, rats: window.__store!.doc!.entities.filter((e) => e.name === 'Rat').length, gen: window.__store!.doc!.generator }));
  expect(made).toMatchObject({ w: 36, rats: 4, gen: { kind: 'dungeon', atStart: true, lockSeed: false } });

  // ---- rules: a rat falls -> roll the loot; the hero falls -> a new run; the red side is gone -> victory ----
  await tab(page, 'Events').click();
  await page.getByTestId('add-row').click();
  const loot = await page.evaluate(() => window.__store!.doc!.events.at(-1)!.id);
  await page.getByTestId(`cond-type-${loot}-0`).selectOption('entityEvent');
  await page.getByTestId(`param-${loot}-c0-who`).selectOption('tag:red');
  await page.getByTestId(`param-${loot}-c0-name`).selectOption('died');
  await page.getByTestId(`add-action-${loot}`).selectOption('rollTable');
  await setText(page, `param-${loot}-a0-table`, 'Loot');
  await page.getByTestId(`add-action-${loot}`).selectOption('message');
  await setText(page, `param-${loot}-a1-text`, 'The rat dropped {roll.name}.');
  for (const [i, v, amount] of [[2, 'gold', '{roll.gold}'], [3, 'potions', '{roll.potions}']] as const) {
    await page.getByTestId(`add-action-${loot}`).selectOption('setVariable');
    await setText(page, `param-${loot}-a${i}-name`, v);
    await page.getByTestId(`param-${loot}-a${i}-op`).selectOption('add');
    await setText(page, `param-${loot}-a${i}-value`, amount);
  }
  await page.getByTestId('add-row').click();
  const death = await page.evaluate(() => window.__store!.doc!.events.at(-1)!.id);
  await page.getByTestId(`cond-type-${death}-0`).selectOption('entityEvent');
  await page.getByTestId(`param-${death}-c0-who`).selectOption('tag:blue');
  await page.getByTestId(`param-${death}-c0-name`).selectOption('died');
  await page.getByTestId(`add-action-${death}`).selectOption('message');
  await setText(page, `param-${death}-a0-text`, 'You have fallen. The dungeon shifts around you...');
  await page.getByTestId(`add-action-${death}`).selectOption('newRun');
  await page.getByTestId('add-row').click();
  const win = await page.evaluate(() => window.__store!.doc!.events.at(-1)!.id);
  await page.getByTestId(`cond-type-${win}-0`).selectOption('battleWon');
  await page.getByTestId(`add-action-${win}`).selectOption('setVariable');
  await setText(page, `param-${win}-a0-name`, 'victory');
  await setText(page, `param-${win}-a0-value`, '1');
  expect(await page.evaluate(() => window.__store!.doc!.events.map((e) => e.actions.map((a) => a.type).join('+')))).toEqual(['startBattle', 'rollTable+message+setVariable+setVariable', 'message+newRun', 'setVariable']);

  // ---- a small screen: run number, gold, potions ----
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-new-screen-name').fill('HUD');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-start').check();
  await page.getByTestId('ui-palette-text').click();
  await setText(page, 'ui-name', 'Run');
  await setText(page, 'ui-text', 'Run {run.count}   Gold {gold}   Potions {potions}');
  await page.getByTestId('btn-ws-world').click();

  // ---- the scene starts with gold and potions at zero (the screen shows them from the first moment) ----
  await tab(page, 'Events').click();
  await page.locator('.events-panel details summary').first().click();
  for (const [i, n] of [[0, 'gold'], [1, 'potions']] as const) {
    await page.getByTestId('add-variable').click();
    await setText(page, `var-name-${i}`, n);
  }
  await tab(page, 'Problems').click();
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- play: the dungeon is made, the hero starts in the first room, the battle begins ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__play!.sim.world.withTag('red').length)).toBe(4);
  expect(await page.evaluate(() => String(window.__play!.sim.runtime.vars['turn.unit']))).toBe('Hero');
  await expect(page.getByTestId('tw-screen-HUD')).toContainText('Run 0   Gold 0   Potions 0');
  await page.screenshot({ path: shot('p2-roguelike-play.png') });
  await page.getByTestId('btn-stop').click();

  const dir = await saveSample(page, 'roguelike');
  expect(errors).toEqual([]);
  await app.close();

  // ---- the bot: first it lets the hero be beaten (permadeath: a new run, a new dungeon, nothing kept) ----
  const { game, bot } = await loadSampleGame(dir);
  bot.wait(0.3);
  const firstSeed = game.sim.runtime.vars['generated.seed'];
  const firstMap = JSON.stringify(game.sim.map!.tiles.slice(0, 2000));
  expect(firstSeed).toBeDefined();
  game.sim.runtime.vars.gold = 40; // carried gold must vanish with the run
  for (let i = 0; i < 60 * 900 && Number(game.sim.runtime.vars['run.count'] ?? 0) === 0; i++) {
    if (battle(bot).active && battle(bot).team === 'blue') bot.press('end_turn');
    else bot.step();
  }
  expect(game.sim.runtime.vars['run.count']).toBe(1);
  bot.wait(0.5);
  expect(game.sim.runtime.vars.gold ?? 0).toBe(0);
  expect(game.sim.runtime.vars['generated.seed']).not.toBe(firstSeed);
  expect(JSON.stringify(game.sim.map!.tiles.slice(0, 2000))).not.toBe(firstMap);
  expect(game.sim.world.withTag('player').length).toBe(1);
  expect(game.sim.world.withTag('red').length).toBe(4);

  // ---- then it plays this run properly: hunts the rats room by room until the dungeon is clear ----
  const r = playBattle(bot, { team: 'blue', maxSeconds: 1500 });
  expect(r.ok, r.message).toBe(true);
  expect(game.sim.runtime.vars.victory).toBe(1);
  expect(Number(game.sim.runtime.vars.gold ?? 0) + Number(game.sim.runtime.vars.potions ?? 0)).toBeGreaterThanOrEqual(0);
  expect(String(game.sim.runtime.vars['roll.id'])).toMatch(/coins|potion|hoard|dust/); // the loot table was rolled
});
