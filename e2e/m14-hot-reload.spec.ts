import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor } from './helpers';

test('M14: edits made while the game runs can be put into it, by a button or automatically, and the player keeps their place and flags', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Hot Game', 'starter-room');
  const crateId = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Crate')!.id);

  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  // the game runs: the player is somewhere new and a flag is set
  await page.evaluate(() => {
    const sim = window.__play!.sim;
    sim.runtime.vars.score = 7;
    const t = sim.world.withTag('player')[0]!.get<{ x: number; y: number }>('transform')!;
    t.x = 10.5;
    t.y = 10.5;
  });
  const crateX = () => page.evaluate(() => window.__play!.sim.world.all().find((e) => e.name === 'Crate')!.get<{ x: number }>('transform')!.x);
  const player = () => page.evaluate(() => window.__play!.sim.world.withTag('player')[0]!.get<{ x: number; y: number }>('transform')!);
  expect(await crateX()).toBe(11.5);

  // edit the scene while it runs: move the crate and change a floor tile
  await page.evaluate((id) => {
    const doc = window.__store!.doc!;
    doc.updateEntities([id], 'Move crate', (e) => {
      (e.components.transform as { x: number }).x = 15.5;
    });
    doc.paint('Stone floor', [{ x: 3, y: 3, patch: { tile: 2 } }]);
  }, crateId);
  await page.waitForTimeout(700);
  expect(await crateX()).toBe(11.5); // nothing happens by itself: "As I edit" is off

  await page.getByTestId('btn-hot-reload').click();
  await expect.poll(crateX).toBe(15.5); // the crate is where the edit put it
  expect(await page.evaluate(() => window.__play!.sim.map!.getTile(3, 3))).toBe(2); // and so is the floor
  const p = await player();
  expect(Math.abs(p.x - 10.5)).toBeLessThan(0.6); // the player kept their place (they may have drifted a moment)
  expect(Math.abs(p.y - 10.5)).toBeLessThan(0.6);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars.score)).toBe(7); // and their flags

  // with "As I edit" on, the next edit reaches the game on its own
  await page.getByTestId('chk-hot-reload').check();
  await page.evaluate((id) => {
    window.__store!.doc!.updateEntities([id], 'Move crate again', (e) => {
      (e.components.transform as { x: number }).x = 17.5;
    });
  }, crateId);
  await expect.poll(crateX, { timeout: 5000 }).toBe(17.5);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars.score)).toBe(7);

  // the choice is remembered, and Stop leaves the scene as edited
  await page.getByTestId('btn-stop').click();
  expect(await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Crate')!.components.transform)).toMatchObject({ x: 17.5 });
  expect(errors).toEqual([]);
  await app.close();
});
