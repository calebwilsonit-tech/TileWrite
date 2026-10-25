import { expect, test, type Page } from '@playwright/test';
import { C, bodyBox, gravityFrame, SolidField, type Body, type TransformIso } from '@tilewright/runtime';
import { createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';
import { addObject, loadSampleGame, saveSample, setText, tab } from './sample-helpers';
import { blocksView } from '../packages/runtime/src/render/occlusion';
import { boxAt, type DepthBox } from '../packages/runtime/src/render/depth';
import { Bot, type Game } from '@tilewright/playbot';

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
  // The bot plays it with nothing but buttons (no writing of positions), and after every single tick the body is checked against the
  // very solids the physics uses (the project's tiles included), so a moment inside a block cannot slip between two looks.
  const { game } = await loadSampleGame(dir);
  const bot = new Bot(game);
  const body = (): Body => game.player.get<Body>(C.Body)!;
  const feet = (): TransformIso => game.player.get<TransformIso>(C.Transform)!;
  const field = new SolidField(game.sim.map!, game.sim.assets.tileset);
  let overlapped = 0;
  let fadedTicks = 0;
  let wrongFades = 0;
  let ticks = 0;
  const boxNow = (b: Body) => b.turn?.box ?? bodyBox(gravityFrame(b.g ?? '-z'), { x: feet().x, y: feet().y, h: feet().h }, b.radius, b.height);
  const check = (): void => {
    ticks++;
    const b = body();
    const box = boxNow(b);
    if (field.overlaps(box, { wade: b.wade })) overlapped++;
    // the blocks the sight rule fades must really stand between the camera and the player, and those that do must fade
    // (checked a second way: the body is slid toward the camera in small steps and measured against each block)
    const depth: DepthBox = { id: 0, minX: box.x0, maxX: box.x1, minY: box.y0, maxY: box.y1, minZ: box.z0, maxZ: box.z1 };
    const blocks = sceneBlocks(game);
    if (blocks.some((k) => blocksView(depth, k.box))) fadedTicks++;
    for (const k of blocks) {
      const covered = coverage(depth, k.box);
      const fades = blocksView(depth, k.box);
      if ((fades && covered < 0.1) || (!fades && covered > 0.2)) wrongFades++;
    }
  };
  /** Press these buttons for some ticks (the bot's only way to act), looking after every tick. */
  const hold = (actions: Record<string, number>, ticksToHold: number): void => {
    for (let i = 0; i < ticksToHold; i++) {
      bot.step(actions);
      check();
    }
  };
  /** Press the buttons until the test says it is there, or the time is up; returns whether it got there. */
  const until = (actions: Record<string, number>, done: () => boolean, max = 600): boolean => {
    for (let i = 0; i < max; i++) {
      if (done()) return true;
      bot.step(actions);
      check();
    }
    return done();
  };
  const settle = (ticksToWait = 90): void => hold({}, ticksToWait);
  // which buttons walk toward +x, -x, +y and -y on the floor (the picture's diagonals)
  const PLUS_X = { move_right: 1, move_down: 1 };
  const MINUS_X = { move_left: 1, move_up: 1 };
  const PLUS_Y = { move_left: 1, move_down: 1 };
  const MINUS_Y = { move_right: 1, move_up: 1 };
  const r = (): number => body().radius;

  settle(30);
  expect(body().state).toBe('ground');
  expect(feet().h).toBeCloseTo(0, 3);
  expect(feet().x).toBeCloseTo(3.5, 1);
  expect(feet().y).toBeCloseTo(3.5, 1);

  // the low overhang at (10, 3): east along y = 3.5 the body is stopped at the block, not inside it
  until(PLUS_X, () => feet().x >= 10 - r() - 0.02, 400);
  hold(PLUS_X, 30);
  expect(feet().x).toBeCloseTo(10 - r(), 1);
  expect(feet().h).toBeCloseTo(0, 3);

  // down the east side of the room and back along y = 10.5 to the arch, then north through its doorway at (7, 8)
  expect(until(PLUS_Y, () => feet().y >= 10.5, 400)).toBe(true);
  expect(until(MINUS_X, () => feet().x <= 7.5, 400)).toBe(true);
  expect(until(MINUS_Y, () => feet().y <= 6.5, 400)).toBe(true);
  expect(feet().x).toBeGreaterThan(7 + 0.05);
  expect(feet().x).toBeLessThan(8 - 0.05); // it went through the doorway (the walls beside it are blocks)

  // west along y = 6.5 to the pillar that stands in the west wall at (0, 6): stopped at its face, x = 1 + radius
  until(MINUS_X, () => feet().x <= 1 + r() + 0.02, 600);
  hold(MINUS_X, 30);
  expect(feet().x).toBeCloseTo(1 + r(), 1);
  // and up to y = 2.5, clear of it
  expect(until(MINUS_Y, () => feet().y <= 2.5, 400)).toBe(true);

  // gravity toward the west wall (key 2): it turns over a moment, falls to the wall, and stands on it
  hold({ gravity_west: 1 }, 1);
  settle(120);
  expect(body().g).toBe('-x');
  expect(body().turn).toBeUndefined();
  expect(body().state).toBe('ground');
  expect(feet().x).toBeCloseTo(0, 3);
  // along the wall toward the pillar that sticks out of it: the walk stops against it
  until({ move_left: 1, move_down: 1 }, () => feet().y >= 6 - r() - 0.02, 600);
  hold({ move_left: 1, move_down: 1 }, 40);
  expect(body().state).toBe('ground');
  expect(feet().y).toBeGreaterThan(5);
  expect(feet().y).toBeCloseTo(6 - r(), 1);
  expect(feet().x).toBeCloseTo(0, 3);

  // to the ceiling and back to the floor
  hold({ gravity_ceiling: 1 }, 1);
  settle(150);
  expect(body().g).toBe('+z');
  expect(body().state).toBe('ground');
  expect(feet().h).toBeCloseTo(5, 3); // the underside of the ceiling
  const startY = feet().y;
  hold(MINUS_Y, 90); // walks upside down under the ceiling
  expect(feet().y).toBeLessThan(startY - 0.5);
  expect(feet().h).toBeCloseTo(5, 3);
  hold({ gravity_floor: 1 }, 1);
  settle(150);
  expect(body().g).toBe('-z');
  expect(body().state).toBe('ground');
  expect(feet().h).toBeCloseTo(0, 3);
  hold({ gravity_south: 1 }, 1);
  settle(150);
  expect(body().g).toBe('+y');
  expect(body().state).toBe('ground');
  // it stands on the first face south of it: the pillar's, which sticks out of the west wall at y = 6 (the body is beside it)
  expect(feet().y).toBeCloseTo(6, 3);
  expect(feet().x).toBeLessThan(1);
  hold({ gravity_floor: 1 }, 1);
  settle(150);
  expect(body().state).toBe('ground');
  expect(feet().h).toBeCloseTo(0, 3);

  expect(ticks).toBeGreaterThan(1000); // every one of them was looked at
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
