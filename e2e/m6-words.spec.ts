import { expect, test, type Page } from '@playwright/test';
import { cellInfo, clickCell, createProjectViaUi, launchEditor, pickTool, shot } from './helpers';

type Snapshot = Record<string, number>;
const GRID_PLUS_X: Snapshot = { move_right: 1, move_down: 1 };
const GRID_MINUS_Y: Snapshot = { move_right: 1, move_up: 1 };

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

const info = (page: Page) =>
  page.evaluate(() => {
    const s = window.__play!.sim;
    const find = (n: string) => s.world.all().find((e) => e.name === n)!;
    const p = s.world.withTag('player')[0]!.get<{ x: number; y: number; h: number }>('transform')!;
    return {
      stone: find('Sentence stone').get<{ text: string }>('label')!.text,
      block: find('Text block').get<{ underline: boolean; bold: boolean; italic: boolean }>('label')!,
      gateOpen: find('Gate').get<{ enabled: boolean }>('collider')!.enabled === false,
      player: { x: p.x, y: p.y, h: p.h },
    };
  });

test('M6: a sentence stone opens a gate and an underlined text block bridges a pit, built in the editor', async () => {
  test.setTimeout(150_000);
  const { app, page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Word Game', 'empty-iso');

  // ---- stone + gate + wire ----
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption('stone');
  await clickCell(page, 17, 16);
  await page.getByTestId('opt-prefab').selectOption('gate');
  await clickCell(page, 20, 16);
  await pickTool(page, 'select');
  const stone = await byName(page, 'Sentence stone');
  const gate = await byName(page, 'Gate');
  await clickEntity(page, stone);
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  await expect(page.getByTestId('behavior-sentenceStone')).toContainText('swappable word');
  expect(await page.evaluate((id) => (window.__store!.doc!.getEntity(id)!.components.sentenceStone as { words: string }).words, stone)).toBe('breaks, holds');
  await pickTool(page, 'wire');
  await dragEntities(page, stone, gate);
  await page.getByTestId('connect-output').selectOption('word2'); // "HOLDS"
  await page.getByTestId('connect-ok').click();
  await pickTool(page, 'select');
  expect(await page.evaluate(() => window.__store!.doc!.wires.map((w) => `${w.from.output}->${w.to.input}`))).toEqual(['word2->open']);

  // a stone with only one word is explained
  await clickEntity(page, stone);
  const words = page.getByTestId('behavior-sentenceStone').getByTestId('bf-words');
  await words.fill('breaks');
  await words.press('Enter');
  await expect(page.getByTestId('problem-count')).not.toHaveText('No problems');
  await words.fill('breaks, holds');
  await words.press('Enter');
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- a two-cell pit with a text block over it ----
  await pickTool(page, 'pit');
  await clickCell(page, 20, 12);
  await clickCell(page, 21, 12);
  expect((await cellInfo(page, 20, 12)).flags).toBeGreaterThan(0);
  expect((await cellInfo(page, 21, 12)).flags).toBeGreaterThan(0);
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption('text');
  await clickCell(page, 20, 12);
  await pickTool(page, 'select');
  const block = await byName(page, 'Text block');
  await clickEntity(page, block);
  const x = page.getByTestId('insp-x');
  await x.fill('21');
  await x.press('Enter');
  expect(await page.evaluate((id) => (window.__store!.doc!.getEntity(id)!.components.transform as { x: number }).x, block)).toBe(21);
  await expect(page.getByTestId('behavior-textBlock')).toContainText('underlined text becomes a flat bridge');
  await page.keyboard.press('Control+s');

  // ---- play ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, {}, 5);
  let st = await info(page);
  expect(st.stone).toBe('The bridge [ BREAKS ]');
  expect(st.gateOpen).toBe(false);
  await play(page, { interact: 1 }, 1); // E next to the stone: swap the word
  await play(page, {}, 60);
  st = await info(page);
  expect(st.stone).toBe('The bridge [ HOLDS ]');
  expect(st.gateOpen).toBe(true); // "HOLDS" is wired to the gate

  // walk up to the text block and underline it with E
  await play(page, GRID_MINUS_Y, 60);
  await play(page, GRID_PLUS_X, 50); // to about 1.2 cells from the block
  await play(page, {}, 5);
  expect((await info(page)).block).toMatchObject({ underline: false, bold: false, italic: false });
  await play(page, { interact: 1 }, 1);
  await play(page, {}, 5);
  expect((await info(page)).block.underline).toBe(true);
  await page.screenshot({ path: shot('m6-words-before-bridge.png') });
  await play(page, GRID_PLUS_X, 90); // cross the pit on the bridge
  st = await info(page);
  expect(st.player.x).toBeGreaterThan(22.5);
  expect(st.player.h).toBeGreaterThan(-0.5);
  await page.screenshot({ path: shot('m6-words-crossed.png') });
  await page.getByTestId('btn-stop').click();

  expect(errors).toEqual([]);
  await app.close();
});
