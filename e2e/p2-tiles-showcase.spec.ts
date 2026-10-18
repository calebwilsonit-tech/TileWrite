import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Hub, MemoryStore, createHubServer } from '../packages/hub-server/src';
import { buildCredits, creditsOf } from '../packages/exporter/src';
import { clickCell, createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';
import { loadSampleGame, saveSample, selectObject, setText, tab, where } from './sample-helpers';

async function fill(page: Page, swatch: number): Promise<void> {
  await page.getByTestId(`swatch-${swatch}`).click();
  await page.getByTestId('stool-fill').click();
  const box = await page.getByTestId('studio-canvas').boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

/** Make a tile sprite from a preset, fill it, clip it to the diamond when it is a floor, and save it. */
async function drawn(page: Page, preset: string, name: string, swatch: number, clip = false): Promise<void> {
  await page.getByTestId('ts-preset').selectOption(preset);
  await page.getByTestId('ts-name').fill(name);
  await page.getByTestId('ts-create').click();
  await expect(page.getByTestId('studio-title')).toContainText(name);
  await fill(page, swatch);
  if (clip) await page.getByTestId('ts-clip').click();
  await page.getByTestId('studio-save').click();
}

/** Save things to the personal library from the Library panel. */
async function toLibrary(page: Page, kind: string, pick: string[], name: string, o: { licence: string; tags: string }): Promise<void> {
  await tab(page, 'Library').click();
  await page.getByTestId('library-save-kind').selectOption(kind);
  for (const p of pick) await page.getByTestId(`library-pick-${p}`).check();
  await page.getByTestId('library-save-name').fill(name);
  await page.getByTestId('library-save-tags').fill(o.tags);
  await page.getByTestId('library-save-licence').selectOption(o.licence);
  await page.getByTestId('library-save-author').fill('Ada');
  await page.getByTestId('library-save-go').click();
  await expect(page.getByTestId('library-save-message')).toContainText('version 1');
}

/**
 * Sample 8 of Phase 2: tiles and props. Project one draws a grass set with edge pieces, a two-level cliff with stairs, animated water
 * with a shore, a snow recolour, a tall tree whose canopy fades, and a window and a guitar for walls; everything goes to the personal
 * library and part of it to a (local) hub under licences. Project two is a house built from those, with different blocks at each
 * height, an arch and scattered trees; the bot walks through the arch and behind the trees. Project three takes a set from the hub and
 * ends with a credits file for the author.
 */
test('Phase 2 sample: tiles and props - sets, cliffs, water, snow, a tree, wall attachments, the library, a house, and the hub', async () => {
  test.setTimeout(900_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-showcase-'));
  const hub = createHubServer(new Hub(new MemoryStore(), { adminToken: 'd'.repeat(32) }));
  await new Promise<void>((r) => hub.listen(0, '127.0.0.1', r));
  const hubAddress = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`;
  const { page, app, errors } = await launchEditor(undefined, { TILEWRIGHT_LIBRARY: path.join(tmp, 'library'), TILEWRIGHT_TEST_SAVE: path.join(tmp, 'out') });

  // =========================== project one: the artist's project ===========================
  await createProjectViaUi(page, 'Tile Showcase', 'empty-iso');
  await page.getByTestId('btn-ws-sprites').click();
  await page.getByTestId('studio-mode-tile').click();

  // ---- grass, with the 47 edge pieces ----
  await drawn(page, 'flat', 'grass', 6, true);
  await page.getByTestId('ts-tile-name').fill('Meadow grass');
  await page.getByTestId('ts-tile-name').press('Enter');
  await page.getByTestId('ts-send').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.tileset.find((t) => t.name === 'Meadow grass')?.art)).toBe('grass');
  await page.getByTestId('ts-sec-autotile').locator('summary').click();
  await page.getByTestId('ts-set-name').fill('grass');
  await page.getByTestId('ts-set-name').press('Enter');
  await page.getByTestId('ts-set-base').selectOption({ label: 'Meadow grass' });
  await page.getByTestId('ts-set-create').click();
  await expect(page.getByTestId('ts-set-missing')).toContainText('47 of 47', { timeout: 60_000 });
  await page.getByTestId('ts-set-starter').click();
  await expect(page.getByTestId('ts-set-missing')).toContainText('Every piece is drawn', { timeout: 60_000 });
  await page.getByTestId('ts-set-apply').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.autotile.length)).toBe(46);

  // ---- a cliff: a block of rock with its own side pictures (two levels tall) ----
  await drawn(page, 'wall-left-2', 'rockL', 4);
  await drawn(page, 'wall-right-2', 'rockR', 5);
  await drawn(page, 'block', 'rock', 3);
  await page.getByTestId('ts-tile-name').fill('Cliff rock');
  await page.getByTestId('ts-tile-name').press('Enter');
  await page.getByTestId('ts-left-art').selectOption('rockL');
  await page.getByTestId('ts-right-art').selectOption('rockR');
  await page.getByTestId('ts-send').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.tileset.find((t) => t.name === 'Cliff rock')?.leftArt)).toBe('rockL');

  // ---- water that moves, with a shore ----
  await drawn(page, 'flat', 'water', 8, true);
  await page.getByTestId('frame-add').click();
  await fill(page, 1);
  await page.getByTestId('ts-clip').click();
  await page.waitForTimeout(500);
  await page.getByTestId('studio-save').click();
  expect(await page.evaluate(() => window.__studio!.assets.get('water')!.frames.length)).toBe(2); // clipping keeps every frame
  await page.getByTestId('ts-tile-name').fill('Lake water');
  await page.getByTestId('ts-tile-name').press('Enter');
  await page.getByTestId('ts-animate').check();
  await page.getByTestId('ts-fps').fill('3');
  await page.getByTestId('ts-fps').press('Enter');
  await page.getByTestId('ts-water').check();
  await page.getByTestId('ts-send').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.tileset.find((t) => t.name === 'Lake water')?.anim?.frames.length)).toBe(2);
  if (!(await page.getByTestId('ts-set-name').isVisible())) await page.getByTestId('ts-sec-autotile').locator('summary').click();
  await page.getByTestId('ts-set-name').fill('shore');
  await page.getByTestId('ts-set-name').press('Enter');
  await page.getByTestId('ts-set-base').selectOption({ label: 'Lake water' });
  await page.getByTestId('ts-set-create').click();
  await expect(page.getByTestId('ts-set-missing')).toContainText('47 of 47', { timeout: 60_000 });
  await page.getByTestId('ts-set-starter').click();
  await expect(page.getByTestId('ts-set-missing')).toContainText('Every piece is drawn', { timeout: 60_000 });
  await page.getByTestId('ts-set-apply').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.autotile.length)).toBe(92);

  // ---- snow: every tile with a picture, recoloured as new tiles ----
  await page.getByTestId('ts-sec-palette').locator('summary').click();
  await page.getByTestId('ts-recolour-preset').selectOption('snow');
  await page.getByTestId('ts-recolour-set').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.tileset.filter((t) => t.name.endsWith(' snow')).map((t) => t.name).sort())).toEqual(['Cliff rock snow', 'Lake water snow', 'Meadow grass snow']);
  const snowArt = await page.evaluate(() => window.__studio!.assets.get('grass_snow')!.palette.join());
  const grassArt = await page.evaluate(() => window.__studio!.assets.get('grass')!.palette.join());
  expect(snowArt).not.toBe(grassArt);

  // ---- a tree with a canopy that fades, a window with its other side, and a guitar ----
  await page.getByTestId('ts-preset').selectOption('tree');
  await page.getByTestId('ts-name').fill('oak');
  await page.getByTestId('ts-create').click();
  await fill(page, 6);
  await page.getByTestId('ts-sec-prop').locator('summary').click();
  await page.getByTestId('ts-col-trunk').click();
  await page.getByTestId('ts-fade-canopy').click();
  await page.getByTestId('studio-save').click();
  await drawn(page, 'attach-left', 'window', 8);
  await page.getByTestId('ts-sec-attach').locator('summary').click();
  await page.getByTestId('ts-other-side').click();
  await expect.poll(() => page.evaluate(() => window.__studio!.assets.has('window_right'))).toBe(true);
  await page.getByTestId('studio-save').click();
  await drawn(page, 'attach-left', 'guitar', 7);
  expect(await page.evaluate(() => window.__studio!.assets.get('oak')!.meta!.fade)).not.toBeNull();

  // ---- paint a little of each in the world: the grass, a lake with a shore, a cliff of two levels ----
  await page.getByTestId('btn-ws-world').click();
  await tab(page, 'Tiles').click();
  await page.getByTestId('tile-Meadow grass').click();
  await pickTool(page, 'rect');
  await dragCells(page, [4, 4], [14, 12]);
  await page.getByTestId('tile-Lake water').click();
  await dragCells(page, [6, 6], [9, 9]);
  await page.getByTestId('tile-Cliff rock').click();
  await pickTool(page, 'cliff');
  await page.getByTestId('opt-height').fill('2');
  await dragCells(page, [11, 5], [13, 8]);
  expect(await page.evaluate(() => window.__store!.doc!.map.getHeight(12, 6))).toBe(2);
  expect(await page.evaluate(() => window.__store!.doc!.map.getTile(12, 6))).toBe(await page.evaluate(() => window.__store!.state.project!.project.tileset.find((t) => t.name === 'Cliff rock')!.id));
  await pickTool(page, 'stairs');
  await clickCell(page, 12, 9);
  await page.screenshot({ path: shot('p2-showcase-world.png') });

  // =========================== the personal library ===========================
  await toLibrary(page, 'tileset', ['Meadow grass'], 'Meadow', { licence: 'CC-BY-4.0', tags: 'grass, outdoors' });
  await toLibrary(page, 'tileset', ['Meadow grass snow'], 'Winter', { licence: 'CC0-1.0', tags: 'snow' });
  await toLibrary(page, 'prop', ['oak'], 'Oak tree', { licence: 'CC0-1.0', tags: 'tree' });
  await toLibrary(page, 'attachment', ['window'], 'Window', { licence: 'CC-BY-4.0', tags: 'wall' });
  await toLibrary(page, 'attachment', ['guitar'], 'Guitar', { licence: 'CC0-1.0', tags: 'wall, music' });
  await expect(page.getByTestId('library-grid')).toContainText('Meadow');
  // the grass set brought its 46 edge pieces and rules, and the window its other side
  const lib = JSON.parse(fs.readFileSync(path.join(tmp, 'library', 'packs', 'meadow', 'v1.pack.json'), 'utf8')) as { tiles: unknown[]; autotile: unknown[]; files: { path: string }[] };
  expect(lib.tiles).toHaveLength(47);
  expect(lib.autotile).toHaveLength(46);
  const win = JSON.parse(fs.readFileSync(path.join(tmp, 'library', 'packs', 'window', 'v1.pack.json'), 'utf8')) as { files: { path: string }[] };
  expect(win.files.map((f) => f.path).sort()).toEqual(['assets/sprites/window.sprite.json', 'assets/sprites/window_right.sprite.json']);

  // =========================== to the hub ===========================
  await tab(page, 'Hub').click();
  await page.getByTestId('hub-address').fill(hubAddress);
  await page.getByTestId('hub-connect').click();
  await expect(page.getByTestId('hub-status')).toContainText('Connected to Tilewright Asset Hub');
  await page.getByTestId('hub-name').fill('Ada');
  await page.getByTestId('hub-password').fill('correct horse');
  await page.getByTestId('hub-signup').click();
  await expect(page.getByTestId('hub-user')).toContainText('Ada');
  for (const item of ['Meadow - Tileset', 'Oak tree - Tall prop']) {
    await page.getByTestId('hub-publish-item').selectOption({ label: item });
    await page.getByTestId('hub-notes').fill('first version');
    await page.getByTestId('hub-publish').click();
    await expect(page.getByTestId('hub-status')).toContainText('is now on the hub');
  }
  await expect(page.getByTestId('hub-mine')).toContainText('Meadow v1 - on the hub');
  await page.evaluate(() => window.__store!.save());
  await app.close();

  // =========================== project two: a house, built from the library ===========================
  const second = await launchEditor(undefined, { TILEWRIGHT_LIBRARY: path.join(tmp, 'library'), TILEWRIGHT_TEST_SAVE: path.join(tmp, 'out') });
  const p2 = second.page;
  await createProjectViaUi(p2, 'The House', 'empty-iso');
  await tab(p2, 'Library').click();
  for (const id of ['meadow', 'oak-tree', 'window', 'guitar']) {
    await p2.getByTestId(`library-add-${id}`).click();
    await p2.getByTestId('library-add-confirm').click();
    await expect(p2.getByTestId('library-add-result')).toContainText('Added');
  }
  await expect.poll(() => p2.evaluate(() => ['oak', 'window', 'window_right', 'guitar', 'grass'].every((n) => window.__studio!.assets.has(n)))).toBe(true);
  expect(await p2.evaluate(() => window.__store!.state.project!.project.tileset.filter((t) => t.group !== undefined).length)).toBe(46); // the edge pieces came with the grass
  await p2.screenshot({ path: shot('p2-showcase-house-library.png') });

  // ---- the house: a box of blocks, a different tile at every height, hollowed out, with an arch ----
  await tab(p2, 'Structures').click();
  await pickTool(p2, 'blockbox');
  await p2.getByTestId('opt-zfrom').fill('0');
  await p2.getByTestId('opt-zto').fill('2');
  await dragCells(p2, [6, 6], [12, 11]);
  await expect(p2.getByTestId('structures-box')).toContainText('7 x 6 cells, levels 0 to 2');
  const levels = async (from: number, to: number): Promise<void> => {
    await p2.getByTestId('box-z1').fill(String(Math.max(from, to)));
    await p2.getByTestId('box-z1').press('Enter');
    await p2.getByTestId('box-z0').fill(String(from));
    await p2.getByTestId('box-z0').press('Enter');
    await p2.getByTestId('box-z1').fill(String(to));
    await p2.getByTestId('box-z1').press('Enter');
  };
  for (const [z, tile] of [[0, 'stone'], [1, 'brick'], [2, 'Meadow grass']] as const) {
    await tab(p2, 'Tiles').click();
    await p2.getByTestId(`tile-${tile}`).click();
    await tab(p2, 'Structures').click();
    await levels(z, z);
    await p2.getByTestId('box-fill').click();
  }
  const column = (x: number, y: number) => p2.evaluate(([cx, cy]) => window.__store!.doc!.map.getStack(cx!, cy!)?.blocks.map((b) => [b.z, b.tile]) ?? [], [x, y]);
  const ids = await p2.evaluate(() => Object.fromEntries(['stone', 'brick', 'Meadow grass'].map((n) => [n, window.__store!.state.project!.project.tileset.find((t) => t.name === n)!.id])));
  expect(await column(9, 8)).toEqual([[0, ids.stone], [1, ids.brick], [2, ids['Meadow grass']]]); // stone below, brick in the middle, turf on top
  await levels(0, 2);
  await p2.getByTestId('box-hollow').click();
  expect((await column(9, 8)).map((b) => b[0])).toEqual([0, 2]); // a floor and a roof
  expect((await column(6, 8)).map((b) => b[0])).toEqual([0, 1, 2]); // a wall
  // the floor goes (the ground is the floor), and the front wall gets an arch
  await p2.getByTestId('opt-zto').fill('0');
  await dragCells(p2, [7, 7], [11, 10]);
  await p2.getByTestId('box-clear').click();
  await p2.getByTestId('opt-zto').fill('1');
  await dragCells(p2, [9, 11], [9, 11]);
  await p2.getByTestId('box-clear').click();
  expect((await column(9, 11)).map((b) => b[0])).toEqual([2]); // nothing under the lintel
  expect((await column(9, 8)).map((b) => b[0])).toEqual([2]); // only the roof over the room

  // ---- a window and a guitar fixed to the walls ----
  await pickTool(p2, 'attach');
  await p2.getByTestId('opt-attachment').selectOption('window');
  const face = await p2.evaluate(() => window.__viewport!.blockToClient(12, 8, 1, 'right'));
  await p2.mouse.click(face.x, face.y);
  await p2.getByTestId('opt-attachment').selectOption('guitar');
  const face2 = await p2.evaluate(() => window.__viewport!.blockToClient(7, 11, 1, 'left'));
  await p2.mouse.click(face2.x, face2.y);
  expect(await p2.evaluate(() => window.__store!.doc!.entities.filter((e) => e.components.attach).map((e) => e.name).sort())).toEqual(['guitar', 'window']);

  // ---- trees, scattered with room between them (not where the path to the arch goes) ----
  await pickTool(p2, 'props');
  await p2.getByTestId('opt-prefab').selectOption('sprite:oak');
  await p2.getByTestId('opt-density').fill('1');
  await p2.getByTestId('opt-spacing').fill('4');
  await dragCells(p2, [15, 2], [29, 11]);
  const trees = await p2.evaluate(() => window.__store!.doc!.entities.filter((e) => e.name.startsWith('oak')).length);
  expect(trees).toBeGreaterThan(4);

  // ---- in the game: walking behind a tree makes only its canopy see-through ----
  await p2.getByTestId('btn-play').click();
  await p2.waitForFunction(() => window.__play !== undefined);
  const tree = await p2.evaluate(() => {
    const t = window.__play!.sim.world.all().find((e) => e.name.startsWith('oak'))!;
    return { id: t.id, ...(t.get('transform') as { x: number; y: number }) };
  });
  expect(await p2.evaluate((id) => window.__viewport!.renderer.canopyAlpha(id), tree.id)).toBeGreaterThan(0.9); // nobody is behind it
  await p2.evaluate((t) => {
    const me = window.__play!.sim.world.withTag('player')[0]!.get('transform') as { x: number; y: number; h: number };
    me.x = t.x - 1.4; // just beyond the 2 x 2 footprint, on the far side from the camera
    me.y = t.y - 1.4;
  }, tree);
  await expect.poll(() => p2.evaluate((id) => window.__viewport!.renderer.canopyAlpha(id), tree.id)).toBeLessThan(0.5);
  await p2.screenshot({ path: shot('p2-showcase-canopy.png') });
  await p2.getByTestId('btn-stop').click();

  // ---- keep it; the bot walks through the arch and round behind a tree ----
  await p2.evaluate(() => window.__store!.save());
  const houseDir = await saveSample(p2, 'tiles-house');
  await second.app.close();
  const { game, bot } = await loadSampleGame(houseDir);
  bot.wait(0.2);
  const inside = bot.walkTo({ x: 9.5, y: 8.5 }, { label: 'the middle of the house', maxSeconds: 60 });
  expect(inside.ok, inside.message).toBe(true);
  expect(where(game, 'Player').y).toBeLessThan(11); // through the arch, not over the wall
  const out = bot.walkTo({ x: 9.5, y: 14.5 }, { label: 'outside again', maxSeconds: 60 });
  expect(out.ok, out.message).toBe(true);
  const behind = bot.walkTo({ x: tree.x - 1.2, y: tree.y - 1.2 }, { label: 'behind the tree', maxSeconds: 90 });
  expect(behind.ok, behind.message).toBe(true);
  // =========================== project three: a set taken from the hub ===========================
  // somebody else shares a script too: it waits for a moderator, then is marked as code
  const api = async (method: string, route: string, body?: unknown, token = ''): Promise<{ status: number; json: any }> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const res = await fetch(`${hubAddress}/api/v1${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  const bobToken = (await api('POST', '/accounts', { name: 'Bob', password: 'password123' })).json.token as string;
  const codePack = { format: 'tilewright-pack', formatVersion: 1, name: 'Door script', kind: 'behaviour', description: 'Opens doors', licence: 'CC0-1.0', tags: ['door'], code: true, files: [{ path: 'assets/scripts/door.ts', encoding: 'utf8', data: 'export default 1' }], tiles: [], autotile: [], uiPrefabs: [] };
  const doorId = (await api('POST', '/items', { pack: codePack }, bobToken)).json.id as string;
  expect((await api('GET', '/items?q=script')).json.total).toBe(0); // not on the shelf yet
  const third = await launchEditor(undefined, { TILEWRIGHT_LIBRARY: path.join(tmp, 'library3') });
  const p3 = third.page;
  await createProjectViaUi(p3, 'From The Hub', 'empty-iso');
  await tab(p3, 'Hub').click();
  await p3.getByTestId('hub-address').fill(hubAddress);
  await p3.getByTestId('hub-connect').click();
  await expect(p3.getByTestId('hub-status')).toContainText('Connected');
  await p3.getByTestId('hub-search').fill('meadow');
  await p3.getByTestId('hub-find').click();
  const card = p3.locator('[data-testid^="hub-item-meadow"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('by Ada');
  await expect(card).toContainText('CC-BY');
  await card.locator('.library-thumb').click();
  await expect(p3.getByTestId('hub-details')).toContainText('credits file automatically');
  await expect(p3.getByTestId('hub-code-warning')).toHaveCount(0);
  await p3.getByTestId('hub-get').click();
  await expect(p3.getByTestId('hub-status')).toContainText('Added "Meadow" to your library');
  // the moderator approves the script; now it shows, marked as code, and cannot be taken without a yes
  expect((await api('POST', `/admin/items/${doorId}/approve`, {}, 'd'.repeat(32))).status).toBe(200);
  await p3.getByTestId('hub-search').fill('script');
  await p3.getByTestId('hub-find').click();
  const door = p3.locator(`[data-testid="hub-item-${doorId}"]`);
  await expect(door).toContainText('HAS CODE');
  await door.locator('.library-thumb').click();
  await expect(p3.getByTestId('hub-code-warning')).toBeVisible();
  await expect(p3.getByTestId('hub-get')).toBeDisabled();
  await p3.getByTestId('hub-code-ok').check();
  await expect(p3.getByTestId('hub-get')).toBeEnabled();
  await p3.getByTestId('hub-get').click();
  await expect(p3.getByTestId('hub-status')).toContainText('Added "Door script"');
  // into the project: the code one needs a second yes in the library
  await tab(p3, 'Library').click();
  await p3.getByTestId('library-add-door-script').click();
  await expect(p3.getByTestId('library-add-confirm')).toBeDisabled();
  await p3.getByTestId('library-approve-code').check();
  await p3.getByTestId('library-add-confirm').click();
  await expect(p3.getByTestId('library-add-result')).toContainText('Added "Door script"');
  await p3.getByTestId('library-add-meadow').click();
  await p3.getByTestId('library-add-confirm').click();
  await expect(p3.getByTestId('library-add-result')).toContainText('Added "Meadow"');
  await p3.evaluate(() => window.__store!.save());
  const dir3 = await p3.evaluate(() => window.__store!.state.project!.dir);
  // the licence and author travel with it, and an exported game would list them
  const links = fs.readFileSync(path.join(dir3, 'assets', 'library-links.json'), 'utf8');
  const credits = creditsOf(links);
  expect(credits.map((c) => c.name)).toEqual(expect.arrayContaining(['Meadow', 'Door script']));
  const text = buildCredits('From The Hub', credits)!;
  expect(text).toContain('"Meadow" by Ada - CC BY 4.0');
  expect(text).toContain(hubAddress);
  expect(text).toContain('creativecommons.org/licenses/by/4.0');
  await saveSample(p3, 'tiles-from-the-hub');
  await third.app.close();
  void selectObject; void setText;

  hub.close();
  expect([...errors, ...second.errors, ...third.errors]).toEqual([]);
});
