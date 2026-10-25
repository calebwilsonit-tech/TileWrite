import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor, pickTool } from './helpers';

const where = (page: Page, x: number, y: number, z: number) =>
  page.evaluate(([a, b, c]) => window.__viewport!.blockToClient(a as number, b as number, c as number, 'top'), [x, y, z] as const);
const cell = (page: Page, x: number, y: number) =>
  page.evaluate(([a, b]) => ({ tile: window.__store!.doc!.map.getTile(a!, b!), block0: window.__store!.doc!.map.blockAt(a!, b!, 0) ?? null }), [x, y]);

/**
 * A floor taken out with the Blocks tool leaves a hole that nothing could be pointed at, so no block could be put back (reported by
 * the owner). The place where the floor was can be pointed at now, and has nothing to take away.
 */
test('Phase 3: a floor taken out with the Blocks tool can be built on again', async () => {
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Hole', 'empty');
  await page.evaluate(() => window.__viewport!.frameMap());
  await pickTool(page, 'blocks');
  const g = await where(page, 10, 10, -1);
  expect((await cell(page, 10, 10)).tile).toBe(1);

  await page.mouse.click(g.x, g.y, { button: 'right' });
  expect((await cell(page, 10, 10)).tile).toBe(0);

  // pointing at the hole shows where a block would go; taking away does nothing there
  await page.mouse.move(g.x, g.y);
  await expect.poll(() => page.evaluate(() => window.__viewport!.previewKinds)).toEqual(['face', 'solid']);
  await page.mouse.click(g.x, g.y, { button: 'right' });
  expect((await cell(page, 10, 10)).tile).toBe(0);

  await page.mouse.click(g.x, g.y);
  expect(await cell(page, 10, 10)).toMatchObject({ tile: 1, block0: { z: 0, tile: 1 } });

  // and Undo takes it out again
  await page.keyboard.press('Control+z');
  expect((await cell(page, 10, 10)).tile).toBe(0);
  expect(errors).toEqual([]);
  await app.close();
});
