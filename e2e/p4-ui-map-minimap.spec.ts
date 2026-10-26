import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { ASPECTS, add, fitGame, noBrowserControls, outline, setText } from './ui-helpers';

/**
 * Add-on, section 1 (maps), example (b), built in the UI designer only: a corner minimap that turns with the camera and shows enemies
 * as dots. The dot is the designer's own UI prefab; nothing about the look or the rule is built into the engine.
 */
test('Add-on: a corner minimap that rotates with the camera and shows enemy dots', async () => {
  test.setTimeout(300_000);
  const { page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Minimap', 'empty');
  await page.getByTestId('btn-ws-ui').click();

  // ---- a red dot, as a UI prefab ----
  await page.getByTestId('ui-new-screen-name').fill('Parts');
  await page.getByTestId('ui-new-screen').click();
  await add(page, 'panel');
  await setText(page, 'ui-name', 'Red dot');
  await setText(page, 'ui-w', '9');
  await setText(page, 'ui-h', '9');
  await page.getByTestId('ui-st-normal-fill').fill('#e05a5a');
  await page.getByTestId('ui-st-normal-radius').fill('9');
  await page.getByTestId('ui-st-normal-radius').press('Enter');
  await page.getByTestId('ui-prefab-name').fill('Red dot');
  await page.getByTestId('ui-prefab-make').click();
  await expect(page.getByTestId('ui-prefab-Red dot')).toBeVisible();

  // ---- the minimap screen: a heads-up display with a Map widget in the corner ----
  await page.getByTestId('ui-new-screen-name').fill('Minimap HUD');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-start').check();
  await add(page, 'map');
  await setText(page, 'ui-name', 'Minimap');
  await page.getByTestId('ui-anchor-tr').click();
  await setText(page, 'ui-w', '200');
  await setText(page, 'ui-h', '200');
  await setText(page, 'ui-x', '-12');
  await setText(page, 'ui-y', '12');
  await page.getByTestId('ui-map-turn').selectOption('camera');
  await setText(page, 'ui-map-cell', '6');
  await setText(page, 'ui-map-zoom', '2');
  // enemies: a second kind of marker, from objects tagged enemy, drawn with the red dot
  await page.getByTestId('ui-map-marker-add').click();
  await page.getByTestId('ui-map-marker-1-toggle').click();
  await page.getByTestId('ui-map-marker-1-from').selectOption('tags');
  await setText(page, 'ui-map-marker-1-source', 'enemy');
  await page.getByTestId('ui-map-marker-1-prefab').selectOption('Red dot');
  await setText(page, 'ui-map-marker-1-id', 'enemies');
  // the player marker: the style of the starting kit, and the map follows the player
  await setText(page, 'ui-map-centre', 'follow:player');
  await page.getByTestId('ui-map-marker-0-toggle').click();
  await page.getByTestId('ui-map-marker-0-prefab').selectOption('');
  await outline(page, 'Minimap').click();
  const doc = await page.evaluate(() => window.__store!.uiDoc);
  const mini = doc.screens.find((s) => s.name === 'Minimap HUD')!.root.children[0]!;
  expect(mini.map).toMatchObject({ view: { turn: 'camera', cell: 6, zoom: 2, centre: 'follow:player' }, markers: [{ id: 'player' }, { id: 'enemies', from: 'tags', source: 'enemy', prefab: 'Red dot' }] });
  await expect(page.getByTestId('ui-problems')).toContainText('No problems');

  // ---- play ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.evaluate(() => {
    const sim = window.__play!.sim;
    const p = sim.world.withTag('player')[0] ?? sim.world.spawn({ name: 'Hero', tags: ['player'], components: { transform: { x: 16, y: 16, h: 0 } } });
    const t = p.get<{ x: number; y: number; h: number }>('transform')!;
    for (const [dx, dy, name] of [[6, 0, 'Wolf'], [-3, -5, 'Bat']] as const) sim.world.spawn({ name, tags: ['enemy'], components: { transform: { x: t.x + dx, y: t.y + dy, h: 0 } } });
  });
  await expect(page.getByTestId('tw-ui-Minimap')).toBeVisible();
  await expect(page.locator('[data-testid="tw-ui-Minimap"] [data-name="Red dot"]')).toHaveCount(2);
  await page.waitForTimeout(500);

  /** The first enemy dot as an offset from the player's marker (pixels), and the terrain picture's signature. */
  const read = async (): Promise<{ dx: number; dy: number; sig: string }> =>
    page.evaluate(() => {
      const mini = document.querySelector('[data-testid="tw-ui-Minimap"]')!;
      const centre = (e: Element): { x: number; y: number } => {
        const r = e.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const dots = [...mini.querySelectorAll('[data-name="Red dot"]')].sort((a, b) => ((a as HTMLElement).dataset.id ?? '').localeCompare((b as HTMLElement).dataset.id ?? '')).map(centre);
      const player = [...mini.querySelectorAll('.tw-part')].filter((e) => (e as HTMLElement).dataset.name !== 'Red dot').map(centre).find((c) => Math.abs(c.x - (mini.getBoundingClientRect().left + mini.getBoundingClientRect().width / 2)) < 3);
      const canvas = mini.querySelector<HTMLCanvasElement>('canvas.tw-map-layer')!;
      return { dx: dots[0]!.x - (player?.x ?? 0), dy: dots[0]!.y - (player?.y ?? 0), sig: canvas.dataset.sig ?? '' };
    });
  const before = await read();
  expect(Math.hypot(before.dx, before.dy)).toBeGreaterThan(20);
  await page.screenshot({ path: shot('p4-minimap-turn0.png') });
  const turn = async (n: number): Promise<void> => {
    await page.evaluate((r) => (window.__play!.sim.runtime.view.rotation = r as 0 | 1 | 2 | 3), n);
    await page.waitForTimeout(450);
  };
  await turn(1);
  const quarter = await read();
  // a quarter turn: the same distance, at a right angle to where it was
  expect(Math.hypot(quarter.dx, quarter.dy)).toBeCloseTo(Math.hypot(before.dx, before.dy), 0);
  expect(Math.abs(before.dx * quarter.dx + before.dy * quarter.dy)).toBeLessThan(0.1 * (before.dx ** 2 + before.dy ** 2));
  expect(quarter.sig).not.toBe(before.sig); // the terrain was painted again, turned
  await page.screenshot({ path: shot('p4-minimap-turn1.png') });
  await turn(2);
  const half = await read();
  expect(half.dx).toBeCloseTo(-before.dx, 0);
  expect(half.dy).toBeCloseTo(-before.dy, 0);
  await turn(0);
  // the enemies move, the dots follow; one is defeated, its dot goes
  await page.evaluate(() => {
    const sim = window.__play!.sim;
    const wolf = sim.world.findByName('Wolf')!;
    wolf.set('transform', { x: 10, y: 10, h: 0 });
    sim.world.destroy(sim.world.findByName('Bat')!);
  });
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="tw-ui-Minimap"] [data-name="Red dot"]')).toHaveCount(1);

  for (const shape of ASPECTS) {
    await fitGame(page, shape.w, shape.h);
    const box = await page.getByTestId('tw-ui-Minimap').boundingBox();
    const ui = await page.getByTestId('tw-ui').boundingBox();
    expect(box!.x + box!.width, `${shape.id}: in the top right corner`).toBeLessThanOrEqual(ui!.x + ui!.width + 1);
    expect(box!.x, `${shape.id}`).toBeGreaterThan(ui!.x + ui!.width - 260);
    await page.screenshot({ path: shot(`p4-minimap-${shape.id.replace(':', 'x')}.png`) });
  }
  await noBrowserControls(page);
  expect(errors).toEqual([]);
});
