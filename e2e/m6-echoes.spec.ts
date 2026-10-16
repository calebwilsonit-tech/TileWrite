import { expect, test, type Page } from '@playwright/test';
import { clickCell, createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';

type Snapshot = Record<string, number>;
const GRID_PLUS_X: Snapshot = { move_right: 1, move_down: 1 };
const GRID_MINUS_X: Snapshot = { move_left: 1, move_up: 1 };
const GRID_PLUS_Y: Snapshot = { move_left: 1, move_down: 1 };

async function play(page: Page, snapshot: Snapshot, ticks: number): Promise<void> {
  await page.evaluate(
    ({ snapshot, ticks }) => {
      const r = window.__play!.runner;
      // pausing through the store keeps the editor from resuming the runner when a toast comes or goes
      window.__store!.set({ paused: true });
      r.paused = true;
      r.inputSource = () => snapshot;
      for (let i = 0; i < ticks; i++) r.step();
    },
    { snapshot, ticks },
  );
}

const byName = (page: Page, name: string): Promise<string> => page.evaluate((n) => window.__store!.doc!.entities.find((e) => e.name === n)!.id, name);

async function clickEntity(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, id);
  await page.mouse.click(p.x, p.y);
}

async function dragEntities(page: Page, a: string, b: string): Promise<void> {
  const pa = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, a);
  const pb = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, b);
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(pa.x + ((pb.x - pa.x) * i) / 8, pa.y + ((pb.y - pa.y) * i) / 8);
  await page.mouse.up();
}

async function wire(page: Page, from: string, to: string, input?: string): Promise<void> {
  await pickTool(page, 'wire');
  await dragEntities(page, from, to);
  await expect(page.getByTestId('connect-dialog')).toBeVisible();
  if (input) await page.getByTestId('connect-input').selectOption(input);
  await page.getByTestId('connect-ok').click();
  await pickTool(page, 'select');
}

async function addBehavior(page: Page, id: string): Promise<void> {
  await page.getByTestId('add-behavior').selectOption(id);
  await page.getByTestId('add-behavior-ok').click();
  await expect(page.getByTestId(`behavior-${id}`)).toBeVisible();
}

const worldState = (page: Page) =>
  page.evaluate(() => {
    const s = window.__play!.sim;
    const find = (n: string) => s.world.all().find((e) => e.name === n)!;
    const active = (n: string) => (find(n).get<{ outputs: Record<string, boolean> }>('signals')?.outputs.active ?? false) === true;
    return {
      echoes: s.world.withTag('echo').length,
      plate1: active('Pressure plate'),
      plate2: active('Pressure plate 2'),
      gateOpen: find('Gate').get<{ enabled: boolean }>('collider')!.enabled === false,
      lights: s.runtime.lighting?.lights.length ?? 0,
    };
  });

test('M6: build a two-echo puzzle room in a dark room with lanterns, entirely in the editor, and solve it', async () => {
  test.setTimeout(180_000);
  const { app, page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Echo Room', 'empty-iso');

  // ---- the player gets echoes (two at once) and a lantern ----
  await pickTool(page, 'select');
  const playerId = await byName(page, 'Player');
  await clickEntity(page, playerId);
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  await addBehavior(page, 'echoRecorder');
  const cap = page.getByTestId('behavior-echoRecorder').getByTestId('bf-capacity');
  await cap.fill('2');
  await cap.press('Enter');
  expect(await page.evaluate((id) => (window.__store!.doc!.getEntity(id)!.components.echoRecorder as { capacity: number }).capacity, playerId)).toBe(2);
  await addBehavior(page, 'light');

  // ---- two plates that only echoes can press, joined by an AND to a gate ----
  await pickTool(page, 'place');
  const place = async (prefab: string, x: number, y: number): Promise<void> => {
    await page.getByTestId('opt-prefab').selectOption(prefab);
    await clickCell(page, x, y);
  };
  await place('plate', 20, 16);
  await place('plate', 16, 20);
  await place('logic', 20, 20);
  await place('gate', 24, 20);
  await place('lantern', 22, 22);
  await pickTool(page, 'select');
  for (const name of ['Pressure plate', 'Pressure plate 2']) {
    await clickEntity(page, await byName(page, name));
    await page.getByTestId('behavior-pressurePlate').getByTestId('bf-activatedBy').selectOption('echoes');
  }
  const [plate1, plate2, logic, gate] = await Promise.all(['Pressure plate', 'Pressure plate 2', 'Logic gate', 'Gate'].map((n) => byName(page, n)));
  await wire(page, plate1!, logic!);
  await wire(page, plate2!, logic!, 'b');
  await wire(page, logic!, gate!);
  const wires = await page.evaluate(() => window.__store!.doc!.wires.map((w) => `${w.from.output}->${w.to.input}`));
  expect(wires).toEqual(['active->a', 'active->b', 'out->open']);

  // ---- a dark room: a region over the whole map, 80% dark ----
  await pickTool(page, 'region');
  await dragCells(page, [0, 0], [31, 31]);
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  const dark = page.getByTestId('insp-darkness');
  await dark.focus();
  for (let i = 0; i < 16; i++) {
    await dark.press('ArrowRight');
    await page.waitForTimeout(40); // the slider is a controlled input: let it settle between presses
  }
  expect(await page.evaluate(() => window.__store!.doc!.regions[0]!.darkness)).toBeCloseTo(0.8, 5);
  await pickTool(page, 'select');
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');
  await page.keyboard.press('Control+s');

  // ---- play: record echo 1 onto plate 1, echo 2 onto plate 2 ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, {}, 5);
  expect(await worldState(page)).toMatchObject({ echoes: 0, plate1: false, plate2: false, gateOpen: false });
  expect((await worldState(page)).lights).toBeGreaterThanOrEqual(2); // the player's lantern and the placed one

  const recordWalk = async (dir: Snapshot, ticks: number): Promise<void> => {
    await play(page, { echo: 1 }, 1); // R: start recording
    await play(page, {}, 1);
    await play(page, dir, ticks);
    await play(page, {}, 1);
    await play(page, { echo: 1 }, 1); // R: stop
    await play(page, {}, 1);
  };
  await recordWalk(GRID_PLUS_X, 60); // four cells east: plate 1
  await page.screenshot({ path: shot('m6-recorded-one.png') });
  await play(page, GRID_MINUS_X, 60); // walk back while echo 1 plays
  await play(page, {}, 30);
  let st = await worldState(page);
  expect(st).toMatchObject({ echoes: 1, plate1: true, plate2: false, gateOpen: false });

  await recordWalk(GRID_PLUS_Y, 60); // four cells south: plate 2
  await play(page, { move_right: 1, move_up: 1 }, 120); // walk off (north); both echoes replay and hold their plates
  await play(page, {}, 60);
  st = await worldState(page);
  expect(st).toMatchObject({ echoes: 2, plate1: true, plate2: true, gateOpen: true });
  await page.screenshot({ path: shot('m6-two-echoes.png') });
  await page.getByTestId('btn-stop').click();

  expect(errors).toEqual([]);
  await app.close();
});
