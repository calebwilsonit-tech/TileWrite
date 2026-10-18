import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { C, tilesetFromList, type SceneData, type TransformIso } from '@tilewright/runtime';
import { packsOfProject, setActivePacks, syncCustomBlocks } from '@tilewright/behaviors';
import { Game, PointerBot } from '@tilewright/playbot';
import { loadScene, openProject } from '../packages/editor/src/renderer/project/io';
import { loadAllPrefabs } from '../packages/editor/src/renderer/project/prefabs';
import { loadCutscenes, loadDialogues, loadItems, loadUiDoc } from '../packages/editor/src/renderer/project/story';
import { loadComponents, loadCustomBehaviors, loadTables } from '../packages/editor/src/renderer/project/blocks';
import { nodeFs } from './slice-bot';
import { clickCell, pickTool, root } from './helpers';

export const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

export const SAMPLES_DIR = path.join(root, 'samples');

/** Select an object by id in the editor, as a click on it would. */
export async function selectObject(page: Page, id: string): Promise<void> {
  await pickTool(page, 'select');
  await page.evaluate((i) => window.__store!.select([i]), id);
  await tab(page, 'Inspector').click();
}

/** Put an object down with the Place tool, give it a name in the Inspector, and return its id. */
export async function addObject(page: Page, prefab: string, cell: [number, number], name?: string, tags?: string[]): Promise<string> {
  const before = await page.evaluate(() => window.__store!.doc!.entities.map((e) => e.id));
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption(prefab);
  await clickCell(page, cell[0], cell[1]);
  await expect.poll(() => page.evaluate(() => window.__store!.doc!.entities.length)).toBe(before.length + 1);
  const id = await page.evaluate((b) => window.__store!.doc!.entities.map((e) => e.id).find((i) => !b.includes(i))!, before);
  await selectObject(page, id);
  if (name) {
    await page.getByTestId('insp-name').fill(name);
    await page.getByTestId('insp-name').press('Enter');
  }
  if (tags) {
    await page.getByLabel('Tags (comma separated)').fill(tags.join(', '));
    await page.getByLabel('Tags (comma separated)').press('Enter');
  }
  return id;
}

/** Add behaviours from the Inspector's Add menu. */
export async function addBehaviors(page: Page, id: string, behaviours: string[]): Promise<void> {
  await selectObject(page, id);
  for (const b of behaviours) {
    await page.getByTestId('add-behavior').selectOption(b);
    await page.getByTestId('add-behavior-ok').click();
    await expect(page.getByTestId(`behavior-${b}`)).toBeVisible();
  }
}

/** Set the settings of a behaviour that is on the selected object, by typing into its fields in the Inspector. */
export async function setFields(page: Page, behaviour: string, fields: Record<string, string | number | boolean>): Promise<void> {
  const box = page.getByTestId(`behavior-${behaviour}`);
  for (const [key, value] of Object.entries(fields)) {
    const f = box.getByTestId(`bf-${key}`);
    const type = await f.evaluate((el) => (el.tagName === 'SELECT' ? 'select' : (el as HTMLInputElement).type));
    if (type === 'select') await f.selectOption(String(value));
    else if (type === 'checkbox') {
      if ((await f.isChecked()) !== (value === true)) await f.click();
    }
    else {
      await f.fill(String(value));
      await f.press('Enter');
    }
  }
}

/** Write the project to disk and copy it into samples/<name> (without editor leftovers). */
export async function saveSample(page: Page, name: string): Promise<string> {
  await page.evaluate(() => window.__store!.save());
  await page.evaluate(() => window.__store!.flushStory());
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);
  const to = path.join(SAMPLES_DIR, name);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(dir, to, { recursive: true, filter: (src) => !/[\\/](\.tilewright|saves|logs)([\\/]|$)/.test(src) });
  return to;
}

/** A saved project, loaded from disk the way an exported game loads it, for a bot that plays without the editor. */
export async function loadSampleGame(projectDir: string, opts: { seed?: number } = {}): Promise<{ game: Game; bot: PointerBot; scenes: Map<string, SceneData> }> {
  const { project } = await openProject(nodeFs, projectDir);
  setActivePacks(packsOfProject(project));
  const [tables, components, behaviours] = await Promise.all([loadTables(nodeFs, projectDir), loadComponents(nodeFs, projectDir), loadCustomBehaviors(nodeFs, projectDir)]);
  syncCustomBlocks(components.items, behaviours.items);
  const scenes = new Map<string, SceneData>();
  for (const p of project.scenes) scenes.set(p, await loadScene(nodeFs, projectDir, p));
  const { prefabs } = await loadAllPrefabs(nodeFs, projectDir);
  const [items, dialogues, cutscenes, ui] = await Promise.all([loadItems(nodeFs, projectDir), loadDialogues(nodeFs, projectDir), loadCutscenes(nodeFs, projectDir), loadUiDoc(nodeFs, projectDir)]);
  const game = new Game({
    scene: scenes.get(project.startScene)!,
    scenePath: project.startScene,
    scenes,
    prefabs,
    items: items.items,
    dialogues: dialogues.items,
    cutscenes: cutscenes.items,
    tables: tables.items,
    ui: ui.doc,
    tileset: tilesetFromList(project.tileset),
    seed: opts.seed,
  });
  return { game, bot: new PointerBot(game), scenes };
}

export const where = (game: Game, name: string): { x: number; y: number; h: number } => {
  const e = game.sim.world.all().find((x) => x.name === name);
  if (!e) throw new Error(`There is no ${name} in the game.`);
  const t = e.require<TransformIso>(C.Transform);
  return { x: t.x, y: t.y, h: t.h };
};

// ---------- small steps every sample repeats ----------

/** Type into a field and press Enter (the editor commits on Enter or blur). */
export async function setText(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).fill(value);
  await page.getByTestId(testId).press('Enter');
}

/** Colour and size of the selected object, from the Inspector's Look and Collision groups. */
export async function look(page: Page, o: { color: string; w: number; d: number; height: number }): Promise<void> {
  await page.getByTestId('insp-color').fill(o.color);
  const lookBox = page.getByRole('group', { name: 'Look' });
  for (const [label, v] of [['Width', o.w], ['Depth', o.d], ['Height', o.height]] as const) {
    await lookBox.getByLabel(label).fill(String(v));
    await lookBox.getByLabel(label).press('Enter');
  }
  const hit = page.getByRole('group', { name: 'Collision' });
  if ((await hit.count()) > 0) {
    for (const [label, v] of [['Width', o.w], ['Depth', o.d]] as const) {
      await hit.getByLabel(label).fill(String(v));
      await hit.getByLabel(label).press('Enter');
    }
  }
}

/** Make a prefab from the selected object. */
export async function makePrefab(page: Page, name: string): Promise<void> {
  await page.locator('.prefab-make summary').click();
  await page.getByTestId('prefab-name').fill(name);
  await page.getByTestId('prefab-make').click();
  await expect(page.getByTestId('prefab-banner')).toBeVisible();
}

/** Add a row to the table that is open in the Data panel and fill its cells (`id` renames the row). */
export async function addTableRow(page: Page, table: string, cells: Record<string, string>): Promise<void> {
  await page.getByTestId('row-add').click();
  const count = await page.evaluate((t) => window.__store!.tables.find((x) => x.name === t)!.rows.length, table);
  const rowId = await page.evaluate(([t, n]) => window.__store!.tables.find((x) => x.name === t)!.rows[(n as number) - 1]!.id, [table, count] as const);
  const id = cells.id ?? rowId;
  if (cells.id) await setText(page, `cell-${rowId}-id`, cells.id);
  for (const [col, v] of Object.entries(cells)) {
    if (col === 'id') continue;
    const cell = page.getByTestId(`cell-${id}-${col}`);
    if ((await cell.evaluate((el) => el.tagName)) === 'SELECT') await cell.selectOption(v);
    else await setText(page, `cell-${id}-${col}`, v);
  }
}

/** Make a table with the given columns in the Data panel. */
export async function makeTable(page: Page, name: string, columns: [string, string][]): Promise<void> {
  await page.getByTestId('table-new-name').fill(name);
  await page.getByTestId('table-new-create').click();
  for (const [col, type] of columns) {
    await page.getByTestId('col-add-id').fill(col);
    await page.getByTestId('col-add-type').selectOption(type);
    await page.getByTestId('col-add').click();
  }
}
