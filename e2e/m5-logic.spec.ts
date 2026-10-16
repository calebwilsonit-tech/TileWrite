import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { cellXY, clickCell, createProjectViaUi, launchEditor, pickTool, shot } from './helpers';

type Snapshot = Record<string, number>;
const GRID_PLUS_X: Snapshot = { move_right: 1, move_down: 1 };
const GRID_PLUS_Y: Snapshot = { move_left: 1, move_down: 1 };
const GRID_MINUS_Y: Snapshot = { move_right: 1, move_up: 1 };

async function play(page: Page, snapshot: Snapshot, ticks: number): Promise<void> {
  await page.evaluate(
    ({ snapshot, ticks }) => {
      const r = window.__play!.runner;
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

const playState = (page: Page) =>
  page.evaluate(() => {
    const s = window.__play!.sim;
    const find = (n: string) => s.world.all().find((e) => e.name === n)!;
    const gate = find('Gate');
    const plate = find('Pressure plate');
    const crate = find('Crate');
    const p = s.world.withTag('player')[0]!.get<{ x: number; y: number }>('transform')!;
    const c = crate.get<{ x: number; y: number }>('transform')!;
    return {
      gateOpen: gate.get<{ enabled: boolean }>('collider')!.enabled === false,
      plateActive: (plate.get<{ outputs: Record<string, boolean> }>('signals')?.outputs.active ?? false) === true,
      solved: s.runtime.vars.solved,
      player: { x: p.x, y: p.y },
      crate: { x: c.x, y: c.y },
    };
  });

test('M5: build a plate-and-gate puzzle with wires and an event row, entirely in the editor, and solve it', async () => {
  test.setTimeout(150_000);
  const { app, page, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Puzzle Game', 'empty-iso');

  // ---- place the pieces ----
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption('crate');
  await clickCell(page, 20, 16);
  await page.getByTestId('opt-prefab').selectOption('plate');
  await clickCell(page, 21, 16);
  await page.getByTestId('opt-prefab').selectOption('gate');
  await clickCell(page, 24, 16);
  expect(await page.evaluate(() => window.__store!.doc!.entities.map((e) => e.name).sort())).toEqual(['Crate', 'Gate', 'Player', 'Pressure plate']);
  const crateData = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.name === 'Crate')!.components);
  expect(crateData).toHaveProperty('pushable');
  expect(crateData).toHaveProperty('collider');

  // ---- the plate should only react to crates: change its behaviour settings in the inspector ----
  await pickTool(page, 'select');
  const plateId = await byName(page, 'Pressure plate');
  const gateId = await byName(page, 'Gate');
  await clickEntity(page, plateId);
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  await expect(page.getByTestId('behavior-pressurePlate')).toBeVisible();
  await expect(page.getByTestId('behavior-pressurePlate')).toContainText('Sends a signal while something stands on it');
  await page.getByTestId('behavior-pressurePlate').getByTestId('bf-activatedBy').selectOption('crates');
  expect(await page.evaluate((id) => (window.__store!.doc!.getEntity(id)!.components.pressurePlate as { activatedBy: string }).activatedBy, plateId)).toBe('crates');

  // ---- wire the plate to the gate ----
  await pickTool(page, 'wire');
  await dragEntities(page, plateId, gateId);
  await expect(page.getByTestId('connect-dialog')).toBeVisible();
  await page.getByTestId('connect-ok').click();
  const wires = await page.evaluate(() => window.__store!.doc!.wires);
  expect(wires).toHaveLength(1);
  expect(wires[0]).toMatchObject({ from: { entity: plateId, output: 'active' }, to: { entity: gateId, input: 'open' } });
  await pickTool(page, 'select');
  await clickEntity(page, gateId);
  await expect(page.getByTestId('insp-wires')).toContainText('“active”');
  await page.screenshot({ path: shot('m5-wired.png') });

  // wiring two things that cannot talk explains why
  await pickTool(page, 'wire');
  const playerId = await byName(page, 'Player');
  await dragEntities(page, playerId, gateId);
  await expect(page.getByTestId('connect-impossible')).toContainText('has nothing that sends a signal');
  await page.getByTestId('connect-impossible').getByRole('button', { name: 'OK' }).click();
  await pickTool(page, 'select');

  // ---- an event row: when the gate is open, set "solved" to 1 ----
  await page.locator('.dv-tab', { hasText: 'Events' }).click();
  await page.getByTestId('add-row').click();
  const rowId = await page.evaluate(() => window.__store!.doc!.events[0]!.id);
  await page.getByTestId(`cond-type-${rowId}-0`).selectOption('signal');
  await page.getByTestId(`param-${rowId}-c0-who`).selectOption(`id:${gateId}`);
  const sig = page.getByTestId(`param-${rowId}-c0-name`);
  await sig.fill('isOpen');
  await sig.press('Enter');
  await page.getByTestId(`add-action-${rowId}`).selectOption('setVariable');
  const vname = page.getByTestId(`param-${rowId}-a0-name`);
  await vname.fill('solved');
  await vname.press('Enter');
  await expect(page.getByTestId(`sentence-${rowId}`)).toHaveText('When "Gate" sends the signal "isOpen" on, set solved to 1.');
  await expect(page.getByTestId('event-problems')).toHaveCount(0);
  await page.screenshot({ path: shot('m5-events.png') });

  // ---- a mistake is explained in plain English ----
  await page.getByTestId(`add-action-${rowId}`).selectOption('spawn');
  await expect(page.getByTestId('event-problems')).toContainText('no prefab is chosen');
  await page.getByTestId(`action-type-${rowId}-1`).locator('xpath=..').getByRole('button', { name: 'Remove action' }).click();
  await expect(page.getByTestId('event-problems')).toHaveCount(0);

  // ---- no problems; save ----
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');
  await page.keyboard.press('Control+s');
  const saved = JSON.parse(fs.readFileSync(path.join(workDir, 'Puzzle Game', 'scenes', 'main.scene.json'), 'utf8'));
  expect(saved.wires).toHaveLength(1);
  expect(saved.events).toHaveLength(1);
  expect(saved.events[0].conditions[0].params.name).toBe('isOpen');

  // ---- play: the closed gate blocks, the crate on the plate opens it ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, {}, 5);
  let st = await playState(page);
  expect(st.gateOpen).toBe(false);
  expect(st.plateActive).toBe(false);
  // try to walk through the closed gate from below: blocked
  await play(page, GRID_PLUS_Y, 30);
  await play(page, GRID_PLUS_X, 130);
  await play(page, GRID_MINUS_Y, 60);
  st = await playState(page);
  expect(st.player.y).toBeGreaterThan(17.1); // stopped by the gate
  await page.getByTestId('btn-stop').click();

  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, GRID_PLUS_X, 55); // walk into the crate: one push
  await play(page, {}, 60);
  st = await playState(page);
  expect(st.crate.x).toBeCloseTo(21.5, 1); // now on the plate
  expect(st.plateActive).toBe(true);
  expect(st.gateOpen).toBe(true);
  expect(st.solved).toBe(1); // the event row fired
  await page.screenshot({ path: shot('m5-play-solved.png') });
  // walk through the open gate (around the crate)
  await play(page, GRID_PLUS_Y, 30);
  await play(page, GRID_PLUS_X, 70);
  await play(page, GRID_MINUS_Y, 30);
  st = await playState(page);
  expect(Math.abs(st.player.x - 24.5)).toBeLessThan(0.5);
  expect(Math.abs(st.player.y - 16.5)).toBeLessThan(0.5); // standing in the open gateway
  await page.getByTestId('btn-stop').click();

  expect(errors).toEqual([]);
  await app.close();
});

test('M5: prefabs follow their source, keep overrides, and survive save and reload', async () => {
  test.setTimeout(120_000);
  const { app, page, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Prefab Game', 'empty-iso');

  // a crate becomes a prefab
  await pickTool(page, 'place');
  await clickCell(page, 20, 10);
  await pickTool(page, 'select');
  const first = await byName(page, 'Crate');
  await clickEntity(page, first);
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  await page.getByText('Make a prefab from this object…').click();
  await page.getByTestId('prefab-name').fill('Wooden crate');
  await page.getByTestId('prefab-make').click();
  await expect(page.getByTestId('prefab-banner')).toContainText('Wooden crate');
  expect(fs.existsSync(path.join(workDir, 'Prefab Game', 'assets', 'prefabs', 'Wooden crate.prefab.json'))).toBe(true);

  // two more copies from the Assets panel
  await page.locator('.dv-tab', { hasText: 'Assets' }).click();
  await page.getByTestId('prefab-place-Wooden crate').click();
  await clickCell(page, 22, 10);
  await clickCell(page, 24, 10);
  const crates = await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.prefab === 'Wooden crate').map((e) => e.id));
  expect(crates).toHaveLength(3);

  // give the third copy its own colour (an override), then recolour the prefab from the first
  await pickTool(page, 'select');
  await clickEntity(page, crates[2]!);
  await page.getByTestId('insp-color').fill('#00aa00');
  const color = (id: string): Promise<number> => page.evaluate((i) => (window.__store!.doc!.getEntity(i)!.components.sprite as { color: number }).color, id);
  expect(await color(crates[2]!)).toBe(0x00aa00);
  await clickEntity(page, crates[0]!);
  await page.getByTestId('insp-color').fill('#cc0000');
  await page.getByTestId('prefab-apply').click();
  await expect.poll(() => color(crates[1]!)).toBe(0xcc0000); // the untouched copy follows the prefab
  expect(await color(crates[2]!)).toBe(0x00aa00); // the overridden copy keeps its own colour

  // revert the override
  await clickEntity(page, crates[2]!);
  await page.getByTestId('prefab-revert').click();
  await expect.poll(() => color(crates[2]!)).toBe(0xcc0000);

  // saved instances store only what differs
  await clickEntity(page, crates[2]!);
  await page.getByTestId('insp-color').fill('#0000cc');
  await page.keyboard.press('Control+s');
  const scenePath = path.join(workDir, 'Prefab Game', 'scenes', 'main.scene.json');
  await expect
    .poll(() => fs.readFileSync(scenePath, 'utf8').includes('"color": 204'), { timeout: 5000 }) // 0x0000cc: the saved override
    .toBe(true);
  const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  const saved = scene.entities.filter((e: { prefab?: string }) => e.prefab === 'Wooden crate');
  expect(saved).toHaveLength(3);
  const overridden = saved.find((e: { id: string }) => e.id === crates[2]);
  expect(overridden.components.sprite).toEqual({ color: 0x0000cc });
  expect(Object.keys(overridden.components).sort()).toEqual(['sprite', 'transform']);
  const plain = saved.find((e: { id: string }) => e.id === crates[1]);
  expect(Object.keys(plain.components)).toEqual(['transform']);

  // reopen: everything resolves again, with the override intact
  await page.getByText('Tilewright', { exact: true }).first().click();
  await page.getByTestId('recent-item').first().click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__store!.doc?.entities.filter((e) => e.prefab).length === 3);
  expect(await color(crates[1]!)).toBe(0xcc0000);
  expect(await color(crates[2]!)).toBe(0x0000cc);
  expect(await page.evaluate((i) => 'pushable' in window.__store!.doc!.getEntity(i)!.components, crates[1]!)).toBe(true);

  // play uses the prefab data: the crate is pushable
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  expect(await page.evaluate(() => window.__play!.sim.world.all().filter((e) => e.has('pushable')).length)).toBe(3);
  await page.getByTestId('btn-stop').click();

  // unlinking makes a plain object
  await clickEntity(page, crates[1]!);
  await page.getByTestId('prefab-unlink').click();
  await expect.poll(() => page.evaluate((i) => window.__store!.doc!.getEntity(i)!.prefab, crates[1]!)).toBeUndefined();

  // deleting the prefab leaves a clear warning, not a crash
  await page.locator('.dv-tab', { hasText: 'Assets' }).click();
  await page.getByRole('button', { name: 'Delete prefab Wooden crate' }).click();
  await expect.poll(() => page.evaluate(() => window.__store!.prefabs.size)).toBe(0);
  await clickEntity(page, crates[0]!);
  await expect(page.getByTestId('prefab-banner')).toContainText('no longer exists');

  expect(errors).toEqual([]);
  await app.close();
});

void cellXY;
