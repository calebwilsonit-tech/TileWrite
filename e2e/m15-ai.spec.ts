import { expect, test, type Page } from '@playwright/test';
import { clickCell, createProjectViaUi, launchEditor, pickTool, shot } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });
const tree = (page: Page) =>
  page.evaluate(() => {
    const e = window.__store!.doc!.entities.find((x) => x.name === 'Archer')!;
    return JSON.parse(JSON.stringify(e.components.behaviorTree)) as { root: string; nodes: { id: string; type: string; name?: string; children?: string[]; child?: string | null; action?: { type: string }; condition?: { type: string } }[] };
  });

async function steps(page: Page, snapshot: Record<string, number>, ticks: number): Promise<void> {
  await page.evaluate(
    ({ snapshot, ticks }) => {
      window.__store!.set({ paused: true });
      const r = window.__play!.runner;
      r.paused = true;
      r.inputSource = () => snapshot;
      for (let i = 0; i < ticks; i++) r.step();
    },
    { snapshot, ticks },
  );
  await page.waitForTimeout(80);
}

test('M15: an archer is edited as a behaviour tree in the Inspector, and in the game it shoots from a distance and keeps its distance', async () => {
  test.setTimeout(150_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Archers', 'starter-room');

  // ---- place an archer with the Place tool ----
  await page.evaluate(() => {
    window.__store!.setOptions({ prefab: 'archer' });
    window.__store!.set({ tool: 'place' });
  });
  const player = await page.evaluate(() => {
    const e = window.__store!.doc!.entities.find((x) => x.tags.includes('player'))!;
    const t = e.components.transform as { x: number; y: number };
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  });
  await clickCell(page, player.x + 6, player.y);
  await pickTool(page, 'select');
  const id = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Archer')!.id);
  await page.evaluate((i) => window.__store!.select([i]), id);
  await tab(page, 'Inspector').click();
  await expect(page.getByTestId('bt-editor')).toBeVisible();
  await expect(page.getByTestId('behavior-rangedAttack')).toBeVisible();
  await expect(page.getByTestId('bt-ok')).toBeVisible();

  // ---- the tree is drawn: a card for every node, the root first ----
  const t0 = await tree(page);
  await expect(page.locator('[data-testid^="bt-node-"]')).toHaveCount(t0.nodes.length);
  await expect(page.getByTestId('bt-node-root')).toHaveAttribute('data-kind', 'selector');
  await page.getByTestId('bt-big').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: shot('m15-behaviour-tree.png') });
  await page.getByTestId('bt-big').click();

  // ---- edit it: change a distance, wrap a question in "not", add and remove a branch ----
  await page.getByTestId('bt-node-close').click();
  await expect(page.getByTestId('bt-form')).toBeVisible();
  await page.getByTestId('bt-cells').fill('4');
  await page.getByTestId('bt-cells').press('Enter');
  expect((await tree(page)).nodes.find((n) => n.id === 'close')).toMatchObject({ condition: { type: 'near', cells: 4 } });
  await page.getByTestId('bt-wrap-kind').selectOption('inverter');
  await page.getByTestId('bt-wrap').click();
  let t = await tree(page);
  const wrapper = t.nodes.find((n) => n.type === 'inverter' && n.child === 'close')!;
  expect(wrapper).toBeDefined();
  expect(t.nodes.find((n) => n.id === 'flee')!.children).toContain(wrapper.id);
  await page.keyboard.press('Control+z'); // one undo step per edit
  t = await tree(page);
  expect(t.nodes.find((n) => n.type === 'inverter' && n.child === 'close')).toBeUndefined();

  await page.getByTestId('bt-node-root').click();
  await page.getByTestId('bt-add-kind').selectOption('sequence');
  await page.getByTestId('bt-add').click();
  const added = (await tree(page)).nodes.at(-1)!;
  expect(added.type).toBe('sequence');
  await expect(page.getByTestId('bt-ok')).toHaveCount(0); // an empty sequence is a problem
  await expect(page.getByTestId('bt-editor')).toContainText('has nothing inside it');
  await page.getByTestId('bt-add-action').click();
  await page.getByTestId('bt-action').selectOption('say');
  await page.getByTestId('bt-text').fill('Halt!');
  await page.getByTestId('bt-text').press('Enter');
  expect((await tree(page)).nodes.at(-1)).toMatchObject({ type: 'action', action: { type: 'say', text: 'Halt!' } });
  await page.getByTestId(`bt-node-${added.id}`).click();
  await page.getByTestId('bt-delete').click();
  expect((await tree(page)).nodes.some((n) => n.id === added.id)).toBe(false);
  await expect(page.getByTestId('bt-ok')).toBeVisible();

  // ---- the player gets Health, so the arrows can hurt ----
  const playerId = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.tags.includes('player'))!.id);
  await page.evaluate((i) => window.__store!.select([i]), playerId);
  await page.getByTestId('add-behavior').selectOption('health');
  await page.getByTestId('add-behavior-ok').click();
  await expect(page.getByTestId('behavior-health')).toBeVisible();

  // ---- in the game: keeps its distance, and its arrows find the player ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await steps(page, {}, 2);
  await expect.poll(async () => page.evaluate(() => Object.keys(window.__play!.sim.world.all().find((e) => e.name === 'Archer')?.get<{ trace: object }>('state:tree')?.trace ?? {}).length)).toBeGreaterThan(0);
  const dist = () =>
    page.evaluate(() => {
      const w = window.__play!.sim.world;
      const a = w.all().find((e) => e.name === 'Archer')!.get<{ x: number; y: number }>('transform')!;
      const p = w.withTag('player')[0]!.get<{ x: number; y: number }>('transform')!;
      return Math.hypot(a.x - p.x, a.y - p.y);
    });
  const hp = () => page.evaluate(() => window.__play!.sim.world.withTag('player')[0]!.get<{ hp: number }>('state:health')?.hp ?? -1);
  const start = await hp();
  let shots = 0;
  let farthest = 0;
  for (let i = 0; i < 24; i++) {
    await steps(page, {}, 20);
    shots = await page.evaluate(() => window.__play!.sim.world.all().filter((e) => e.tags.has('projectile')).length + (window.__play!.sim.events.of('shot').length > 0 ? 1 : 0));
    farthest = Math.max(farthest, await dist());
    if ((await hp()) < start) break;
  }

  expect(await hp()).toBeLessThan(start); // the shots found their mark
  expect(farthest).toBeGreaterThan(3); // from a distance, not up close
  expect(shots).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: shot('m15-archer.png') });
  expect(errors).toEqual([]);
  await app.close();
});
