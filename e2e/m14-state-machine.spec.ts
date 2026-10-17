import { expect, test, type Locator, type Page } from '@playwright/test';
import { facingOfGridDir } from '@tilewright/runtime';
import { clickCell, createProjectViaUi, launchEditor, pickTool, shot } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });
const centre = async (l: Locator): Promise<{ x: number; y: number }> => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const machine = (page: Page) =>
  page.evaluate(() => {
    const e = window.__store!.doc!.entities.find((x) => x.name === 'Guard')!;
    return JSON.parse(JSON.stringify(e.components.stateMachine)) as { start: string; states: { id: string; name: string; behaviours: string[] }[]; transitions: { id: string; from: string; to: string; when: { type: string } }[] };
  });

test('M14: a guard\'s moods are drawn as a state machine in the Inspector, edited with the mouse, and run in the game', async () => {
  test.setTimeout(150_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Moods', 'starter-room');

  // ---- a guard, and the State Machine behaviour on it ----
  await page.evaluate(() => {
    window.__store!.setOptions({ prefab: 'guard' });
    window.__store!.set({ tool: 'place' });
  });
  await clickCell(page, 12, 8);
  await pickTool(page, 'select');
  const guardId = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Guard')!.id);
  await page.evaluate((id) => window.__store!.select([id]), guardId);
  await tab(page, 'Inspector').click();
  await page.getByTestId('add-behavior').selectOption('stateMachine');
  await page.getByTestId('add-behavior-ok').click();
  await expect(page.getByTestId('sm-editor')).toBeVisible();
  await expect(page.getByTestId('sm-problems')).toContainText('no states yet');

  // ---- start from the Guard example ----
  await page.getByTestId('sm-example').selectOption('guard');
  await expect(page.locator('[data-testid^="sm-state-"]')).toHaveCount(4);
  expect((await machine(page)).states.map((s) => s.id)).toEqual(['patrol', 'chase', 'search', 'back']);
  await expect(page.getByTestId('sm-arrow-patrol-chase')).toBeVisible();
  await expect(page.getByTestId('sm-problems')).toHaveCount(0);

  // ---- edit a state: rename it, take a behaviour away ----
  await page.getByTestId('sm-state-chase').click({ position: { x: 40, y: 30 } });
  await expect(page.getByTestId('sm-state-form')).toBeVisible();
  await page.getByTestId('sm-name').fill('Hunt');
  await page.getByTestId('sm-name').press('Enter');
  expect((await machine(page)).states.find((s) => s.id === 'chase')!.name).toBe('Hunt');
  await page.getByTestId('sm-beh-vision').click(); // (the box follows the data on the next frame, so click, then look)
  await expect(page.getByTestId('sm-beh-vision')).not.toBeChecked();
  expect((await machine(page)).states.find((s) => s.id === 'chase')!.behaviours).toEqual([]);
  await page.getByTestId('sm-beh-vision').click();
  await expect(page.getByTestId('sm-beh-vision')).toBeChecked();

  // ---- add a state and an arrow to it by dragging ----
  await page.getByTestId('sm-add-state').click();
  const added = (await machine(page)).states.at(-1)!;
  await expect(page.getByTestId('sm-problems')).toContainText('can never be reached'); // nothing leads to it yet
  const from = await centre(page.getByTestId('sm-port-search'));
  const to = await centre(page.getByTestId(`sm-state-${added.id}`));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
  await expect(page.getByTestId('sm-arrow-form')).toBeVisible();
  let m = await machine(page);
  expect(m.transitions.at(-1)).toMatchObject({ from: 'search', to: added.id, when: { type: 'sees' } });
  await page.getByTestId('sm-when').selectOption('time');
  await page.getByTestId('sm-seconds').fill('9');
  await page.getByTestId('sm-seconds').press('Enter');
  m = await machine(page);
  expect(m.transitions.at(-1)!.when).toMatchObject({ type: 'time', seconds: 9 });
  await expect(page.getByTestId('sm-problems')).toContainText('no way out'); // the new state leads nowhere
  await page.screenshot({ path: shot('m14-state-machine.png') });
  await page.getByTestId('sm-big').click(); // the whole window, where the cards can be read
  await page.waitForTimeout(250);
  await page.screenshot({ path: shot('m14-state-machine-big.png') });
  await page.getByTestId('sm-big').click();
  await page.getByTestId('sm-delete-arrow').click();
  await page.getByTestId(`sm-state-${added.id}`).click({ position: { x: 30, y: 20 } });
  await page.getByTestId('sm-delete-state').click();
  expect((await machine(page)).states).toHaveLength(4);
  await expect(page.getByTestId('sm-problems')).toHaveCount(0);
  expect(await page.evaluate(() => window.__store!.doc!.history.labels.some((l) => l === 'Edit the state machine'))).toBe(true); // undoable

  // ---- the Problems panel reads machines too ----
  await page.evaluate((id) => {
    window.__store!.doc!.updateEntities([id], 'Break it', (e) => {
      (e.components.stateMachine as { start: string }).start = 'nowhere';
    });
  }, guardId);
  await tab(page, 'Problems').click();
  await expect(page.getByTestId('problems-panel')).toContainText('The state machine of "Guard": It starts in "nowhere"');
  await page.evaluate((id) => {
    window.__store!.doc!.updateEntities([id], 'Fix it', (e) => {
      (e.components.stateMachine as { start: string }).start = 'patrol';
    });
  }, guardId);

  // ---- run it: the guard faces the player, sees them, and the machine moves it to Hunt ----
  await page.evaluate(
    ([id, facing]) => {
      window.__store!.doc!.updateEntities([id as string], 'Face the player', (e) => {
        (e.components.transform as { facing: number }).facing = facing as number;
        (e.components.patrol as { points: string }).points = '12.5,8.5';
      });
    },
    [guardId, facingOfGridDir(-1, 0)],
  );
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  const mode = () => page.evaluate(() => (window.__play!.sim.world.all().find((e) => e.name === 'Guard')!.get<{ current: string }>('state:machine') ?? { current: '' }).current);
  await expect.poll(mode, { timeout: 10_000 }).toBe('chase');
  expect(errors).toEqual([]);
  await app.close();
});
