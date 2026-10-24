import { expect, test, type Page } from '@playwright/test';
import { C, bodyBox, gravityFrame, SolidField, type Body, type TransformIso } from '@tilewright/runtime';
import { createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';
import { addObject, loadSampleGame, saveSample, setText, tab } from './sample-helpers';
import { blocksView } from '../packages/runtime/src/render/occlusion';
import { boxAt, type DepthBox } from '../packages/runtime/src/render/depth';
import type { Game } from '@tilewright/playbot';

const where = (page: Page, x: number, y: number, z: number, face: 'top' | 'left' | 'right' = 'top') =>
  page.evaluate(([a, b, c, f]) => window.__viewport!.blockToClient(a as number, b as number, c as number, f as 'top' | 'left' | 'right'), [x, y, z, face] as const);

/**
 * Sample 9 (phase 3): the gravity room. A small room of mixed blocks (a stone ceiling, an arch with a lintel, a low overhang,
 * invisible blocker cells, stairs and a step, a bridge, a pillar sticking out of the west wall). The 1, 2, 3 and 4 keys turn
 * gravity toward the floor, the west wall, the ceiling and the south wall (rows of Quick Actions). Built through the editor,
 * then played by the bot with no editor: it walks through every turn, and checks that nothing is ever inside a block and
 * that a block fades only when it is really between the camera and the player.
 */
test('Phase 3 sample: gravity room - the floor, a wall and the ceiling in a room of mixed blocks, walked by the bot', async () => {
  test.setTimeout(400_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Gravity Room', 'empty');
  const tile = async (name: string): Promise<void> => {
    await tab(page, 'Tiles').click();
    await page.getByTestId(`tile-${name}`).click();
  };

  // ---- a 14 x 14 room ----
  await page.evaluate(() => window.__store!.select([]));
  await setText(page, 'scene-w', '14');
  await setText(page, 'scene-h', '14');
  await page.evaluate(() => window.__viewport!.frameMap());

  // ---- the arch (three pillars' worth of wall with a doorway) and a low overhang: boxes of blocks ----
  await pickTool(page, 'blockbox');
  await tile('brick');
  await tab(page, 'Structures').click();
  await page.getByTestId('opt-zfrom').fill('0');
  await page.getByTestId('opt-zto').fill('2');
  await dragCells(page, [6, 8], [8, 8]);
  await page.getByTestId('box-fill').click();
  await dragCells(page, [7, 8], [7, 8]);
  await page.getByTestId('box-z1').fill('1');
  await page.getByTestId('box-z1').press('Enter');
  await page.getByTestId('box-clear').click(); // the doorway: the two lower blocks of the middle column are gone, the lintel stays
  await tile('wood');
  await tab(page, 'Structures').click();
  await page.getByTestId('opt-zfrom').fill('1');
  await page.getByTestId('opt-zto').fill('1');
  await dragCells(page, [10, 3], [10, 3]);
  await page.getByTestId('box-fill').click(); // a block with nothing under it, a level up: too low to walk under
  await tile('stone');
  await tab(page, 'Structures').click();
  await page.getByTestId('opt-zfrom').fill('0');
  await page.getByTestId('opt-zto').fill('3');
  await dragCells(page, [0, 6], [0, 6]);
  await page.getByTestId('box-fill').click(); // a pillar that sticks out of the west wall

  // ---- stairs and a step with the Blocks tool, a bridge, and blocker cells ----
  await pickTool(page, 'blocks');
  await page.getByTestId('block-mode-add').click();
  await page.getByTestId('block-shape-stairs').click();
  await page.getByTestId('block-rot-1').click(); // rising toward the east
  await tile('sand');
  await pickTool(page, 'blocks');
  const stairs = await where(page, 11, 10, -1);
  await page.mouse.click(stairs.x, stairs.y);
  await page.getByTestId('block-shape-cube').click();
  const step = await where(page, 12, 10, -1);
  await page.mouse.click(step.x, step.y);
  expect(await page.evaluate(() => window.__store!.doc!.map.blockAt(11, 10, 0)!.shape)).toBe('stairs');

  await pickTool(page, 'bridge');
  await page.getByTestId('opt-bridge').fill('3');
  await dragCells(page, [2, 11], [4, 11]);
  await pickTool(page, 'block');
  for (const y of [4, 5]) {
    const p = await page.evaluate((cy) => window.__viewport!.cellToClient(4, cy), y);
    await page.mouse.click(p.x, p.y);
  }
  expect(await page.evaluate(() => [4, 5].map((y) => window.__store!.doc!.map.cellBlocked(4, y)))).toEqual([true, true]);

  // ---- the player ----
  await pickTool(page, 'place');
  const player = await addObject(page, 'player', [3, 3], 'Player');
  expect(player).toBeTruthy();

  // ---- the keys 1 to 4 and the rows that turn gravity ----
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('tw:project-settings', { detail: 'controls' })));
  const keys: [string, string, string, string][] = [
    ['gravity_floor', 'Gravity: the floor', 'Digit1', '-z'],
    ['gravity_west', 'Gravity: the west wall', 'Digit2', '-x'],
    ['gravity_ceiling', 'Gravity: the ceiling', 'Digit3', '+z'],
    ['gravity_south', 'Gravity: the south wall', 'Digit4', '+y'],
  ];
  for (const [id, label] of keys) {
    await setText(page, 'ctl-new-id', id);
    await setText(page, 'ctl-new-label', label);
    await page.getByTestId('ctl-add').click();
  }
  for (const [id, , code] of keys) {
    await page.getByTestId(`ctl-change-${id}`).click();
    await page.keyboard.press(code);
    await expect(page.getByTestId(`ctl-keys-${id}`)).not.toHaveText('not set');
  }
  await page.getByText('Done', { exact: true }).click();
  await tab(page, 'Events').click();
  for (const [id, , , dir] of keys) {
    await page.getByTestId('add-row').click();
    const r = await page.evaluate(() => window.__store!.doc!.events.at(-1)!.id);
    await page.getByTestId(`cond-type-${r}-0`).selectOption('action');
    await page.getByTestId(`param-${r}-c0-name`).selectOption(id);
    await page.getByTestId(`add-action-${r}`).selectOption('setGravity');
    await page.getByTestId(`param-${r}-a0-dir`).selectOption(dir);
  }

  // ---- last, the ceiling (it would be in the way of every click above) ----
  await tab(page, 'Tiles').click();
  await page.getByTestId('tile-stone').click();
  await pickTool(page, 'blockbox');
  await tab(page, 'Structures').click();
  await page.getByTestId('opt-zfrom').fill('5');
  await page.getByTestId('opt-zto').fill('5');
  await dragCells(page, [0, 0], [13, 13]);
  await page.getByTestId('box-fill').click();
  expect(await page.evaluate(() => window.__store!.doc!.map.blockAt(5, 5, 5)?.tile)).toBe(2);
  await page.evaluate(() => window.__store!.select([]));
  await page.screenshot({ path: shot('p3-gravity-room-built.png') });

  const dir = await saveSample(page, 'gravity-room');
  expect(errors).toEqual([]);
  await app.close();

  // ===== no editor from here: the saved room, played =====
  const { game } = await loadSampleGame(dir);
  const body = (): Body => game.player.get<Body>(C.Body)!;
  const feet = (): TransformIso => game.player.get<TransformIso>(C.Transform)!;
  const field = new SolidField(game.sim.map!);
  const inside = (): boolean => {
    const b = body();
    return field.overlaps(bodyBox(gravityFrame(b.g ?? '-z'), { x: feet().x, y: feet().y, h: feet().h }, b.radius, b.height), { wade: b.wade });
  };
  let overlapped = 0;
  let fadedTicks = 0;
  let wrongFades = 0;
  const check = (): void => {
    if (inside()) overlapped++;
    // the blocks the sight rule fades must really stand between the camera and the player, and those that do must fade (the
    // rule is checked a second way: the player's box is slid toward the camera in small steps and measured against each block)
    const b = body();
    const box = bodyBox(gravityFrame(b.g ?? '-z'), { x: feet().x, y: feet().y, h: feet().h }, b.radius, b.height);
    const depth: DepthBox = { id: 0, minX: box.x0, maxX: box.x1, minY: box.y0, maxY: box.y1, minZ: box.z0, maxZ: box.z1 };
    const blocks = sceneBlocks(game);
    const fading = blocks.filter((k) => blocksView(depth, k.box));
    if (fading.length > 0) fadedTicks++;
    for (const k of blocks) {
      // the other way of knowing: slide the whole body toward the camera in small steps and see how far it is inside the block
      const covered = coverage(depth, k.box);
      const fades = blocksView(depth, k.box);
      if (fades && covered < 0.1) {
        wrongFades++;
        console.log('FADE-NOT-IN-WAY', game.sim.tick, JSON.stringify(k.box), JSON.stringify(depth), covered);
      }
      if (!fades && covered > 0.2) {
        wrongFades++;
        console.log('IN-WAY-NOT-FADED', game.sim.tick, JSON.stringify(k.box), JSON.stringify(depth), covered);
      }
    }
  };
  const run = (ticks: number, actions: Record<string, number> = {}): void => {
    for (let i = 0; i < ticks; i++) {
      game.step(actions);
      if (i % 5 === 0) check();
    }
  };
  run(30);
  expect(body().state).toBe('ground');
  expect(feet().h).toBeCloseTo(0, 3);
  const right = { move_right: 1, move_down: 1 }; // +x
  const up = { move_right: 1, move_up: 1 }; // -y

  // on the floor: the doorway of the arch lets the player through; the low overhang does not
  const arch = game.sim.world.withTag('player')[0]!;
  arch.get<TransformIso>(C.Transform)!.x = 7.5;
  arch.get<TransformIso>(C.Transform)!.y = 10.5;
  run(15);
  run(60, up); // north, through the doorway at (7, 8)
  expect(feet().y).toBeLessThan(7.5);
  arch.get<TransformIso>(C.Transform)!.x = 8.5;
  arch.get<TransformIso>(C.Transform)!.y = 3.5;
  run(10);
  run(40, right); // east along y = 3 into the overhang at (10, 3)
  expect(feet().x).toBeLessThan(10 - body().radius + 1e-3);

  // turn gravity toward the west wall: it falls to the wall, and the pillar that sticks out of it stops a walk along the wall
  arch.get<TransformIso>(C.Transform)!.x = 4.5;
  arch.get<TransformIso>(C.Transform)!.y = 2.5;
  run(10);
  run(5, { gravity_west: 1 });
  run(60);
  expect(body().g).toBe('-x');
  expect(body().state).toBe('ground');
  expect(feet().x).toBeCloseTo(0, 3);
  run(150, { move_left: 1, move_down: 1 }); // along the wall toward the pillar (+y on a wall)
  expect(body().state).toBe('ground');

  // to the ceiling and back to the floor
  run(5, { gravity_ceiling: 1 });
  run(120);
  expect(body().g).toBe('+z');
  expect(body().state).toBe('ground');
  expect(feet().h).toBeCloseTo(5, 3); // the underside of the ceiling
  run(150, up); // walks upside down under the ceiling
  run(5, { gravity_floor: 1 });
  run(120);
  expect(body().g).toBe('-z');
  expect(body().state).toBe('ground');
  expect(feet().h).toBeCloseTo(0, 3);
  run(5, { gravity_south: 1 });
  run(120);
  expect(body().g).toBe('+y');
  expect(body().state).toBe('ground');
  run(5, { gravity_floor: 1 });
  run(120);
  expect(body().state).toBe('ground');

  expect(overlapped, 'ticks when the player was inside a block').toBe(0);
  expect(wrongFades, 'blocks that faded without being in the way (or stayed solid in the way)').toBe(0);
  expect(fadedTicks).toBeGreaterThan(0); // the ceiling and walls do fade when the player is behind them
});

/** Every block of the scene as a box, for the fade checks. */
function sceneBlocks(game: Game): { box: DepthBox }[] {
  const map = game.sim.map!;
  const out: { box: DepthBox }[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.getTile(x, y) === 0 && !map.getStack(x, y)) continue;
      const stack = map.getStack(x, y);
      if (stack) for (const b of stack.blocks) out.push({ box: { id: out.length, minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: b.z, maxZ: b.z + 1 } });
      else out.push({ box: map.boxFor(x, y, out.length) });
    }
  }
  return out;
}

const DIRECTION = [1, 1, 2];

/**
 * How far (in cells along the line of sight) the body, slid toward the camera in small steps, is inside the block; zero when
 * it starts inside it (a body leaning into a block is not behind it).
 */
function coverage(body: DepthBox, block: DepthBox): number {
  const overlaps = (t: number): boolean =>
    body.minX + t * DIRECTION[0]! < block.maxX - 1e-6 && body.maxX + t * DIRECTION[0]! > block.minX + 1e-6 && body.minY + t * DIRECTION[1]! < block.maxY - 1e-6 && body.maxY + t * DIRECTION[1]! > block.minY + 1e-6 && body.minZ + t * DIRECTION[2]! < block.maxZ - 1e-6 && body.maxZ + t * DIRECTION[2]! > block.minZ + 1e-6;
  if (overlaps(0)) return 0;
  let n = 0;
  for (let t = 0.01; t < 80; t += 0.01) if (overlaps(t)) n++;
  return n * 0.01;
}

void boxAt;
