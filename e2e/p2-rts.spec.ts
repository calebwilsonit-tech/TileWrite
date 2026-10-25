import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';
import { addBehaviors, addObject, loadSampleGame, look, makePrefab, saveSample, selectObject, setFields, setText, tab } from './sample-helpers';

const outline = (page: Page, name: string) => page.getByTestId(`ui-outline-${name}`);
const addWidget = (page: Page, type: string) => page.getByTestId(`ui-palette-${type}`).click();

/**
 * Sample 6 of Phase 2 (a genre of my own choosing): a small real-time strategy skirmish. Box-select your footmen, right-click to move,
 * attack-move into an enemy camp; a mine makes gold, a barracks trains more footmen from a button; destroy the enemy nest and its
 * guards to win. Made from the Empty starter with the Control schemes, Combat and Simulation packs; played by the playbot with the mouse.
 */
test('Phase 2 sample: real-time strategy - box select, orders, a mine, a barracks, an enemy camp', async () => {
  test.setTimeout(600_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Skirmish', 'empty');

  await page.getByTestId('btn-project-settings').click();
  await page.getByTestId('ps-tab-plugins').click();
  for (const p of ['controls', 'combat', 'sim']) {
    await page.getByTestId(`plugin-toggle-${p}`).click();
    await expect(page.getByTestId(`plugin-toggle-${p}`)).toBeChecked();
  }
  await page.mouse.click(5, 400);
  await expect(page.getByTestId('project-settings')).toHaveCount(0);

  // ---- terrain: a ridge across the middle with a pass in it ----
  await pickTool(page, 'cliff');
  await dragCells(page, [16, 0], [16, 12]);
  await dragCells(page, [16, 20], [16, 31]);
  expect(await page.evaluate(() => [window.__store!.doc!.map.getHeight(16, 6), window.__store!.doc!.map.getHeight(16, 16)])).toEqual([expect.any(Number), 0]);
  expect(await page.evaluate(() => window.__store!.doc!.map.getHeight(16, 6))).toBeGreaterThan(0);

  // ---- the camera and the mouse controls: one object ----
  const ctl = await addObject(page, 'marker', [8, 16], 'Controls');
  await addBehaviors(page, ctl, ['cameraRig', 'rtsControl']);

  // ---- two kinds of soldier, made once ----
  const soldier = async (name: string, team: string, color: string, hp: number, fields: Record<string, number>): Promise<void> => {
    const id = await addObject(page, 'crate', [10, 10], name, ['unit', team]);
    await look(page, { color, w: 0.6, d: 0.6, height: 1.1 });
    await addBehaviors(page, id, ['commandable', 'health']);
    await setFields(page, 'commandable', { team, ...fields });
    await setFields(page, 'health', { max: hp, invulnerableSeconds: 0 });
    await makePrefab(page, name);
    await page.getByTestId('insp-delete').click();
  };
  await soldier('Footman', 'blue', '#4f8cff', 14, { speed: 3.5, attackDamage: 3, aggro: 4 });
  await soldier('Grunt', 'red', '#d8573e', 10, { speed: 3, attackDamage: 2, aggro: 5 });
  await pickTool(page, 'place');
  for (const at of [[6, 15], [6, 17], [8, 15], [8, 17]] as [number, number][]) await addObject(page, 'prefab:Footman', at);
  for (const at of [[24, 14], [24, 18], [26, 15], [26, 17], [22, 16], [27, 13]] as [number, number][]) await addObject(page, 'prefab:Grunt', at);
  // the enemy nest: a building that does not move, with a lot of health
  const nest = await addObject(page, 'crate', [28, 16], 'Nest', ['unit', 'red', 'building']);
  await look(page, { color: '#5e1f1f', w: 1.6, d: 1.6, height: 1.8 });
  await addBehaviors(page, nest, ['commandable', 'health']);
  await setFields(page, 'commandable', { team: 'red', speed: 0.5, attackDamage: 0, aggro: 0 });
  await setFields(page, 'health', { max: 40, invulnerableSeconds: 0 });
  expect(await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.tags.includes('blue')).length)).toBe(4);
  expect(await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.tags.includes('red')).length)).toBe(7);

  // ---- the economy: a mine that makes gold, a barracks that trains footmen ----
  const mine = await addObject(page, 'crate', [3, 12], 'Mine', ['mine']);
  await look(page, { color: '#d8b04a', w: 1, d: 1, height: 0.8 });
  await addBehaviors(page, mine, ['producer']);
  await setFields(page, 'producer', { makes: 'gold:5', uses: '', seconds: 3 });
  const barracks = await addObject(page, 'crate', [3, 17], 'Barracks', ['barracks']);
  await look(page, { color: '#3b5fa8', w: 1.6, d: 1.6, height: 1.4 });
  await selectObject(page, barracks);

  // ---- variables and rules ----
  await tab(page, 'Events').click();
  await page.locator('.events-panel details summary').first().click();
  await page.getByTestId('add-variable').click();
  await setText(page, 'var-name-0', 'gold');
  await setText(page, 'var-value-0', '50');
  for (const [i, n] of [[1, 'train'], [2, 'won'], [3, 'lost']] as const) {
    await page.getByTestId('add-variable').click();
    await setText(page, `var-name-${i}`, n);
  }
  const newRow = async (): Promise<string> => {
    await page.getByTestId('add-row').click();
    return page.evaluate(() => window.__store!.doc!.events.at(-1)!.id);
  };
  // train a footman: pay, and one appears next to the barracks
  let r = await newRow();
  await page.getByTestId(`cond-type-${r}-0`).selectOption('variable');
  await setText(page, `param-${r}-c0-name`, 'train');
  await page.getByTestId(`param-${r}-c0-op`).selectOption('>=');
  await setText(page, `param-${r}-c0-value`, '1');
  await page.getByTestId(`add-condition-${r}`).selectOption('canAfford');
  await setText(page, `param-${r}-c1-costs`, 'gold:25');
  await page.getByTestId(`add-action-${r}`).selectOption('spend');
  await setText(page, `param-${r}-a0-costs`, 'gold:25');
  await page.getByTestId(`add-action-${r}`).selectOption('spawn');
  await page.getByTestId(`param-${r}-a1-prefab`).selectOption('Footman');
  await page.getByTestId(`param-${r}-a1-at`).selectOption({ label: 'Barracks' });
  await setText(page, `param-${r}-a1-dx`, '2');
  r = await newRow();
  await page.getByTestId(`cond-type-${r}-0`).selectOption('variable');
  await setText(page, `param-${r}-c0-name`, 'train');
  await page.getByTestId(`param-${r}-c0-op`).selectOption('>=');
  await setText(page, `param-${r}-c0-value`, '1');
  await page.getByTestId(`add-action-${r}`).selectOption('setVariable');
  await setText(page, `param-${r}-a0-name`, 'train');
  await setText(page, `param-${r}-a0-value`, '0');
  // every red unit gone: won; every blue unit gone: lost
  for (const [tag, flag, text] of [['red', 'won', 'The enemy camp is destroyed. Victory!'], ['blue', 'lost', 'Your army has fallen.']] as const) {
    r = await newRow();
    await page.getByTestId(`cond-type-${r}-0`).selectOption('count');
    await setText(page, `param-${r}-c0-tag`, tag);
    await page.getByTestId(`param-${r}-c0-op`).selectOption('=');
    await setText(page, `param-${r}-c0-value`, '0');
    await page.getByTestId(`add-action-${r}`).selectOption('setVariable');
    await setText(page, `param-${r}-a0-name`, flag);
    await setText(page, `param-${r}-a0-value`, '1');
    await page.getByTestId(`add-action-${r}`).selectOption('message');
    await setText(page, `param-${r}-a1-text`, text);
  }

  // ---- the screen: gold, how many are selected, and the train button ----
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-new-screen-name').fill('HUD');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-start').check();
  await addWidget(page, 'panel');
  await setText(page, 'ui-name', 'Bar');
  await page.getByTestId('ui-layout').selectOption('row');
  await addWidget(page, 'text');
  await setText(page, 'ui-name', 'Numbers');
  await setText(page, 'ui-text', 'Gold {gold}   Selected {rts.selected}');
  await outline(page, 'Bar').click();
  await addWidget(page, 'button');
  await setText(page, 'ui-name', 'Train');
  await setText(page, 'ui-text', 'Train footman (25)');
  await setText(page, 'ui-enabled', '{gold} >= 25');
  await page.getByTestId('ui-on-click-add').selectOption('setVariable');
  await setText(page, 'ui-on-click-p0-name', 'train');
  await setText(page, 'ui-on-click-p0-value', '1');
  for (const [name, text, when] of [['Victory', 'VICTORY', '{won} >= 1'], ['Defeat', 'DEFEAT', '{lost} >= 1']] as const) {
    await outline(page, 'Bar').click();
    await addWidget(page, 'text');
    await setText(page, 'ui-name', name);
    await setText(page, 'ui-text', text);
    await setText(page, 'ui-visible', when);
  }
  await page.getByTestId('btn-ws-world').click();
  await tab(page, 'Problems').click();
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- play by hand: a box over the footmen selects them ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.waitForTimeout(500);
  const a = await page.evaluate(() => window.__viewport!.cellToClient(3, 16));
  const b = await page.evaluate(() => window.__viewport!.cellToClient(11, 16));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars['rts.selected'])).toBe(4);
  await page.screenshot({ path: shot('p2-rts-play.png') });
  expect(await page.evaluate(() => window.__store!.state.runtimeError)).toBeNull();
  await page.getByTestId('btn-stop').click();

  const dir = await saveSample(page, 'rts-skirmish');
  expect(errors).toEqual([]);
  await app.close();

  // ---- the bot: a box, orders, a barracks, an attack-move into the camp ----
  const { game, bot } = await loadSampleGame(dir);
  const vars = game.sim.runtime.vars;
  bot.wait(0.3);
  const footmen = (): number => game.sim.world.withTag('blue').length;
  // a box is a rectangle on the screen, so its corners are (3,16) and (11,16): the same height on the screen, wide apart
  bot.dragBox({ x: 3, y: 16 }, { x: 11, y: 16 });
  expect(vars['rts.selected']).toBe(4);
  bot.rightClick({ x: 12, y: 16 });
  bot.wait(5);
  const first = game.sim.world.withTag('blue')[0]!.get<{ x: number }>('transform')!.x;
  expect(first).toBeGreaterThan(10); // they walked through the pass toward the click
  // back home to train: gold from the mine, a footman for every 25
  bot.rightClick({ x: 8, y: 16 });
  for (let i = 0; i < 60 * 240 && footmen() < 10; i++) {
    bot.wait(1);
    if (Number(vars.gold ?? 0) >= 25) bot.pressWidget('Train footman (25)');
  }
  expect(footmen()).toBeGreaterThanOrEqual(10);
  bot.dragBox({ x: 1, y: 17 }, { x: 13, y: 17 });
  expect(Number(vars['rts.selected'])).toBe(footmen());
  bot.click({ x: 26, y: 16 }, { button: 'secondary', keys: { rts_attack_move: 1 } });
  for (let i = 0; i < 60 * 300 && Number(vars.won ?? 0) === 0 && Number(vars.lost ?? 0) === 0; i++) bot.wait(1);
  expect(vars.lost ?? 0, `the army was lost; ${game.sim.world.withTag('red').length} enemies left`).toBe(0);
  expect(vars.won).toBe(1);
  expect(game.sim.world.withTag('red').length).toBe(0);
  expect(bot.screenText().join(' ')).toContain('VICTORY');
});
