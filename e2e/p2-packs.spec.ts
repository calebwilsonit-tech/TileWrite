import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createProjectViaUi, launchEditor } from './helpers';

test('Phase 2: a new empty project has no player, no rules and no packs; it still plays; packs are switched on in Project settings', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Nothing Game', 'empty');
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);

  // nothing in it: no objects, no packs, and no complaint about a missing player
  expect(await page.evaluate(() => window.__store!.doc!.entities.length)).toBe(0);
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).plugins).toEqual([]);
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // it plays: a camera over an empty field, nothing else
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__play!.sim.world.all().length)).toBe(0);
  await page.getByTestId('btn-stop').click();

  // the Packs tab lists the engine's parts, all off; switch one on
  await page.getByTestId('btn-project-settings').click();
  await page.getByTestId('ps-tab-plugins').click();
  for (const id of ['combat', 'inventory', 'story', 'ai', 'lighting', 'storytender', 'turns', 'controls', 'sim']) await expect(page.getByTestId(`plugin-toggle-${id}`)).not.toBeChecked();
  await page.getByTestId('plugin-toggle-storytender').click();
  await expect(page.getByTestId('plugin-toggle-storytender')).toBeChecked();
  await expect(page.getByTestId('plugin-toggle-lighting')).toBeChecked(); // it needs lighting
  await expect(page.getByTestId('plugin-storytender')).toContainText('echoRecorder');
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).plugins.sort()).toEqual(['lighting', 'storytender']);
  // and off again: its dependents leave with it
  await page.getByTestId('plugin-toggle-lighting').click();
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).plugins).toEqual([]);

  // the controls tab only lists the buttons the packs added (none are on): no "Record an echo" or "Attack"
  await page.getByTestId('ps-tab-controls').click();
  await expect(page.getByTestId('ctl-move_left')).toBeVisible();
  await expect(page.getByTestId('ctl-echo')).toHaveCount(0);
  await expect(page.getByTestId('ctl-attack')).toHaveCount(0);
  await page.getByTestId('ps-tab-plugins').click();
  await page.getByTestId('plugin-toggle-storytender').click();
  await page.getByTestId('ps-tab-controls').click();
  await expect(page.getByTestId('ctl-echo')).toBeVisible();
  expect(errors).toEqual([]);
  await app.close();
});
