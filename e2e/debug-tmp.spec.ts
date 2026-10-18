import { test } from '@playwright/test';
import { clickCell, createProjectViaUi, launchEditor } from './helpers';

test('debug tactics clicks', async () => {
  test.setTimeout(120_000);
  const { page, app } = await launchEditor();
  await createProjectViaUi(page, 'Dbg', 'tactics');
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.waitForTimeout(800);
  const vars = () => page.evaluate(() => JSON.stringify({ sel: window.__play!.sim.runtime.vars['sel.name'], cx: window.__play!.sim.runtime.vars['cursor.x'], cy: window.__play!.sim.runtime.vars['cursor.y'], unit: window.__play!.sim.runtime.vars['turn.unit'], mode: window.__play!.sim.runtime.clock.mode, cells: window.__play!.sim.runtime.view.cells.length, ptr: [window.__play!.sim.input.value('pointer_cx'), window.__play!.sim.input.value('pointer_cy')] }));
  console.log('start', await vars());
  const t = await page.evaluate(() => window.__play!.sim.world.all().find((e) => e.name === 'Knight')!.get('transform'));
  console.log('knight', JSON.stringify(t));
  const k = t as { x: number; y: number };
  await clickCell(page, Math.floor(k.x), Math.floor(k.y));
  await page.waitForTimeout(300);
  console.log('after click knight', await vars());
  await clickCell(page, Math.floor(k.x) + 2, Math.floor(k.y) - 1);
  await page.waitForTimeout(1500);
  console.log('after click cell', await vars());
  console.log('knight', JSON.stringify(await page.evaluate(() => window.__play!.sim.world.all().find((e) => e.name === 'Knight')!.get('transform'))));
  await app.close();
});
