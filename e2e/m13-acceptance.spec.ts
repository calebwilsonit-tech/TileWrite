import { _electron as electron, expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cellInfo, cellXY, clickCell, createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';
import { newSliceGame, nodeFs, playSlice } from './slice-bot';
import { newPlaythrough, replayPlaythrough } from '@tilewright/playbot';
import { serializeGame } from '@tilewright/runtime';
import { savePlaythrough } from '../packages/editor/src/renderer/project/playthroughs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRID_PLUS_X: Snapshot = { move_right: 1, move_down: 1 };
const GRID_MINUS_Y: Snapshot = { move_right: 1, move_up: 1 };
const GRID_PLUS_Y: Snapshot = { move_left: 1, move_down: 1 };

/**
 * M13, the acceptance test: a vertical slice of "The Last Storytender", built with the editor's own tools and panels
 * (mouse and keyboard through the real window, no code), checked by the validators, finished by the playbot, played
 * in the editor with the real menus, and exported.
 *
 * The slice: a hub village (an elder with a choice that sets a flag, a lantern post, a seal that opens because of the
 * flag, a portal) and a dungeon (a plateau with stairs and an echo puzzle with two plates, a crate puzzle, a sentence
 * stone that turns a text block into a bridge over a pit, a patrolling guard, a lantern post, and an arena with a boss
 * in two phases that guards the exit).
 */

type Snapshot = Record<string, number>;

async function play(page: Page, snapshot: Snapshot, ticks: number): Promise<void> {
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
  await page.waitForTimeout(60);
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

/** Drag a brush along a straight line of cells, one mouse move per cell, so every cell on the way is painted. */
async function brushLine(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const n = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  const a = await cellXY(page, ...from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= n; i++) {
    const p = await cellXY(page, from[0] + Math.round(((to[0] - from[0]) * i) / n), from[1] + Math.round(((to[1] - from[1]) * i) / n));
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
}

async function field(page: Page, id: string, value: string): Promise<void> {
  const f = page.getByTestId(id);
  await f.fill(value);
  await f.press('Enter');
}

async function addBehavior(page: Page, id: string): Promise<void> {
  await page.getByTestId('add-behavior').selectOption(id);
  await page.getByTestId('add-behavior-ok').click();
  await expect(page.getByTestId(`behavior-${id}`)).toBeVisible();
}

async function setField(page: Page, behaviour: string, key: string, value: string): Promise<void> {
  await field(page, `bf-${key}`, value).catch(async () => {
    const f = page.getByTestId(`behavior-${behaviour}`).getByTestId(`bf-${key}`);
    await f.fill(value);
    await f.press('Enter');
  });
}

async function behaviourField(page: Page, behaviour: string, key: string, value: string): Promise<void> {
  const f = page.getByTestId(`behavior-${behaviour}`).getByTestId(`bf-${key}`);
  await f.fill(value);
  await f.press('Enter');
}

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

test('M13: build the Last Storytender slice with the editor only, check it, let the playbot finish it, play it, and export it', async () => {
  test.setTimeout(900_000);
  const { app, page, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'The Last Storytender', 'empty-iso');
  const projectDir = path.join(workDir, 'The Last Storytender');
  void setField;

  /**
   * Place an object on a cell, select it, then make its position exact in the Inspector (tall walls hide cells from the
   * mouse, so a click can land on the wrong cell), and optionally give it a name.
   */
  const place = async (prefab: string, x: number, y: number, name?: string, at: { x?: number; y?: number; h?: number } = {}): Promise<void> => {
    const before = await page.evaluate(() => window.__store!.doc!.entities.length);
    await pickTool(page, 'place');
    await page.getByTestId('opt-prefab').selectOption(prefab);
    await clickCell(page, x, y);
    await expect.poll(() => page.evaluate(() => window.__store!.doc!.entities.length)).toBe(before + 1);
    await pickTool(page, 'select');
    const id = await page.evaluate(() => window.__store!.doc!.entities.at(-1)!.id);
    await clickEntity(page, id);
    await expect.poll(() => page.evaluate(() => window.__store!.state.selection)).toEqual([id]);
    const want = { x: at.x ?? x + 0.5, y: at.y ?? y + 0.5, h: at.h ?? 0 };
    const have = await page.evaluate((i) => window.__store!.doc!.getEntity(i)!.components.transform as { x: number; y: number; h: number }, id);
    if (have.x !== want.x) await field(page, 'insp-x', String(want.x));
    if (have.y !== want.y) await field(page, 'insp-y', String(want.y));
    if (have.h !== want.h) await field(page, 'insp-h', String(want.h));
    expect(await page.evaluate((i) => window.__store!.doc!.getEntity(i)!.components.transform, id)).toMatchObject(want);
    if (name) {
      await field(page, 'insp-name', name);
      await expect.poll(() => page.evaluate((n) => window.__store!.doc!.entities.some((e) => e.name === n), name)).toBe(true);
    }
  };
  const select = async (name: string): Promise<void> => {
    await pickTool(page, 'select');
    await clickEntity(page, await byName(page, name));
  };
  const wire = async (from: string, to: string, opts: { output?: string; input?: string } = {}): Promise<void> => {
    const a = await byName(page, from);
    const b = await byName(page, to);
    await pickTool(page, 'wire');
    await dragEntities(page, a, b);
    await expect(page.getByTestId('connect-dialog')).toBeVisible();
    if (opts.output) await page.getByTestId('connect-output').selectOption(opts.output);
    if (opts.input) await page.getByTestId('connect-input').selectOption(opts.input);
    await page.getByTestId('connect-ok').click();
    await pickTool(page, 'select');
  };

  // =========================================================================================
  // THE STORY: a conversation with a choice that sets a flag
  // =========================================================================================
  await tab(page, 'Story').click();
  await page.getByTestId('story-tab-dialogues').click();
  await field(page, 'dialogue-new-name', 'Elder');
  await page.getByTestId('dialogue-new').click();
  await field(page, 'dn-speaker-n1', 'Elder');
  await field(page, 'dn-text-n1', 'The old words are broken, storyteller. Will you mend them?');
  await page.getByTestId('dnode-add-choice').click(); // n2
  await field(page, 'dn-prompt-n2', 'What do you say?');
  await field(page, 'dn-option-text-n2-0', 'I will.');
  await field(page, 'dn-option-text-n2-1', 'Not yet.');
  await page.getByTestId('dnode-add-line').click(); // n3: the answer to "Not yet."
  await field(page, 'dn-speaker-n3', 'Elder');
  await field(page, 'dn-text-n3', 'Come back when you are ready.');
  await page.getByTestId('dnode-add-end').click(); // n4: it stops there
  await page.getByTestId('dnode-add-set').click(); // n5: the flag
  await field(page, 'dn-var-n5', 'accepted');
  await field(page, 'dn-value-n5', '1');
  await page.getByTestId('dnode-add-line').click(); // n6
  await field(page, 'dn-speaker-n6', 'Elder');
  await field(page, 'dn-text-n6', 'Then the seal will open. Go with the light.');
  await page.getByTestId('dn-option-next-n2-0').selectOption('n5');
  await page.getByTestId('dn-option-next-n2-1').selectOption('n3');
  await expect(page.getByTestId('dialogue-ok')).toBeVisible();

  // =========================================================================================
  // THE HUB: a village, a wall with a seal in its gap, the elder, a lantern post, a portal
  // =========================================================================================
  await pickTool(page, 'select');
  await page.getByTestId('tile-sand').click();
  await pickTool(page, 'paint');
  await brushLine(page, [3, 16], [20, 16]); // a path
  await page.getByTestId('tile-brick').click();
  await pickTool(page, 'cliff');
  await page.getByTestId('opt-height').fill('3');
  await dragCells(page, [14, 0], [14, 15]);
  await dragCells(page, [14, 17], [14, 31]);
  expect(await cellInfo(page, 14, 3)).toMatchObject({ tile: 5, height: 3 });
  expect((await cellInfo(page, 14, 16)).height).toBe(0); // the gap

  // the hero: health, a quill, a dodge, two echoes and a lantern; moved to the west side
  await select('Player');
  await tab(page, 'Inspector').click();
  await field(page, 'insp-x', '6.5');
  await field(page, 'insp-y', '16.5');
  await addBehavior(page, 'health');
  await behaviourField(page, 'health', 'max', '20');
  await page.getByTestId('behavior-health').getByTestId('bf-onDeath').selectOption('respawn');
  await addBehavior(page, 'meleeAttack');
  await behaviourField(page, 'meleeAttack', 'damage', '2');
  await behaviourField(page, 'meleeAttack', 'arc', '360');
  await addBehavior(page, 'dodge');
  await addBehavior(page, 'echoRecorder');
  await behaviourField(page, 'echoRecorder', 'capacity', '2');
  await addBehavior(page, 'light');

  await place('npc', 9, 16, 'Elder');
  await field(page, 'bf-dialogue', 'Elder');
  await place('lanternpost', 7, 13, 'Hub lantern');
  await place('pillar', 14, 16, 'Seal');
  await place('portal', 19, 16, 'Portal');
  await field(page, 'bf-scene', 'scenes/dungeon.scene.json');
  await field(page, 'bf-spawn', 'Dungeon entrance');

  // the flag opens the seal: one event row
  await tab(page, 'Events').click();
  await page.getByTestId('add-row').click();
  const rowId = await page.evaluate(() => window.__store!.doc!.events[0]!.id);
  await page.getByTestId(`cond-type-${rowId}-0`).selectOption('variable');
  await field(page, `param-${rowId}-c0-name`, 'accepted');
  const sealId = await byName(page, 'Seal');
  await page.getByTestId(`add-action-${rowId}`).selectOption('setEnabled');
  await page.getByTestId(`param-${rowId}-a0-who`).selectOption(`id:${sealId}`);
  await page.getByTestId(`param-${rowId}-a0-state`).selectOption('off');
  await page.getByTestId(`add-action-${rowId}`).selectOption('setVisible');
  await page.getByTestId(`param-${rowId}-a1-who`).selectOption(`id:${sealId}`);
  await page.getByTestId(`param-${rowId}-a1-visible`).selectOption('hidden');
  await expect(page.getByTestId(`sentence-${rowId}`)).toContainText('accepted');
  await expect(page.getByTestId('event-problems')).toHaveCount(0);
  await page.screenshot({ path: shot('m13-hub-built.png') });
  await page.keyboard.press('Control+s');
  await select('Player');
  await page.keyboard.press('Control+c'); // the hero comes along to the dungeon

  // =========================================================================================
  // THE DUNGEON
  // =========================================================================================
  await page.getByTestId('btn-new-scene').click();
  await field(page, 'new-scene-name', 'Dungeon');
  await expect(page.getByTestId('scene-select')).toHaveValue('scenes/dungeon.scene.json');
  await page.getByTestId('tile-stone').click();
  await pickTool(page, 'fill');
  await clickCell(page, 1, 1);
  expect((await cellInfo(page, 30, 30)).tile).toBe(2);

  // a pit two cells wide, all the way across (painted first, while the ground is still flat: tall walls would hide cells from the mouse)
  await pickTool(page, 'pit');
  await brushLine(page, [22, 0], [22, 31]);
  await brushLine(page, [23, 0], [23, 31]);
  for (const y of [0, 16, 31]) for (const x of [22, 23]) expect((await cellInfo(page, x, y)).flags & 1, `pit at ${x},${y}`).toBe(1);

  // a plateau two levels up, with stairs from the south
  await page.getByTestId('tile-sand').click();
  await pickTool(page, 'cliff');
  await page.getByTestId('opt-height').fill('2');
  await dragCells(page, [4, 8], [9, 13]);
  await pickTool(page, 'stairs');
  await dragCells(page, [6, 15], [6, 14]);
  expect(await cellInfo(page, 6, 15)).toMatchObject({ height: 0, slope: 1 });
  expect(await cellInfo(page, 6, 14)).toMatchObject({ height: 1, slope: 1 });
  expect(await cellInfo(page, 6, 12)).toMatchObject({ height: 2 });

  // three walls across the dungeon, each with a one-cell doorway, and the walls of the crate corridor
  await page.getByTestId('tile-brick').click();
  await pickTool(page, 'cliff');
  await page.getByTestId('opt-height').fill('3');
  for (const x of [12, 24, 29]) {
    await dragCells(page, [x, 0], [x, 15]);
    await dragCells(page, [x, 17], [x, 31]);
  }
  await dragCells(page, [14, 25], [21, 25]);
  await dragCells(page, [14, 27], [21, 27]);
  await dragCells(page, [21, 26], [21, 26]);
  for (const [x, y] of [[12, 0], [12, 31], [24, 0], [24, 31], [29, 5], [29, 28], [14, 25], [21, 25], [14, 27], [21, 26]] as const) expect((await cellInfo(page, x, y)).height, `wall at ${x},${y}`).toBe(3);
  for (const x of [12, 24, 29]) expect((await cellInfo(page, x, 16)).height, `doorway at ${x}`).toBe(0);
  // the hero (copied from the hub), the entrance
  await page.keyboard.press('Control+v');
  await expect.poll(() => page.evaluate(() => window.__store!.doc!.entities.some((e) => e.tags.includes('player')))).toBe(true);
  await tab(page, 'Inspector').click();
  await field(page, 'insp-x', '2.5');
  await field(page, 'insp-y', '16.5');
  await place('marker', 3, 16, 'Dungeon entrance');

  // the echo puzzle on the plateau: two plates, an AND, a gate in the first wall
  await place('plate', 4, 9, 'Echo plate A', { h: 2 });
  await page.getByTestId('behavior-pressurePlate').getByTestId('bf-activatedBy').selectOption('echoes'); // only an echo can hold A
  await place('plate', 9, 9, 'Echo plate B', { h: 2 });
  await page.getByTestId('behavior-pressurePlate').getByTestId('bf-activatedBy').selectOption('player'); // only the player can press B
  await page.getByTestId('behavior-pressurePlate').getByTestId('bf-latch').click(); // and B stays down once pressed
  await place('logic', 3, 11, 'AND');
  await place('gate', 12, 16, 'Echo gate');
  await wire('Echo plate A', 'AND');
  await wire('Echo plate B', 'AND', { input: 'b' });
  await wire('AND', 'Echo gate');

  // the crate puzzle: a crate in a corridor and a plate at its end, wired to the gate in the second wall
  await place('crate', 16, 26);
  await place('plate', 20, 26, 'Crate plate');
  await place('gate', 24, 16, 'Crate gate');
  await wire('Crate plate', 'Crate gate');

  // the sentence stone and the text block that bridges the pit
  await place('stone', 20, 14, 'Sentence stone');
  await place('text', 22, 16, 'Bridge', { x: 23 });
  await wire('Sentence stone', 'Bridge', { output: 'word2', input: 'underline' });

  // a guard walking a route in the south of the second room
  await place('guard', 15, 21, 'Guard');
  await pickTool(page, 'patrol');
  await clickCell(page, 21, 21);
  await clickCell(page, 17, 21); // (a click on the guard itself would only select it)
  await pickTool(page, 'select');
  expect(await page.evaluate(() => (window.__store!.doc!.entities.find((e) => e.name === 'Guard')!.components.patrol as { points: string }).points)).toBe('21.5,21.5; 17.5,21.5');

  // the third room: a lantern post, an arena with a boss, a gate that opens when it is defeated, the exit
  await place('lanternpost', 25, 12, 'Dungeon lantern');
  await pickTool(page, 'region');
  await dragCells(page, [25, 14], [28, 24]);
  await tab(page, 'Inspector').click();
  await page.getByLabel('Bosses here only act while the player is inside').click();
  await place('boss', 26, 21);
  await behaviourField(page, 'health', 'max', '8');
  await behaviourField(page, 'health', 'invulnerableSeconds', '0.4');
  await place('gate', 29, 16, 'Exit gate');
  await place('goal', 30, 16, 'Exit');
  await wire('Boss', 'Exit gate', { output: 'defeated' });
  await pickTool(page, 'select');
  expect(await page.evaluate(() => window.__store!.doc!.wires.map((w) => `${w.from.output}->${w.to.input}`).sort())).toEqual(['active->a', 'active->b', 'active->open', 'defeated->open', 'out->open', 'word2->underline']);
  await tab(page, 'Problems').click();
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');
  await page.screenshot({ path: shot('m13-dungeon-built.png') });
  await page.keyboard.press('Control+s');
  await expect.poll(() => fs.existsSync(path.join(projectDir, 'scenes', 'dungeon.scene.json'))).toBe(true);
  await page.evaluate(() => window.__store!.select([]));
  await page.evaluate(() => window.__viewport!.frameMap());
  await page.waitForTimeout(400);
  await expect(page.getByTestId('viewport').locator('canvas')).toHaveScreenshot('dungeon-built.png', { maxDiffPixelRatio: 0.02 }); // a golden picture: drawing changes show up here
  if (process.env.TILEWRIGHT_KEEP_SLICE) fs.cpSync(projectDir, process.env.TILEWRIGHT_KEEP_SLICE, { recursive: true }); // for developing the bot without rebuilding the slice


  // =========================================================================================
  // THE VALIDATORS: no bypassable puzzle, no soft-lock, nothing wrong anywhere in the project
  // =========================================================================================
  await tab(page, 'Problems').click();
  await page.getByTestId('check-puzzles').click(); // the full check: bypasses, unreachable goals, soft-locks
  await expect(page.getByTestId('problems-panel')).not.toContainText('bypass');
  await expect(page.getByTestId('problems-panel')).not.toContainText('soft-locked');
  await expect(page.getByTestId('problems-panel')).toContainText('No problems found');
  await page.getByTestId('check-project').click();
  await expect(page.getByTestId('project-check')).toContainText('all clear');
  await page.screenshot({ path: shot('m13-validators.png') });

  // the same checks do catch a hole: open a second doorway in the exit wall and the check says the exit gate blocks nothing, then undo it
  await pickTool(page, 'cliff');
  await page.getByTestId('tile-stone').click();
  await page.getByTestId('opt-height').fill('0');
  await dragCells(page, [29, 5], [29, 6]);
  await expect.poll(() => cellInfo(page, 29, 5).then((c) => c.height)).toBe(0);
  await tab(page, 'Problems').click();
  await page.getByTestId('check-puzzles').click();
  await expect(page.getByTestId('problems-panel')).toContainText('The gate "Exit gate" blocks nothing');
  await page.keyboard.press('Control+z');
  await expect.poll(() => cellInfo(page, 29, 5).then((c) => c.height)).toBe(3);
  await page.getByTestId('check-puzzles').click();
  await expect(page.getByTestId('problems-panel')).not.toContainText('blocks nothing');
  await pickTool(page, 'select');
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('dirty')).toHaveText('Saved');

  // =========================================================================================
  // THE PLAYBOT FINISHES THE SLICE: only buttons, from the first frame to the exit, through the portal
  // =========================================================================================
  const run = await playSlice(projectDir);
  const vars = run.game.sim.runtime.vars;
  expect(run.game.scenePath).toBe('scenes/dungeon.scene.json');
  expect(vars.accepted).toBe(1); // the choice set the flag
  expect(Object.keys(vars).filter((k) => k.startsWith('lit:'))).toHaveLength(2); // both lanterns were lit
  const exit = run.game.find('tag:goal')!.get<{ x: number; y: number }>('transform')!;
  expect(Math.hypot(run.game.position.x - exit.x, run.game.position.y - exit.y)).toBeLessThan(0.5);
  expect(run.game.problems).toEqual([]);
  const seconds = run.game.sim.tick / 60;
  fs.writeFileSync(path.join(root, 'screenshots', 'm13-bot-run.txt'), `${run.log.join('\n')}\n\nThe bot got from the first frame to the exit in ${seconds.toFixed(1)} s of game time (${run.game.sim.tick} steps), pressing only buttons.\n`);
  expect(seconds).toBeLessThan(120);

  // the run is kept as a playthrough: replaying the same buttons gives the same game, every time, and quickly
  const keep = newPlaythrough('Storytender slice', 'scenes/main.scene.json', run.bot.recording(), 1, { vars: { accepted: 1 }, near: 'tag:goal', within: 0.6 });
  await savePlaythrough(nodeFs, projectDir, keep);
  const ends: string[] = [];
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const g = await newSliceGame(projectDir);
    const t0 = performance.now();
    const r = replayPlaythrough(g, keep);
    best = Math.min(best, (performance.now() - t0) / g.sim.tick);
    expect(r, r.problems.join(' ')).toMatchObject({ ok: true });
    ends.push(JSON.stringify(serializeGame(g.sim, { stamp: '' })));
  }
  expect(new Set(ends).size).toBe(1); // determinism: identical saved state after every replay
  expect(ends[0]).toBe(JSON.stringify(serializeGame(run.game.sim, { stamp: '' }))); // and the same as the bot's own run
  expect(best).toBeLessThan(5); // milliseconds of game logic per 60 Hz step, against a 16.7 ms frame (it is about 1 on this machine)

  // the Playbot panel replays it too (from the hub, through the portal, to the exit), whichever scene is open
  await page.evaluate(() => window.__store!.loadPlaythroughNames());
  await tab(page, 'Playbot').click();
  await page.getByTestId('playthrough-run-Storytender slice').click();
  await expect(page.getByTestId('bot-log-item').first()).toContainText('Playthrough "Storytender slice" still works');
  await page.screenshot({ path: shot('m13-playbot-replay.png') });
  // the finished slice, with its playthrough, is what ships as the sample game (templates/last-storytender; see docs/acceptance.md)
  if (process.env.TILEWRIGHT_SAMPLE_OUT) {
    fs.rmSync(process.env.TILEWRIGHT_SAMPLE_OUT, { recursive: true, force: true });
    fs.cpSync(projectDir, process.env.TILEWRIGHT_SAMPLE_OUT, { recursive: true, filter: (src) => !/[\\/](saves|\.tilewright|exports|release)([\\/]|$)/.test(src.slice(projectDir.length)) });
  }

  // =========================================================================================
  // PLAY IT IN THE EDITOR: the real menus, the flag opening the seal, saving, loading, remapping, death and respawn
  // =========================================================================================
  const hub = async (): Promise<void> => {
    await page.getByTestId('scene-select').selectOption('scenes/main.scene.json');
    await expect.poll(() => page.evaluate(() => window.__store!.doc!.entities.some((e) => e.name === 'Elder'))).toBe(true);
  };
  const state = () =>
    page.evaluate(() => {
      const s = window.__play!.sim;
      const p = s.world.withTag('player')[0]!;
      const t = p.get<{ x: number; y: number }>('transform')!;
      const v = s.runtime.vars;
      const seal = s.world.all().find((e) => e.name === 'Seal');
      return {
        scene: s.runtime.scene,
        x: t.x,
        y: t.y,
        accepted: v.accepted,
        lit: Object.keys(v).filter((k) => k.startsWith('lit:')),
        sealSolid: seal ? (seal.get<{ enabled: boolean }>('collider')?.enabled ?? null) : null,
        menuOpen: s.runtime.menuOpen,
        hp: p.get<{ hp: number; dead: boolean }>('state:health')?.hp ?? null,
        checkpoint: s.runtime.checkpoint,
        dialogue: s.runtime.dialogue?.view ?? null,
      };
    });
  await hub();
  await page.evaluate(() => window.__store!.select([]));
  await page.evaluate(() => window.__viewport!.frameMap());
  await page.waitForTimeout(400);
  await expect(page.getByTestId('viewport').locator('canvas')).toHaveScreenshot('hub-built.png', { maxDiffPixelRatio: 0.02 });

  // the speed meter while the real game runs: frames per second and milliseconds of game logic per step
  await tab(page, 'Layers').click();
  await page.getByTestId('view-profiler').check();
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.waitForTimeout(3000);
  const meter = (await page.getByTestId('tw-profiler').textContent()) ?? '';
  const fps = Number(/(\d+) frames per second/.exec(meter)?.[1]);
  const stepMs = Number(/game step ([\d.]+) ms/.exec(meter)?.[1]);
  fs.writeFileSync(path.join(root, 'screenshots', 'm13-speed.txt'), meter);
  expect(stepMs, meter).toBeLessThan(5);
  expect(fps, meter).toBeGreaterThanOrEqual(30);
  await page.getByTestId('btn-stop').click();
  await page.getByTestId('view-profiler').uncheck();

  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, {}, 5);
  await expect(page.getByTestId('tw-hearts')).toBeVisible();
  expect((await state()).sealSolid).toBe(true); // the seal blocks the way
  await play(page, GRID_PLUS_X, 35);
  await play(page, {}, 2);
  await play(page, { interact: 1 }, 1);
  await expect(page.getByTestId('tw-dialogue-text')).toHaveText('The old words are broken, storyteller. Will you mend them?');
  await play(page, {}, 1);
  await play(page, { interact: 1 }, 1);
  await expect(page.getByTestId('tw-choice-0')).toHaveText('I will.');
  await expect(page.getByTestId('tw-choice-1')).toHaveText('Not yet.');
  await page.screenshot({ path: shot('m13-choice.png') });
  await page.getByTestId('tw-choice-0').click();
  await expect(page.getByTestId('tw-dialogue-text')).toHaveText('Then the seal will open. Go with the light.');
  await play(page, {}, 1);
  await play(page, { interact: 1 }, 1);
  await play(page, {}, 10);
  let st = await state();
  expect(st.accepted).toBe(1);
  expect(st.sealSolid).toBe(false); // the choice set the flag, and the event row opened the seal
  await page.screenshot({ path: shot('m13-seal-open.png') });

  // pause menu: Restart and Travel are there; save, remap a button, load
  await play(page, { pause: 1 }, 1);
  await expect(page.getByTestId('tw-menu')).toBeVisible();
  await expect(page.getByTestId('tw-row-restart')).toBeVisible();
  await expect(page.getByTestId('tw-row-travel')).toBeVisible();
  await page.getByTestId('tw-row-save').click();
  await page.getByTestId('tw-row-slot-slot1').click();
  await expect.poll(() => fs.existsSync(path.join(projectDir, 'saves', 'slot1.save.json'))).toBe(true);
  await play(page, {}, 1);
  await play(page, { pause: 1 }, 1);
  await page.getByTestId('tw-row-settings').click();
  await page.getByTestId('tw-row-set-controls').click();
  await page.getByTestId('tw-row-bind-attack').click();
  await page.keyboard.press('KeyF');
  await expect(page.getByTestId('tw-row-bind-attack')).toContainText('F');
  expect(await page.evaluate(() => window.__play!.session.inputMap.bindings.attack![0])).toBe('key:KeyF');
  await page.screenshot({ path: shot('m13-remap.png') });
  for (let i = 0; i < 2; i++) {
    await play(page, {}, 1);
    await play(page, { pause: 1 }, 1);
  }
  await page.getByTestId('tw-row-resume').click();
  await play(page, GRID_MINUS_Y, 40); // wander off ...
  await play(page, { pause: 1 }, 1);
  await page.getByTestId('tw-row-load').click(); // ... and load the save: back where it was, flag still set
  await page.getByTestId('tw-row-slot-slot1').click();
  await page.waitForFunction(() => !window.__play!.sim.runtime.menuOpen);
  await play(page, {}, 3);
  const loaded = await state();
  expect(Math.hypot(loaded.x - st.x, loaded.y - st.y)).toBeLessThan(0.3);
  expect(loaded.accepted).toBe(1);
  await page.getByTestId('btn-stop').click();

  // the dungeon: light the lantern, be defeated, wake up at the lantern; Restart goes there too
  await page.getByTestId('scene-select').selectOption('scenes/dungeon.scene.json');
  await expect.poll(() => page.evaluate(() => window.__store!.doc!.entities.some((e) => e.name === 'Dungeon lantern'))).toBe(true);
  const hover = await cellXY(page, 26, 13);
  await page.mouse.move(hover.x, hover.y);
  await page.keyboard.press('Control+Enter'); // play from the cell under the mouse
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, {}, 5);
  expect(Math.abs((await state()).x - 26.5)).toBeLessThan(0.6);
  await play(page, { interact: 1 }, 1);
  await play(page, {}, 5);
  st = await state();
  expect(st.lit).toHaveLength(1);
  expect(st.checkpoint).toMatchObject({ name: 'Lantern' });
  await play(page, GRID_PLUS_Y, 30); // walk away from it
  await page.evaluate(() => {
    window.__play!.sim.world.withTag('player')[0]!.get<{ hp: number }>('state:health')!.hp = 0; // defeated
  });
  await play(page, {}, 120);
  st = await state();
  expect(st.hp).toBeGreaterThan(0);
  expect(Math.hypot(st.x - 25.5, st.y - 12.5)).toBeLessThan(2.5); // back at the lantern
  await play(page, GRID_PLUS_Y, 40);
  await play(page, { pause: 1 }, 1);
  await expect(page.getByTestId('tw-row-travel')).toContainText('1 lit');
  await page.getByTestId('tw-row-restart').click();
  await play(page, {}, 5);
  st = await state();
  expect(Math.hypot(st.x - 25.5, st.y - 12.5)).toBeLessThan(2.5);
  await page.screenshot({ path: shot('m13-dungeon-play.png') });
  await page.getByTestId('btn-stop').click();

  // =========================================================================================
  // EXPORT IT AND PLAY THE EXPORTED GAME with no editor
  // =========================================================================================
  await hub();
  await page.getByTestId('btn-export').click();
  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('export-go').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 240_000 });
  const exe = (await page.getByTestId('export-exe').textContent())!;
  expect(path.basename(exe)).toBe('The Last Storytender.exe');
  await page.getByTestId('export-close').click();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-game-'));
  const game = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, TILEWRIGHT_GAME_TEST: '1', TILEWRIGHT_GAME_USERDATA: userData } });
  const gp = await game.firstWindow();
  await gp.waitForFunction(() => (window as unknown as { __game?: unknown }).__game !== undefined, undefined, { timeout: 60_000 });
  const gstate = () =>
    gp.evaluate(() => {
      const s = (window as unknown as { __game: { session: { sim: import('@tilewright/runtime').Simulation } } }).__game.session.sim;
      const t = s.world.withTag('player')[0]!.get<{ x: number; y: number }>('transform')!;
      return { scene: s.runtime.scene, x: t.x, y: t.y, accepted: s.runtime.vars.accepted, dialogue: s.runtime.dialogue?.view ?? null };
    });
  await gp.waitForTimeout(500);
  const g0 = await gstate();
  expect(g0.scene).toBe('scenes/main.scene.json'); // it starts in the hub
  await gp.keyboard.down('KeyD'); // east along the grid: D and S together
  await gp.keyboard.down('KeyS');
  await gp.waitForTimeout(700);
  await gp.keyboard.up('KeyD');
  await gp.keyboard.up('KeyS');
  expect((await gstate()).x).toBeGreaterThan(g0.x + 1);
  const tap = async (key: string): Promise<void> => {
    await gp.keyboard.down(key); // held for a few frames, so the game sees it
    await gp.waitForTimeout(120);
    await gp.keyboard.up(key);
    await gp.waitForTimeout(120);
  };
  await tap('KeyE');
  await expect(gp.getByTestId('tw-dialogue-text')).toHaveText('The old words are broken, storyteller. Will you mend them?', { timeout: 10_000 });
  await tap('KeyE');
  await gp.getByTestId('tw-choice-0').click();
  await tap('KeyE');
  await expect.poll(async () => (await gstate()).accepted, { timeout: 10_000 }).toBe(1);
  await gp.screenshot({ path: shot('m13-exported-game.png') });
  await game.close();

  expect(errors).toEqual([]);
  await app.close();
});
