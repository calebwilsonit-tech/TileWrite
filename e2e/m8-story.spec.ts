import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { clickCell, createProjectViaUi, launchEditor, pickTool, screenLayer, shot, ui } from './helpers';

type Snapshot = Record<string, number>;
const GRID_PLUS_X: Snapshot = { move_right: 1, move_down: 1 };
const GRID_MINUS_X: Snapshot = { move_left: 1, move_up: 1 };
const GRID_PLUS_Y: Snapshot = { move_left: 1, move_down: 1 };
const GRID_MINUS_Y: Snapshot = { move_right: 1, move_up: 1 };

async function play(page: Page, snapshot: Snapshot, ticks: number): Promise<void> {
  await page.evaluate(
    ({ snapshot, ticks }) => {
      // pausing through the store keeps the editor from resuming the runner when a toast comes or goes
      window.__store!.set({ paused: true });
      const r = window.__play!.runner;
      r.paused = true;
      r.inputSource = () => snapshot;
      for (let i = 0; i < ticks; i++) r.step();
    },
    { snapshot, ticks },
  );
  await page.waitForTimeout(60); // let the game's interface catch up with the last tick
}

const byName = (page: Page, name: string): Promise<string> => page.evaluate((n) => window.__store!.doc!.entities.find((e) => e.name === n)!.id, name);

async function clickEntity(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => window.__viewport!.entityToClient(i)!, id);
  await page.mouse.click(p.x, p.y);
}

async function field(page: Page, id: string, value: string): Promise<void> {
  const f = page.getByTestId(id);
  await f.fill(value);
  await f.press('Enter');
}

const state = (page: Page) =>
  page.evaluate(() => {
    const s = window.__play!.sim;
    const p = s.world.withTag('player')[0]!.get<{ x: number; y: number }>('transform')!;
    const v = s.runtime.vars;
    return {
      scene: s.runtime.scene,
      x: p.x,
      y: p.y,
      key: (v['item:key'] as number) ?? 0,
      bread: (v['item:bread'] as number) ?? 0,
      slot1: v['slot:1'],
      slot2: v['slot:2'],
      lit: Object.keys(v).filter((k) => k.startsWith('lit:')),
      checkpoint: s.runtime.checkpoint,
      difficulty: s.runtime.difficulty,
      dialogue: s.runtime.dialogue?.view ?? null,
      cutscene: s.runtime.cutscene?.name ?? null,
      menuOpen: s.runtime.ui.modal,
    };
  });

test('M8: build a small story (items, a conversation, a cutscene, a lantern, a portal) in the editor, then play it with menus, saves and travel', async () => {
  test.setTimeout(240_000);
  const { app, page, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Story Game', 'empty-iso');
  const projectDir = path.join(workDir, 'Story Game');

  // ---- the story panel: two items ----
  await page.locator('.dv-tab').getByText('Story', { exact: true }).click();
  await page.getByTestId('item-add').click();
  await field(page, 'item-id-0', 'key');
  await field(page, 'item-name-0', 'Brass key');
  await page.getByTestId('item-add').click();
  await field(page, 'item-id-1', 'bread');
  await field(page, 'item-name-1', 'Bread');
  await page.getByTestId('item-usable-1').click();
  await field(page, 'item-heal-1', '2');
  expect((await page.evaluate(() => (window.__store!.dataList('items') as { id: string; name: string }[]).map((i) => i.id)))).toEqual(['key', 'bread']);

  // ---- a conversation: a line, a choice, a gift, a goodbye ----
  await page.getByTestId('story-tab-dialogues').click();
  await field(page, 'dialogue-new-name', 'Keeper');
  await page.getByTestId('dialogue-new').click();
  await field(page, 'dn-speaker-n1', 'Keeper');
  await field(page, 'dn-text-n1', 'Need a key, traveller?');
  await page.getByTestId('dnode-add-choice').click();
  await field(page, 'dn-option-text-n2-0', 'Yes please');
  await field(page, 'dn-option-text-n2-1', 'No thanks');
  await page.getByTestId('dnode-add-give').click();
  await page.getByTestId('dn-item-n3').selectOption('key');
  await page.getByTestId('dnode-add-line').click();
  await field(page, 'dn-text-n4', 'Safe travels.');
  await page.getByTestId('dn-option-next-n2-0').selectOption('n3');
  await expect(page.getByTestId('dialogue-ok')).toBeVisible();
  // a mistake is explained: point the choice at nothing that exists is impossible here, so empty a line instead
  await field(page, 'dn-text-n4', '');
  await expect(page.getByTestId('dialogue-problems')).toContainText('has no text');
  await field(page, 'dn-text-n4', 'Safe travels.');
  await expect(page.getByTestId('dialogue-ok')).toBeVisible();

  // ---- a cutscene: a narrated line and a message ----
  await page.getByTestId('story-tab-cutscenes').click();
  await field(page, 'cutscene-new-name', 'Intro');
  await page.getByTestId('cutscene-new').click();
  await page.getByTestId('cstep-add').click();
  await page.getByTestId('cstep-type-0').selectOption('say');
  await field(page, 'cstep-speaker-0', 'Narrator');
  await field(page, 'cstep-text-0', 'Welcome to the hub.');
  await page.getByTestId('cstep-add').click();
  await page.getByTestId('cstep-type-1').selectOption('message');
  await field(page, 'cstep-text-1', 'Find the keeper.');
  await expect(page.getByTestId('cutscene-editor')).toContainText('No problems found');

  // ---- the hub scene: health for the hero, a keeper, a lantern post, bread, a portal and the intro ----
  await pickTool(page, 'select');
  const heroId = await byName(page, 'Player');
  await clickEntity(page, heroId);
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  await page.getByTestId('add-behavior').selectOption('health');
  await page.getByTestId('add-behavior-ok').click();
  await pickTool(page, 'place');
  const place = async (prefab: string, x: number, y: number): Promise<void> => {
    await page.getByTestId('opt-prefab').selectOption(prefab);
    await clickCell(page, x, y);
  };
  const select = async (name: string): Promise<void> => {
    await pickTool(page, 'select');
    await clickEntity(page, await byName(page, name));
  };
  await place('npc', 18, 16);
  await place('lanternpost', 14, 16);
  await place('portal', 22, 12);
  await place('coin', 16, 19);
  await select('Villager');
  await field(page, 'bf-dialogue', 'Keeper');
  await select('Portal');
  await field(page, 'bf-scene', 'scenes/cave.scene.json');
  await field(page, 'bf-spawn', 'Cave entrance');
  await select('Coin');
  await field(page, 'bf-variable', '');
  await field(page, 'bf-item', 'bread');
  await pickTool(page, 'place');
  await place('cutscene', 16, 16); // it sits under the hero, so it stays selected from placing rather than being clicked on
  await field(page, 'bf-cutscene', 'Intro');
  await page.screenshot({ path: shot('m8-hub-built.png') });
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- a second scene: the cave, with a way back ----
  await page.getByTestId('btn-new-scene').click();
  await field(page, 'new-scene-name', 'Cave');
  await expect(page.getByTestId('scene-select')).toHaveValue('scenes/cave.scene.json');
  await pickTool(page, 'place');
  await place('player', 10, 14);
  await place('marker', 12, 12);
  await select('Marker');
  await field(page, 'insp-name', 'Cave entrance');
  await pickTool(page, 'place');
  await place('portal', 15, 14);
  await select('Portal');
  await field(page, 'bf-scene', 'scenes/main.scene.json');
  await field(page, 'bf-spawn', '15.5,17.5');
  await page.keyboard.press('Control+s');
  await expect.poll(() => fs.existsSync(path.join(projectDir, 'scenes', 'cave.scene.json'))).toBe(true);
  await page.getByTestId('scene-select').selectOption('scenes/main.scene.json');
  await expect(page.getByTestId('scene-select')).toHaveValue('scenes/main.scene.json');
  await expect.poll(() => page.evaluate(() => window.__store!.doc?.entities.some((e) => e.name === 'Villager'))).toBe(true);

  // ---- play: the intro cutscene ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, {}, 3);
  expect((await state(page)).cutscene).toBe('Intro');
  await expect(page.getByTestId('tw-dialogue')).toContainText('Welcome to the hub.');
  await page.screenshot({ path: shot('m8-intro.png') });
  await play(page, { interact: 1 }, 1);
  await play(page, {}, 3);
  expect((await state(page)).cutscene).toBeNull();
  await expect(page.getByText('Find the keeper.')).toBeVisible();

  // ---- the lantern ----
  await play(page, {}, 1);
  await play(page, GRID_MINUS_X, 30);
  await play(page, {}, 2);
  await play(page, { interact: 1 }, 1);
  await play(page, {}, 3);
  let st = await state(page);
  expect(st.lit).toHaveLength(1);
  expect(st.checkpoint).toMatchObject({ name: 'Lantern' });
  await expect.poll(() => fs.existsSync(path.join(projectDir, 'saves', 'autosave.save.json'))).toBe(true); // lighting it autosaves

  // ---- bread from the ground ----
  await play(page, GRID_PLUS_X, 20);
  await play(page, GRID_PLUS_Y, 60);
  st = await state(page);
  expect(st.bread).toBe(1);
  expect(st.slot1).toBe('bread');
  await expect(page.getByTestId('tw-slot-1')).toBeVisible();

  // ---- the keeper: talk, choose with the mouse, receive a key ----
  await play(page, GRID_MINUS_Y, 50);
  await play(page, GRID_PLUS_X, 30);
  await play(page, {}, 2);
  await play(page, { interact: 1 }, 1);
  await expect(page.getByTestId('tw-dialogue-text')).toHaveText('Need a key, traveller?');
  await play(page, {}, 1);
  await play(page, { interact: 1 }, 1);
  await expect(page.getByTestId('tw-choice-0')).toHaveText('Yes please');
  await page.screenshot({ path: shot('m8-dialogue-choice.png') });
  await page.getByTestId('tw-choice-0').click();
  await expect(page.getByTestId('tw-dialogue-text')).toHaveText('Safe travels.');
  await play(page, {}, 1);
  await play(page, { interact: 1 }, 1);
  await play(page, {}, 2);
  st = await state(page);
  expect(st.key).toBe(1);
  expect(st.dialogue).toBeNull();
  expect(st.slot2).toBe('key');
  const talkedAt = { x: st.x, y: st.y };

  // ---- the pause menu: inventory, save, settings, remapping ----
  await play(page, { pause: 1 }, 1);
  await expect(screenLayer(page, 'Pause')).toBeVisible();
  expect((await state(page)).menuOpen).toBe(true);
  await ui(page, 'Inventory').click();
  await expect(ui(page, 'Item', 'key')).toContainText('Brass key');
  await expect(ui(page, 'Item', 'bread')).toContainText('Bread');
  await page.screenshot({ path: shot('m8-menu.png') });
  await play(page, {}, 1);
  await play(page, { pause: 1 }, 1); // back to the first screen
  await ui(page, 'Save game').click();
  await ui(page, 'Slot', 'slot1').click();
  await expect.poll(() => fs.existsSync(path.join(projectDir, 'saves', 'slot1.save.json'))).toBe(true);
  await play(page, {}, 1);
  await play(page, { pause: 1 }, 1);
  await ui(page, 'Settings').click();
  await ui(page, 'Difficulty choice').locator('select').selectOption('hard'); // normal -> hard
  expect((await state(page)).difficulty).toBe('hard');
  await ui(page, 'Controls').click();
  await ui(page, 'Control', 'attack').click();
  await expect(ui(page, 'Control', 'attack')).toContainText('press a key');
  await page.keyboard.press('KeyF');
  await expect(ui(page, 'Control', 'attack')).toContainText('F');
  expect(await page.evaluate(() => window.__play!.session.inputMap.bindings.attack![0])).toBe('key:KeyF');
  for (let i = 0; i < 2; i++) {
    await play(page, {}, 1); // controls -> settings -> the first screen
    await play(page, { pause: 1 }, 1);
  }
  await ui(page, 'Resume').click();
  expect((await state(page)).menuOpen).toBe(false);

  // ---- through the portal into the cave: everything comes along ----
  await play(page, {}, 1);
  await play(page, GRID_PLUS_X, 40); // around the keeper, who is in the way above
  await play(page, GRID_MINUS_Y, 75);
  await play(page, GRID_PLUS_X, 30);
  await page.waitForFunction(() => window.__play!.sim.runtime.scene === 'scenes/cave.scene.json');
  await play(page, {}, 3);
  st = await state(page);
  expect(st.scene).toBe('scenes/cave.scene.json');
  expect(Math.hypot(st.x - 12.5, st.y - 12.5)).toBeLessThan(1);
  expect(st.key).toBe(1);
  expect(st.bread).toBe(1);
  expect(st.difficulty).toBe('hard');
  await page.screenshot({ path: shot('m8-cave.png') });

  // ---- fast travel back to the lantern ----
  await play(page, { map: 1 }, 1);
  await expect(screenLayer(page, 'Travel')).toContainText('Travel to a lit lantern');
  await ui(page, 'Post').first().click();
  await page.waitForFunction(() => window.__play!.sim.runtime.scene === 'scenes/main.scene.json');
  await play(page, {}, 3);
  st = await state(page);
  expect(Math.hypot(st.x - 14.5, st.y - 17.5)).toBeLessThan(1.2);
  expect((await state(page)).menuOpen).toBe(false);

  // ---- load the slot saved at the keeper ----
  await play(page, { pause: 1 }, 1);
  await ui(page, 'Load game').click();
  await ui(page, 'Slot', 'slot1').click();
  await page.waitForFunction(() => !window.__play!.sim.runtime.ui.modal);
  await play(page, {}, 3);
  st = await state(page);
  expect(st.scene).toBe('scenes/main.scene.json');
  expect(Math.hypot(st.x - talkedAt.x, st.y - talkedAt.y)).toBeLessThan(0.3);
  expect(st.key).toBe(1);
  await page.getByTestId('btn-stop').click();

  expect(errors).toEqual([]);
  await app.close();
});
