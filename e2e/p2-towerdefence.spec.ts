import { expect, test, type Page } from '@playwright/test';
import { clickCell, createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';
import { addBehaviors, addObject, addTableRow, loadSampleGame, look, makePrefab, makeTable, saveSample, selectObject, setFields, setText, tab } from './sample-helpers';

const outline = (page: Page, name: string) => page.getByTestId(`ui-outline-${name}`);
const addWidget = (page: Page, type: string) => page.getByTestId(`ui-palette-${type}`).click();

/** The road the enemies walk, as the corners of the route (cells). */
const ROUTE: [number, number][] = [[3, 4], [25, 4], [25, 12], [5, 12], [5, 20], [26, 20]];

/**
 * Sample 4 of Phase 2: a tower defence. A road with waypoints, waves from a data table, enemies that follow the road and take a life
 * when they reach the end, towers placed from a build menu that cost gold, an upgrade that makes every archer tower stronger, lives and
 * money on screen. All of it from the editor; the bot then defends the road with the mouse and the on-screen buttons.
 */
test('Phase 2 sample: tower defence - waves from a table, placeable and upgradable towers, lives and gold', async () => {
  test.setTimeout(600_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Tower Defence', 'builder');

  // ---- towers shoot and enemies have health: switch on the Combat pack ----
  await page.getByTestId('btn-project-settings').click();
  await page.getByTestId('ps-tab-packs').click();
  await page.getByTestId('pack-toggle-combat').click();
  await expect(page.getByTestId('pack-toggle-combat')).toBeChecked();
  await page.mouse.click(5, 400); // click outside to close
  await expect(page.getByTestId('project-settings')).toHaveCount(0);

  // ---- the road: stone tiles along the route ----
  await tab(page, 'Tiles').click();
  await page.getByTestId('tile-stone').click();
  await pickTool(page, 'rect');
  for (let i = 0; i + 1 < ROUTE.length; i++) await dragCells(page, ROUTE[i]!, ROUTE[i + 1]!);
  expect(await page.evaluate(() => window.__store!.doc!.map.getTile(15, 4))).not.toBe(await page.evaluate(() => window.__store!.doc!.map.getTile(15, 8)));

  // ---- waypoints along the road, and the gate where the waves appear ----
  for (let i = 0; i < ROUTE.length; i++) await addObject(page, 'marker', ROUTE[i]!, `Waypoint ${i + 1}`, ['route']);
  const spawn = await addObject(page, 'marker', ROUTE[0]!, 'Spawn', ['spawn']);
  await addBehaviors(page, spawn, ['waveSpawner']);
  await setFields(page, 'waveSpawner', { table: 'Waves', autoStart: false, rest: 4 });

  // ---- enemies: made once, then they come from the table ----
  const enemy = async (name: string, color: string, size: number, hp: number, speed: number): Promise<void> => {
    const id = await addObject(page, 'crate', [10, 8], name, ['enemy']);
    await look(page, { color, w: size, d: size, height: size });
    await addBehaviors(page, id, ['health', 'pathFollower']);
    await setFields(page, 'health', { max: hp, invulnerableSeconds: 0, showBar: true });
    await setFields(page, 'pathFollower', { speed, removeAtEnd: true });
    await makePrefab(page, name);
    await page.getByTestId('insp-delete').click();
  };
  await enemy('Runner', '#d8573e', 0.5, 6, 2.5);
  await enemy('Brute', '#7a3b8f', 0.8, 24, 1.4);

  // ---- towers: an archer tower and a cannon ----
  const tower = async (name: string, color: string, tag: string, fields: Record<string, string | number | boolean>): Promise<void> => {
    const id = await addObject(page, 'crate', [10, 8], name, ['tower', tag]);
    await look(page, { color, w: 0.8, d: 0.8, height: 1.6 });
    await addBehaviors(page, id, ['rangedAttack']);
    await setFields(page, 'rangedAttack', { target: 'enemy', hurts: 'enemy', needSight: false, windup: 0.1, ...fields });
    await makePrefab(page, name);
    await page.getByTestId('insp-delete').click();
  };
  await tower('ArcherTower', '#4f8cff', 'archer', { range: 6, cooldown: 0.8, damage: 2 });
  await tower('Cannon', '#444a55', 'cannon', { range: 5, cooldown: 2.2, damage: 9 });
  expect(await page.evaluate(() => [...window.__store!.prefabs.keys()].sort())).toEqual(expect.arrayContaining(['ArcherTower', 'Brute', 'Cannon', 'Runner']));

  // ---- the data: waves, and the build menu (the starter's rows become the two towers) ----
  await tab(page, 'Data').click();
  await makeTable(page, 'Waves', [['prefab', 'prefab'], ['count', 'number'], ['gap', 'number'], ['delay', 'number']]);
  await addTableRow(page, 'Waves', { id: 'w1', prefab: 'Runner', count: '6', gap: '1.2', delay: '0' });
  await addTableRow(page, 'Waves', { id: 'w2', prefab: 'Runner', count: '10', gap: '0.8', delay: '0' });
  await addTableRow(page, 'Waves', { id: 'w3', prefab: 'Brute', count: '4', gap: '2', delay: '0' });
  await addTableRow(page, 'Waves', { id: 'w4', prefab: 'Runner', count: '12', gap: '0.6', delay: '0' });
  await addTableRow(page, 'Waves', { id: 'w5', prefab: 'Brute', count: '8', gap: '1.5', delay: '0' });
  await page.getByTestId('table-pick-Buildings').click();
  await setText(page, 'cell-house-id', 'archer');
  await setText(page, 'cell-archer-name', 'Archer tower');
  await setText(page, 'cell-archer-prefab', 'ArcherTower');
  await setText(page, 'cell-archer-w', '1');
  await setText(page, 'cell-archer-d', '1');
  await setText(page, 'cell-archer-cost', '30');
  await setText(page, 'cell-wall-id', 'cannon');
  await setText(page, 'cell-cannon-name', 'Cannon');
  await setText(page, 'cell-cannon-prefab', 'Cannon');
  await setText(page, 'cell-cannon-w', '1');
  await setText(page, 'cell-cannon-d', '1');
  await setText(page, 'cell-cannon-cost', '70');
  expect(await page.evaluate(() => window.__store!.tables.find((t) => t.name === 'Buildings')!.rows.map((r) => `${r.id}:${r.prefab}:${r.cost}`))).toEqual(['archer:ArcherTower:30', 'cannon:Cannon:70']);

  // ---- lives, money, rules ----
  await page.getByTestId('btn-ws-world').click();
  await tab(page, 'Events').click();
  await setText(page, 'var-name-0', 'gold'); // the starter already has gold; add the rest
  for (const [i, name, value] of [[1, 'lives', '10'], [2, 'up', '0'], [3, 'tlevel', '0'], [4, 'won', '0'], [5, 'lost', '0']] as const) {
    await page.getByTestId('add-variable').click();
    await setText(page, `var-name-${i}`, name);
    await setText(page, `var-value-${i}`, value);
  }
  expect(await page.evaluate(() => window.__store!.doc!.variables)).toEqual([{ name: 'gold', value: 100 }, { name: 'lives', value: 10 }, { name: 'up', value: 0 }, { name: 'tlevel', value: 0 }, { name: 'won', value: 0 }, { name: 'lost', value: 0 }]);
  const newRow = async (): Promise<string> => {
    await page.getByTestId('add-row').click();
    return page.evaluate(() => window.__store!.doc!.events.at(-1)!.id);
  };
  // an enemy reaches the end of the road: a life is lost
  let r = await newRow();
  await page.getByTestId(`cond-type-${r}-0`).selectOption('onEvent');
  await page.getByTestId(`param-${r}-c0-name`).selectOption('path-end');
  await page.getByTestId(`add-action-${r}`).selectOption('setVariable');
  await setText(page, `param-${r}-a0-name`, 'lives');
  await page.getByTestId(`param-${r}-a0-op`).selectOption('subtract');
  await setText(page, `param-${r}-a0-value`, '1');
  // an enemy is beaten: gold
  r = await newRow();
  await page.getByTestId(`cond-type-${r}-0`).selectOption('entityEvent');
  await page.getByTestId(`param-${r}-c0-who`).selectOption('tag:enemy');
  await page.getByTestId(`param-${r}-c0-name`).selectOption('died');
  await page.getByTestId(`add-action-${r}`).selectOption('earn');
  await setText(page, `param-${r}-a0-gains`, 'gold:6');
  // the upgrade button asks (up = 1); if the gold is there it is paid and every archer tower gets sharper
  r = await newRow();
  await page.getByTestId(`cond-type-${r}-0`).selectOption('variable');
  await setText(page, `param-${r}-c0-name`, 'up');
  await page.getByTestId(`param-${r}-c0-op`).selectOption('>=');
  await setText(page, `param-${r}-c0-value`, '1');
  await page.getByTestId(`add-condition-${r}`).selectOption('canAfford');
  await setText(page, `param-${r}-c1-costs`, 'gold:60');
  await page.getByTestId(`add-action-${r}`).selectOption('spend');
  await setText(page, `param-${r}-a0-costs`, 'gold:60');
  await page.getByTestId(`add-action-${r}`).selectOption('setVariable');
  await setText(page, `param-${r}-a1-name`, 'tlevel');
  await setText(page, `param-${r}-a1-value`, '1');
  r = await newRow();
  await page.getByTestId(`cond-type-${r}-0`).selectOption('variable');
  await setText(page, `param-${r}-c0-name`, 'up');
  await page.getByTestId(`param-${r}-c0-op`).selectOption('>=');
  await setText(page, `param-${r}-c0-value`, '1');
  await page.getByTestId(`add-action-${r}`).selectOption('setVariable');
  await setText(page, `param-${r}-a0-name`, 'up');
  await setText(page, `param-${r}-a0-value`, '0');
  r = await newRow();
  await page.getByTestId(`foreach-${r}`).selectOption('tag:archer');
  await page.getByTestId(`cond-type-${r}-0`).selectOption('variable');
  await setText(page, `param-${r}-c0-name`, 'tlevel');
  await page.getByTestId(`param-${r}-c0-op`).selectOption('>=');
  await setText(page, `param-${r}-c0-value`, '1');
  for (const [i, key, value] of [[0, 'damage', '5'], [1, 'cooldown', '0.5']] as const) {
    await page.getByTestId(`add-action-${r}`).selectOption('setProperty');
    await page.getByTestId(`param-${r}-a${i}-who`).selectOption('picked');
    await setText(page, `param-${r}-a${i}-component`, 'rangedAttack');
    await setText(page, `param-${r}-a${i}-key`, key);
    await setText(page, `param-${r}-a${i}-value`, value);
  }
  // out of lives: lost and stop; every wave beaten: won
  r = await newRow();
  await page.getByTestId(`cond-type-${r}-0`).selectOption('variable');
  await setText(page, `param-${r}-c0-name`, 'lives');
  await page.getByTestId(`param-${r}-c0-op`).selectOption('<=');
  await setText(page, `param-${r}-c0-value`, '0');
  await page.getByTestId(`add-action-${r}`).selectOption('setVariable');
  await setText(page, `param-${r}-a0-name`, 'lost');
  await setText(page, `param-${r}-a0-value`, '1');
  await page.getByTestId(`add-action-${r}`).selectOption('setClock');
  await page.getByTestId(`param-${r}-a1-mode`).selectOption('paused');
  r = await newRow();
  await page.getByTestId(`cond-type-${r}-0`).selectOption('variable');
  await setText(page, `param-${r}-c0-name`, 'wave.state');
  await page.getByTestId(`param-${r}-c0-op`).selectOption('=');
  await setText(page, `param-${r}-c0-value`, 'done');
  await page.getByTestId(`add-condition-${r}`).selectOption('variable');
  await setText(page, `param-${r}-c1-name`, 'lives');
  await page.getByTestId(`param-${r}-c1-op`).selectOption('>');
  await setText(page, `param-${r}-c1-value`, '0');
  await page.getByTestId(`add-action-${r}`).selectOption('setVariable');
  await setText(page, `param-${r}-a0-name`, 'won');
  await setText(page, `param-${r}-a0-value`, '1');

  // ---- the screen ----
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-new-screen-name').fill('HUD');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-start').check();
  await addWidget(page, 'panel');
  await setText(page, 'ui-name', 'Bar');
  await page.getByTestId('ui-layout').selectOption('column');
  await addWidget(page, 'text');
  await setText(page, 'ui-name', 'Numbers');
  await setText(page, 'ui-text', 'Gold {gold}   Lives {lives}   Wave {wave.index} / {wave.total}');
  const button = async (name: string, text: string, action: string, set: (p: Page) => Promise<unknown>): Promise<void> => {
    await outline(page, 'Bar').click();
    await addWidget(page, 'button');
    await setText(page, 'ui-name', name);
    await setText(page, 'ui-text', text);
    await page.getByTestId('ui-on-click-add').selectOption(action);
    await set(page);
  };
  await button('NextWave', 'Send the next wave', 'nextWave', async () => undefined);
  await button('Upgrade', 'Sharper arrows (60)', 'setVariable', async (p) => {
    await setText(p, 'ui-on-click-p0-name', 'up');
    await setText(p, 'ui-on-click-p0-value', '1');
  });
  await button('Fast', '4x', 'setClock', async (p) => p.getByTestId('ui-on-click-p0-speed').selectOption('4'));
  await button('Normal', '1x', 'setClock', async (p) => p.getByTestId('ui-on-click-p0-speed').selectOption('1'));
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
  for (const [name, text, when] of [['Victory', 'VICTORY - the road is safe!', '{won} >= 1'], ['Defeat', 'DEFEAT - the gate has fallen.', '{lost} >= 1']] as const) {
    await outline(page, 'Bar').click();
    await addWidget(page, 'text');
    await setText(page, 'ui-name', name);
    await setText(page, 'ui-text', text);
    await setText(page, 'ui-visible', when);
  }
  await page.getByTestId('btn-ws-world').click();
  await tab(page, 'Problems').click();
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- play by hand: pick the archer tower, place it by a click, the numbers change ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await expect(page.getByTestId('tw-screen-HUD')).toContainText('Gold 100   Lives 10');
  await page.getByTestId('tw-ui-Pick').first().click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars['build.selected'])).toBe('archer');
  await clickCell(page, 20, 22); // the panel covers the top left of the picture, so build in the middle
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__play!.sim.world.withTag('tower').length)).toBe(1);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars.gold)).toBe(70);
  await page.screenshot({ path: shot('p2-towerdefence-play.png') });
  expect(await page.evaluate(() => window.__store!.state.runtimeError)).toBeNull();
  await page.getByTestId('btn-stop').click();
  await selectObject(page, await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Spawn')!.id));

  const dir = await saveSample(page, 'tower-defence');
  expect(errors).toEqual([]);
  await app.close();

  // ---- the bot defends: towers beside the road, the upgrade, a wave at a time, at 4x ----
  const { game, bot } = await loadSampleGame(dir);
  bot.wait(0.3);
  const vars = game.sim.runtime.vars;
  expect(bot.pressWidget('4x')).toBe(true);
  const spots: [string, number, number][] = [['Archer tower (30)', 8, 6], ['Archer tower (30)', 14, 6], ['Archer tower (30)', 20, 6], ['Cannon (70)', 22, 8], ['Archer tower (30)', 22, 14], ['Archer tower (30)', 14, 14], ['Cannon (70)', 8, 14], ['Archer tower (30)', 8, 18], ['Archer tower (30)', 16, 18], ['Cannon (70)', 22, 18], ['Archer tower (30)', 12, 10], ['Archer tower (30)', 18, 10]];
  let next = 0;
  let upgraded = false;
  const tryBuild = (): void => {
    while (next < spots.length) {
      const [button, x, y] = spots[next]!;
      const cost = Number(/\((\d+)\)/.exec(button)![1]);
      if (Number(vars.gold ?? 0) < cost) return;
      expect(bot.pressWidget(button), button).toBe(true);
      bot.hover({ x, y }, 2);
      expect(vars['build.valid'], `${button} at ${x},${y}: ${String(vars['build.why'])}`).toBe(true);
      bot.click({ x, y });
      next++;
    }
  };
  tryBuild();
  for (let i = 0; i < 60 * 1500 && Number(vars.won ?? 0) === 0 && Number(vars.lost ?? 0) === 0; i++) {
    bot.wait(1);
    if (!upgraded && next >= 3 && Number(vars.gold ?? 0) >= 60) {
      bot.pressWidget('Sharper arrows (60)');
      upgraded = true;
    }
    tryBuild();
    const idle = vars['wave.state'] === 'idle' || (vars['wave.state'] === 'resting' && Number(vars['wave.alive'] ?? 0) === 0);
    if (idle && Number(vars['wave.index'] ?? 0) < Number(vars['wave.total'] ?? 0)) bot.pressWidget('Send the next wave');
  }
  expect(vars.lost ?? 0, `the gate fell with ${String(vars.lives)} lives left; wave ${String(vars['wave.index'])}`).toBe(0);
  expect(vars.won).toBe(1);
  expect(Number(vars.lives)).toBeGreaterThan(0);
  expect(bot.screenText().join(' ')).toContain('VICTORY');
  expect(game.sim.world.withTag('tower').length).toBeGreaterThan(3);
  expect(vars.tlevel).toBe(1);
});
