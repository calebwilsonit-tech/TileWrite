import { expect, test } from '@playwright/test';
import path from 'node:path';
import { clickCell, createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';
import { addBehaviors, addObject, loadSampleGame, saveSample, selectObject, setFields, tab, where } from './sample-helpers';

/**
 * Sample 1 of Phase 2: a tactics battle on a grid with hills. Made from the Tactics starter in the editor with the mouse and
 * the Inspector only, played once by hand in the editor (real clicks), then played to the end by the playbot from the saved folder.
 */
test('Phase 2 sample: tactics - a third enemy on a second hill, a victory flag, played by hand and by the playbot', async () => {
  test.setTimeout(300_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Tactics', 'tactics');

  // ---- the starter has two soldiers each side and a hill; raise a second hill in the north east ----
  expect(await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.tags.includes('unit')).length)).toBe(4);
  await pickTool(page, 'raise');
  await dragCells(page, [10, 8], [12, 10]);
  expect(await page.evaluate(() => window.__store!.doc!.map.getHeight(11, 9))).toBe(1);

  // ---- a third enemy, a spear thrower on the new hill: composed from behaviours, not a ready-made "unit" ----
  const id = await addObject(page, 'crate', [11, 9], 'Slinger', ['unit', 'red']);
  await addBehaviors(page, id, ['turnTaker', 'gridMover', 'health', 'unitAi']);
  await setFields(page, 'turnTaker', { team: 'red', attackRange: 4, attackDamage: 2, apMax: 4 });
  await setFields(page, 'health', { max: 5, invulnerableSeconds: 0 });
  const slinger = await page.evaluate((i) => window.__store!.doc!.getEntity(i)!.components, id);
  expect(slinger).toMatchObject({ turnTaker: { team: 'red', attackRange: 4 }, health: { max: 5 } });

  // ---- the red side is now three, so my two soldiers get more hit points (select each one and change its Health) ----
  for (const [name, hp] of [['Knight', 16], ['Archer', 10]] as const) {
    const sid = await page.evaluate((n) => window.__store!.doc!.entities.find((e) => e.name === n)!.id, name);
    await selectObject(page, sid);
    await setFields(page, 'health', { max: hp });
  }

  // ---- when the blue side wins, remember it (an event row) ----
  await tab(page, 'Events').click();
  await page.getByTestId('add-row').click();
  const rowId = await page.evaluate(() => window.__store!.doc!.events.at(-1)!.id);
  await page.getByTestId(`cond-type-${rowId}-0`).selectOption('battleWon');
  await page.getByTestId(`add-action-${rowId}`).selectOption('setVariable');
  await page.getByTestId(`param-${rowId}-a0-name`).fill('victory');
  await page.getByTestId(`param-${rowId}-a0-name`).press('Enter');
  await page.getByTestId(`param-${rowId}-a0-value`).fill('1');
  await page.getByTestId(`param-${rowId}-a0-value`).press('Enter');
  expect(await page.evaluate(() => window.__store!.doc!.events.map((e) => e.conditions.map((c) => c.type)))).toEqual([['start'], ['battleWon']]);
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- play by hand: click the knight, click a cell to walk to ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.waitForTimeout(800);
  const turn = await page.evaluate(() => window.__play!.sim.runtime.vars['turn.unit']);
  expect(turn).toBe('Knight');
  const start = await page.evaluate(() => {
    const k = window.__play!.sim.world.all().find((e) => e.name === 'Knight')!;
    const t = k.get('transform') as { x: number; y: number };
    return { x: t.x, y: t.y };
  });
  await clickCell(page, Math.floor(start.x), Math.floor(start.y));
  await page.waitForTimeout(250);
  await clickCell(page, Math.floor(start.x) + 2, Math.floor(start.y) - 1);
  await page.waitForTimeout(1500);
  const moved = await page.evaluate(() => {
    const t = window.__play!.sim.world.all().find((e) => e.name === 'Knight')!.get('transform') as { x: number; y: number };
    return { x: t.x, y: t.y };
  });
  expect(Math.hypot(moved.x - start.x, moved.y - start.y)).toBeGreaterThan(1.5);
  await page.screenshot({ path: shot('p2-tactics-play.png') });
  expect(await page.evaluate(() => window.__store!.state.runtimeError)).toBeNull();
  await page.getByTestId('btn-stop').click();

  // ---- keep it, and let the bot play it from the saved folder ----
  const dir = await saveSample(page, 'tactics');
  expect(errors).toEqual([]);
  await app.close();

  const { game, bot } = await loadSampleGame(dir);
  bot.wait(0.3);
  expect(bot.battle()).toMatchObject({ active: true, team: 'blue' });
  const hillTop = where(game, 'Slinger');
  expect(hillTop.h).toBeGreaterThan(0); // standing on the second hill
  const r = bot.playBattle({ team: 'blue', maxSeconds: 600 });
  expect(r.ok, r.message).toBe(true);
  expect(game.sim.runtime.vars.victory).toBe(1);
  expect(path.basename(dir)).toBe('tactics');
});
