import { expect, test, type Page } from '@playwright/test';
import { clickCell, createProjectViaUi, launchEditor, pickTool } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });
const byName = (page: Page, name: string): Promise<string> => page.evaluate((n) => window.__store!.doc!.entities.find((e) => e.name === n)!.id, name);

async function clickEntity(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, id);
  await page.mouse.click(p.x, p.y);
}

/** Hold the game still and feed it exactly these buttons for some ticks. */
async function feed(page: Page, snapshot: Record<string, number>, ticks: number): Promise<void> {
  await page.evaluate(
    ({ snapshot, ticks }) => {
      const r = window.__play!.runner;
      window.__store!.set({ paused: true });
      r.paused = true;
      r.inputSource = () => snapshot;
      for (let i = 0; i < ticks; i++) r.step();
    },
    { snapshot, ticks },
  );
}

const gateOpen = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const g = window.__play!.sim.world.all().find((e) => e.name === 'Gate')!;
    return g.get<{ inputs: Record<string, boolean> }>('signals')?.inputs.open === true;
  });

const vars = (page: Page): Promise<Record<string, unknown>> => page.evaluate(() => ({ ...window.__play!.sim.runtime.vars }));

test('Phase 2: the three levels of logic - quick actions, wires through nodes, and a graph - all built in the editor and played', async () => {
  test.setTimeout(240_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Logic Game', 'empty');

  // ---- level one: a button that opens a gate and adds to a counter, with menus only ----
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption('clickable');
  await clickCell(page, 10, 10);
  await page.getByTestId('opt-prefab').selectOption('gate');
  await clickCell(page, 14, 10);
  await pickTool(page, 'select');
  const button = await byName(page, 'Button');
  await clickEntity(page, button);
  await tab(page, 'Inspector').click();
  await expect(page.getByTestId('insp-quick')).toBeVisible();
  await page.getByTestId('qa-target').selectOption({ label: 'Gate' });
  await page.getByTestId('qa-target-action').selectOption({ label: 'Open' });
  await page.getByTestId('qa-add').selectOption({ label: 'Add to a variable' });
  await expect(page.getByTestId('qa-pin-clickable.clicked')).toBeVisible();
  await page.getByTestId('qa-list-clickable.clicked-p1-name').fill('clicks');
  await page.getByTestId('qa-list-clickable.clicked-p1-name').press('Enter');
  const made = await page.evaluate(() => ({ nodes: window.__store!.doc!.entities.filter((e) => e.tags.includes('logic-node')).length, wires: window.__store!.doc!.wires.length }));
  expect(made).toEqual({ nodes: 1, wires: 1 });

  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  const cell = await page.evaluate((id) => {
    const t = window.__store!.doc!.getEntity(id)!.components.transform as { x: number; y: number };
    return { x: Math.floor(t.x) + 1, y: Math.floor(t.y) + 1 };
  }, button);
  await feed(page, {}, 5);
  expect(await gateOpen(page)).toBe(false);
  // clicking elsewhere does nothing; clicking the button does both things
  await feed(page, { pointer_cx: 3, pointer_cy: 3, pointer_primary: 1 }, 3);
  expect((await vars(page)).clicks).toBeUndefined();
  await feed(page, {}, 2);
  await feed(page, { pointer_cx: cell.x, pointer_cy: cell.y, pointer_primary: 1 }, 3);
  await feed(page, { pointer_cx: cell.x, pointer_cy: cell.y }, 4);
  expect(await gateOpen(page)).toBe(true);
  expect((await vars(page)).clicks).toBe(1);
  await page.getByTestId('btn-stop').click();

  // ---- level two: the same logic as wires, with the wire dialog "make something happen" ----
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption('clickable');
  await clickCell(page, 10, 14);
  await page.getByTestId('opt-prefab').selectOption('eventNode');
  await clickCell(page, 12, 14);
  await pickTool(page, 'select');
  const second = await byName(page, 'Button 2');
  const gate = await byName(page, 'Gate');
  await pickTool(page, 'wire');
  const pa = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, second);
  const pb = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, gate);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(pa.x + ((pb.x - pa.x) * i) / 8, pa.y + ((pb.y - pa.y) * i) / 8);
  await page.mouse.up();
  await expect(page.getByTestId('connect-dialog')).toBeVisible();
  await page.getByTestId('connect-mode-action').check();
  await page.getByTestId('connect-action').selectOption({ label: 'Close' });
  await page.getByTestId('connect-ok').click();
  const wires = await page.evaluate(() => window.__store!.doc!.wires.length);
  expect(wires).toBe(2);
  // the wires are drawn, and the lines to what an action changes are dotted
  await tab(page, 'Layers').click();
  await expect(page.getByTestId('view-wires')).toBeChecked();
  await tab(page, 'Inspector').click();

  // ---- level three: open the first button's logic as a graph, add a wait before the second action ----
  await pickTool(page, 'select');
  await clickEntity(page, button);
  await page.getByTestId('qa-open-graph-clickable.clicked').click();
  await expect(page.getByTestId('graph-panel')).toBeVisible();
  await expect(page.getByTestId('graph-select')).toHaveValue(/g\d/);
  const nodeCount = await page.evaluate(() => window.__store!.doc!.graphs[0]!.nodes.length);
  expect(nodeCount).toBe(3);
  expect(await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.tags.includes('logic-node')).length)).toBe(2); // the second button's node and the free event node are left
  // search for a Wait box and add it after the last action
  await page.getByTestId('gnode-n3').click();
  await page.getByTestId('graph-search').fill('wait');
  await page.getByTestId('graph-result-0').click();
  const graph = await page.evaluate(() => window.__store!.doc!.graphs[0]!);
  expect(graph.nodes.map((n) => n.type)).toEqual(['event', 'action', 'action', 'delay']);
  expect(graph.links.length).toBe(3);
  // a breakpoint on the wait box
  const waitId = graph.nodes[3]!.id;
  await page.getByTestId(`gbp-${waitId}`).click();
  expect(await page.evaluate(() => window.__store!.doc!.graphs[0]!.nodes[3]!.breakpoint)).toBe(true);

  // the graph does not fit an event sheet (it has a wait): it says which box
  await page.getByTestId('graph-to-sheet').click();
  await expect(page.getByTestId('graph-message')).toContainText('wait 1 s');
  expect(await page.evaluate(() => window.__store!.doc!.graphs.length)).toBe(1);

  // play: the click runs the graph and stops at the breakpoint
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await feed(page, { pointer_cx: cell.x, pointer_cy: cell.y, pointer_primary: 1 }, 3);
  await feed(page, { pointer_cx: cell.x, pointer_cy: cell.y }, 3);
  await expect(page.getByTestId('logic-break')).toContainText('wait 1 s');
  expect((await vars(page)).clicks).toBe(1);
  await page.getByTestId('btn-stop').click();

  // ---- remove the wait and turn the graph back into event sheet rows ----
  await page.getByTestId(`gnode-${waitId}`).click();
  await page.keyboard.press('Delete');
  await expect.poll(() => page.evaluate(() => window.__store!.doc!.graphs[0]!.nodes.length)).toBe(3);
  await page.getByTestId('graph-to-sheet').click();
  await expect.poll(() => page.evaluate(() => ({ graphs: window.__store!.doc!.graphs.length, rows: window.__store!.doc!.events.length }))).toEqual({ graphs: 0, rows: 2 });
  await page.getByTestId('graph-from-sheet').click();
  await expect.poll(() => page.evaluate(() => ({ graphs: window.__store!.doc!.graphs.length, rows: window.__store!.doc!.events.length }))).toEqual({ graphs: 1, rows: 0 });

  // ---- problems: delete the gate; the broken action is reported and fixed with one click ----
  await page.evaluate((id) => window.__store!.doc!.removeEntities([id]), gate);
  await tab(page, 'Problems').click();
  await expect(page.getByTestId('problems-panel')).toContainText('no longer exists');
  await page.getByTestId('problem-quickfix').first().click();
  await expect.poll(() => page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.tags.includes('logic-node')).length)).toBeLessThanOrEqual(1);

  expect(errors).toEqual([]);
  await app.close();
});
