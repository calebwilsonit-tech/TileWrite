import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { add, fakePad, noBrowserControls, outline, padTap, setText } from './ui-helpers';

/**
 * Add-on, section 1 (maps), the examples besides the Storytender map and the minimap, each built in the UI designer only: a strategy
 * overview with fog of war and units to click, a hand-drawn world picture with pins from a table, and a dungeon map that fills in
 * room by room (and is kept in the save).
 */
const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });
const px = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([a, b]) => window.__studioPx!(a!, b!), [x, y]);

test('Add-on: a strategy overview: fog of war, enemies seen only in sight, units to click and to page through with a pad', async () => {
  test.setTimeout(300_000);
  const { page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Overview', 'empty');
  await page.getByTestId('btn-ws-ui').click();

  // two dots: a green one for our units, a red one for theirs
  await page.getByTestId('ui-new-screen-name').fill('Parts');
  await page.getByTestId('ui-new-screen').click();
  for (const [name, colour] of [['Green dot', '#4fe07a'], ['Red dot', '#e05a5a']] as const) {
    await add(page, 'panel');
    await setText(page, 'ui-name', name);
    await setText(page, 'ui-w', '10');
    await setText(page, 'ui-h', '10');
    await page.getByTestId('ui-st-normal-fill').fill(colour);
    await setText(page, 'ui-st-normal-radius', '10');
    await page.getByTestId('ui-prefab-name').fill(name);
    await page.getByTestId('ui-prefab-make').click();
    await page.getByTestId('ui-screen-Parts').click();
  }

  await page.getByTestId('ui-new-screen-name').fill('Overview');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-modal').check();
  await add(page, 'map');
  await setText(page, 'ui-name', 'Battlefield');
  await page.getByTestId('ui-anchor-c').click();
  await setText(page, 'ui-w', '480');
  await setText(page, 'ui-h', '360');
  await setText(page, 'ui-map-cell', '10');
  await setText(page, 'ui-map-bind', 'bf');
  // layers: the ground, what has been explored (stays dim), what is in sight now (clear), the markers on top
  await page.getByTestId('ui-map-layer-new-kind').selectOption('fog');
  await page.getByTestId('ui-map-layer-add').click();
  await page.getByTestId('ui-map-layer-new-kind').selectOption('fog');
  await page.getByTestId('ui-map-layer-add').click();
  await page.getByTestId('ui-map-layer-1').getByRole('button', { name: 'Move forward' }).click(); // markers last
  await page.getByTestId('ui-map-layer-2').getByRole('button', { name: 'Move forward' }).click();
  const before = await page.evaluate(() => window.__store!.uiDoc);
  const spec = before.screens.find((s) => s.name === 'Overview')!.root.children[0]!.map!;
  expect(spec.layers.map((l) => l.kind)).toEqual(['terrain', 'fog', 'fog', 'markers']);
  const [explored, sight] = [spec.layers[1]!.id, spec.layers[2]!.id];
  await page.getByTestId('ui-map-layer-1-toggle').click();
  await page.getByTestId('ui-map-layer-1-reveal').selectOption('visited');
  await setText(page, 'ui-map-layer-1-follow', 'unit');
  await setText(page, 'ui-map-layer-1-radius', '6');
  await page.getByTestId('ui-map-layer-1-look').selectOption('dim');
  await page.getByTestId('ui-map-layer-1-toggle').click();
  await page.getByTestId('ui-map-layer-2-toggle').click();
  await page.getByTestId('ui-map-layer-2-reveal').selectOption('sight');
  await setText(page, 'ui-map-layer-2-follow', 'unit');
  await setText(page, 'ui-map-layer-2-radius', '5');
  await page.getByTestId('ui-map-layer-2-remember').uncheck();
  await page.getByTestId('ui-map-layer-2-look').selectOption('dim');
  await setText(page, 'ui-map-layer-2-dimAmount', '0.5');
  await page.getByTestId('ui-map-layer-2-toggle').click();
  // our units are green dots you can choose; theirs are red dots, seen only while in sight
  await page.getByTestId('ui-map-marker-0-toggle').click();
  await setText(page, 'ui-map-marker-0-id', 'units');
  await page.getByTestId('ui-map-marker-0-from').selectOption('tags');
  await setText(page, 'ui-map-marker-0-source', 'unit');
  await page.getByTestId('ui-map-marker-0-prefab').selectOption('Green dot');
  await page.getByTestId('ui-map-marker-0-toggle').click();
  await page.getByTestId('ui-map-marker-add').click();
  await page.getByTestId('ui-map-marker-1-toggle').click();
  await setText(page, 'ui-map-marker-1-id', 'foes');
  await page.getByTestId('ui-map-marker-1-from').selectOption('tags');
  await setText(page, 'ui-map-marker-1-source', 'enemy');
  await page.getByTestId('ui-map-marker-1-prefab').selectOption('Red dot');
  await setText(page, 'ui-map-marker-1-show', `{marker.revealed.${sight}} = 1`);
  await page.getByTestId('ui-map-marker-1-choosable').uncheck();
  await page.getByTestId('ui-map-on-choose-add').selectOption('setVariable');
  await setText(page, 'ui-map-on-choose-p0-name', 'selected');
  await setText(page, 'ui-map-on-choose-p0-value', '{marker.label}');
  await expect(page.getByTestId('ui-problems')).toContainText('No problems');
  void explored;

  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.evaluate(() => {
    const sim = window.__play!.sim;
    for (const [name, x, y] of [['Archer', 8, 8], ['Knight', 11, 8]] as const) sim.world.spawn({ name, tags: ['unit'], components: { transform: { x, y, h: 0 } } });
    for (const [name, x, y] of [['Wolf', 13, 9], ['Troll', 26, 24]] as const) sim.world.spawn({ name, tags: ['enemy'], components: { transform: { x, y, h: 0 } } });
    sim.runtime.ui.stack.push('Overview');
  });
  await fakePad(page);
  await expect(page.getByTestId('tw-ui-Battlefield')).toBeVisible();
  await page.waitForTimeout(700);
  const dots = (name: string): Promise<number> => page.locator(`[data-testid="tw-ui-Battlefield"] [data-name="${name}"]`).count();
  expect(await dots('Green dot')).toBe(2);
  expect(await dots('Red dot'), 'the wolf is in sight; the troll is far away in the fog').toBe(1);
  await page.screenshot({ path: shot('p4-strategy-overview.png') });
  // a unit walks toward the troll: it comes into sight, and the ground it passed stays dim, not black
  await page.evaluate(() => window.__play!.sim.world.findByName('Knight')!.set('transform', { x: 23, y: 22, h: 0 }));
  await page.waitForTimeout(500);
  expect(await dots('Red dot')).toBe(2);
  // clicking a unit chooses it; the pad pages from unit to unit
  await page.locator('[data-testid="tw-ui-Battlefield"] [data-name="Green dot"]').first().click();
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars.selected)).toMatch(/Archer|Knight/);
  const first = String(await page.evaluate(() => window.__play!.sim.runtime.vars.selected));
  await padTap(page, 5); // the right shoulder button: the next marker
  await padTap(page, 0); // A
  const second = String(await page.evaluate(() => window.__play!.sim.runtime.vars.selected));
  expect(second).not.toBe(first);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars['bf.count'])).toBe(2); // only the units can be chosen
  await page.screenshot({ path: shot('p4-strategy-overview-2.png') });
  await noBrowserControls(page);
  expect(errors).toEqual([]);
});

test('Add-on: a hand-drawn world picture with pins placed by a table', async () => {
  test.setTimeout(300_000);
  const { page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Pins', 'empty');

  // ---- the picture: a sprite made in the sprite studio ----
  await page.getByTestId('btn-ws-sprites').click();
  await page.getByTestId('sprite-new').click();
  await page.getByTestId('new-sprite-name').fill('world');
  await page.getByTestId('new-sprite-w').fill('64');
  await page.getByTestId('new-sprite-h').fill('40');
  await page.getByTestId('new-sprite-ok').click();
  await expect(page.getByTestId('studio-title')).toHaveText('world');
  await page.waitForTimeout(200);
  await page.getByTestId('stool-fill').click();
  await page.getByTestId('swatch-3').click();
  const p = await px(page, 10, 10);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(400);

  // ---- the pins: a table with where each is on the picture (a thousand wide, six hundred tall) ----
  await page.getByTestId('btn-ws-world').click();
  await tab(page, 'Data').click();
  await page.getByTestId('table-new-name').fill('Pins');
  await page.getByTestId('table-new-create').click();
  for (const col of ['x', 'y']) {
    await page.getByTestId('col-add-id').fill(col);
    await page.getByTestId('col-add-type').selectOption('number');
    await page.getByTestId('col-add').click();
  }
  for (const [id, name, x, y] of [['inn', 'The Inn', '200', '150'], ['mill', 'The Mill', '700', '300'], ['keep', 'The Keep', '450', '500']] as const) {
    await page.getByTestId('row-add').click();
    const rows = await page.evaluate(() => window.__store!.tables.find((t) => t.name === 'Pins')!.rows.length);
    const rowId = `row${rows}`;
    await page.getByTestId(`cell-${rowId}-id`).fill(id);
    await page.getByTestId(`cell-${rowId}-id`).press('Enter');
    for (const [col, v] of [['name', name], ['x', x], ['y', y]] as const) {
      const cell = page.getByTestId(`cell-${id}-${col}`);
      await cell.fill(v);
      await cell.press('Enter');
    }
  }

  // ---- the screen: a map of nothing but the picture, with the pins on it ----
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-new-screen-name').fill('Pinned');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-modal').check();
  await add(page, 'map');
  await setText(page, 'ui-name', 'Drawing');
  await page.getByTestId('ui-anchor-c').click();
  await setText(page, 'ui-w', '600');
  await setText(page, 'ui-h', '360');
  await page.getByTestId('ui-map-source').selectOption('none');
  await setText(page, 'ui-map-width', '1000');
  await setText(page, 'ui-map-height', '600');
  await page.getByTestId('ui-map-projection').selectOption('picture');
  await setText(page, 'ui-map-cell', '1');
  await page.getByTestId('ui-map-layer-0-delete').click(); // no terrain: the picture is the map
  await page.getByTestId('ui-map-layer-new-kind').selectOption('picture');
  await page.getByTestId('ui-map-layer-add').click();
  await page.getByTestId('ui-map-layer-1').getByRole('button', { name: 'Move forward' }).count();
  await page.getByTestId('ui-map-layer-0').getByRole('button', { name: 'Move forward' }).click(); // the picture goes behind the markers
  await page.getByTestId('ui-map-layer-0-toggle').click();
  await page.getByTestId('ui-map-layer-0-picture').selectOption('world');
  await page.getByTestId('ui-map-layer-0-fit').selectOption('stretch');
  await page.getByTestId('ui-map-layer-0-toggle').click();
  await page.getByTestId('ui-map-marker-0-toggle').click();
  await setText(page, 'ui-map-marker-0-id', 'pins');
  await page.getByTestId('ui-map-marker-0-from').selectOption('table');
  await setText(page, 'ui-map-marker-0-source', 'Pins');
  await expect(page.getByTestId('ui-problems')).toContainText('No problems');

  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.evaluate(() => window.__play!.sim.runtime.ui.stack.push('Pinned'));
  await expect(page.getByTestId('tw-ui-Drawing')).toBeVisible();
  await page.waitForTimeout(800);
  const where = await page.evaluate(() => {
    const map = document.querySelector('[data-testid="tw-ui-Drawing"]')!.getBoundingClientRect();
    return [...document.querySelectorAll('[data-testid="tw-ui-Drawing"] .tw-part')].map((e) => {
      const r = e.getBoundingClientRect();
      return { fx: (r.left + r.width / 2 - map.left) / map.width, fy: (r.top + r.height / 2 - map.top) / map.height };
    });
  });
  expect(where).toHaveLength(3);
  // pins stand where the table says, as a share of the picture (the picture fits the window, so the shares match)
  const shares = where.map((w) => [Math.round(w.fx * 10) / 10, Math.round(w.fy * 10) / 10]).sort();
  expect(shares).toEqual([[0.2, 0.3], [0.5, 0.8], [0.7, 0.5]].sort()); // (the inn at 200,150 of 1000,600 ... the keep at 450,500: rounded to a tenth)
  const painted = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="tw-ui-Drawing"] canvas.tw-map-layer')!;
    return c.getContext('2d')!.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data[3];
  });
  expect(painted, 'the picture is painted behind the pins').toBeGreaterThan(0);
  await page.screenshot({ path: shot('p4-pins-picture.png') });
  await noBrowserControls(page);
  expect(errors).toEqual([]);
});

test('Add-on: a dungeon map that fills in room by room, and is kept in the save', async () => {
  test.setTimeout(300_000);
  const { page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Dungeon', 'empty');
  // three rooms are regions of the scene (the Regions tool of the world editor), made here as the editor would make them
  await page.evaluate(() => {
    const doc = window.__store!.doc!;
    for (const [id, name, x, y, w, h] of [['r1', 'Entry', 2, 2, 8, 6], ['r2', 'Armoury', 12, 2, 8, 6], ['r3', 'Vault', 12, 12, 8, 8]] as const) doc.regions.push({ id, name, x, y, w, h, cameraBounds: false, music: '', darkness: 0, bossActive: false });
  });
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-new-screen-name').fill('Dungeon map');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-modal').check();
  await add(page, 'map');
  await setText(page, 'ui-name', 'Rooms');
  await page.getByTestId('ui-anchor-c').click();
  await setText(page, 'ui-w', '420');
  await setText(page, 'ui-h', '420');
  await setText(page, 'ui-map-cell', '10');
  await page.getByTestId('ui-map-layer-new-kind').selectOption('fog');
  await page.getByTestId('ui-map-layer-add').click();
  await page.getByTestId('ui-map-layer-new-kind').selectOption('regions');
  await page.getByTestId('ui-map-layer-add').click();
  await page.getByTestId('ui-map-layer-1').getByRole('button', { name: 'Move forward' }).click();
  await page.getByTestId('ui-map-layer-2').getByRole('button', { name: 'Move forward' }).click();
  await page.getByTestId('ui-map-layer-1-toggle').click();
  await page.getByTestId('ui-map-layer-1-reveal').selectOption('regions');
  await setText(page, 'ui-map-layer-1-follow', 'player');
  await page.getByTestId('ui-map-layer-1-colour').fill('#05060a');
  await page.getByTestId('ui-map-layer-1-colour').press('Enter');
  await page.getByTestId('ui-map-layer-1-saved').check();
  await page.getByTestId('ui-map-layer-1-toggle').click();
  const doc = await page.evaluate(() => window.__store!.uiDoc);
  const kinds = doc.screens.find((s) => s.name === 'Dungeon map')!.root.children[0]!.map!.layers.map((l) => l.kind);
  expect(kinds).toEqual(['terrain', 'fog', 'regions', 'markers']);
  await expect(page.getByTestId('ui-problems')).toContainText('No problems');

  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.evaluate(() => {
    const sim = window.__play!.sim;
    const hero = sim.world.withTag('player')[0] ?? sim.world.spawn({ name: 'Hero', tags: ['player'], components: { transform: { x: 5, y: 4, h: 0 } } });
    hero.set('transform', { x: 5, y: 4, h: 0 });
    sim.runtime.ui.stack.push('Dungeon map');
  });
  await expect(page.getByTestId('tw-ui-Rooms')).toBeVisible();
  await page.waitForTimeout(600);
  /** How many cells of the map are known (the fog layer's cells). */
  const known = (): Promise<number> =>
    page.evaluate(() => {
      const live = [...(window.__play!.sim.runtime.scratch.get('ui.mapsLive') as Map<string, { info: { layers: { kind: string; data: { draw?: { cells: Uint8Array } } }[] } }>).values()][0]!;
      const fog = live.info.layers.find((l) => l.kind === 'fog')!;
      return fog.data.draw!.cells.reduce((s, c) => s + c, 0);
    });
  expect(await known()).toBe(48); // the Entry: 8 by 6
  await page.screenshot({ path: shot('p4-dungeon-1.png') });
  await page.evaluate(() => window.__play!.sim.world.withTag('player')[0]!.set('transform', { x: 15, y: 4, h: 0 }));
  await page.waitForTimeout(400);
  expect(await known()).toBe(96); // and the Armoury
  await page.evaluate(() => window.__play!.sim.world.withTag('player')[0]!.set('transform', { x: 30, y: 30, h: 0 })); // out in the corridors: nothing new
  await page.waitForTimeout(400);
  expect(await known()).toBe(96);
  await page.screenshot({ path: shot('p4-dungeon-2.png') });
  // a saved game remembers the rooms; a new game does not
  await page.evaluate(() => (window.__play!.sim.tick = 30));
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => Object.keys(window.__play!.sim.runtime.vars).filter((k) => k.includes('.fog.')));
  expect(saved.length).toBe(1);
  await noBrowserControls(page);
  expect(errors).toEqual([]);
});
