import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { decodePng } from '../packages/runtime/src/sprites/png';
import { createProjectViaUi, launchEditor, shot } from './helpers';

type Snapshot = Record<string, number>;

const px = (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([a, b]) => window.__studioPx!(a!, b!), [x, y]);

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const a = await px(page, ...from);
  const b = await px(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6);
  await page.mouse.up();
}

async function click(page: Page, x: number, y: number): Promise<void> {
  const p = await px(page, x, y);
  await page.mouse.click(p.x, p.y);
}

/** Palette index at a pixel of the current frame / layer. */
const pixel = (page: Page, x: number, y: number, frame?: number): Promise<number> =>
  page.evaluate(
    ([a, b, f]) => {
      const d = window.__studio!.doc!;
      return d.cel(f ?? d.frame, d.layer)[b! * d.width + a!]!;
    },
    [x, y, frame ?? null] as [number, number, number | null],
  );

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

const anim = (page: Page) =>
  page.evaluate(() => {
    const e = window.__play!.sim.world.withTag('player')[0]!;
    const a = e.get<{ state: string; frame: number; flip: boolean; clip: string }>('animator')!;
    return { state: a.state, frame: a.frame, flip: a.flip, clip: a.clip };
  });

test('M4: draw and animate a character in the sprite studio, then walk it around the world', async () => {
  test.setTimeout(150_000);
  const { app, page, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Studio Game', 'empty-iso');

  // ---- make a sprite ----
  await page.getByTestId('btn-ws-sprites').click();
  await page.getByTestId('sprite-new').click();
  await page.getByTestId('new-sprite-name').fill('hero');
  await page.getByTestId('new-sprite-w').fill('16');
  await page.getByTestId('new-sprite-h').fill('24');
  await page.getByTestId('new-sprite-ok').click();
  await expect(page.getByTestId('studio-title')).toHaveText('hero');
  await page.waitForTimeout(200);

  // ---- body: filled rectangle in red; head: ellipse in orange; eyes: pencil in white ----
  await page.getByTestId('stool-rect').click();
  await page.getByTestId('swatch-3').click();
  await drag(page, [4, 9], [11, 17]);
  expect(await pixel(page, 7, 12)).toBe(3);
  expect(await pixel(page, 3, 12)).toBe(0);
  await page.getByTestId('stool-ellipse').click();
  await page.getByTestId('swatch-4').click();
  await drag(page, [4, 2], [11, 8]);
  expect(await pixel(page, 7, 5)).toBe(4);
  await page.getByTestId('stool-pencil').click();
  await page.getByTestId('swatch-2').click();
  await click(page, 6, 4);
  await click(page, 9, 4);
  expect(await pixel(page, 6, 4)).toBe(2);
  expect(await pixel(page, 9, 4)).toBe(2);

  // ---- undo and redo from the keyboard ----
  await page.keyboard.press('Control+z');
  expect(await pixel(page, 9, 4)).toBe(4); // back to the head colour under the eye
  await page.keyboard.press('Control+y');
  expect(await pixel(page, 9, 4)).toBe(2);

  // ---- symmetry: one click, two pixels ----
  await page.getByTestId('sym-x').check();
  await page.getByTestId('swatch-5').click();
  await click(page, 1, 12);
  expect(await pixel(page, 1, 12)).toBe(5);
  expect(await pixel(page, 14, 12)).toBe(5);
  await page.getByTestId('sym-x').uncheck();

  // ---- fill, picker ----
  await page.getByTestId('stool-fill').click();
  await page.getByTestId('swatch-7').click();
  await click(page, 6, 14);
  expect(await pixel(page, 6, 14)).toBe(7);
  expect(await pixel(page, 10, 16)).toBe(7);
  await page.getByTestId('stool-picker').click();
  await click(page, 7, 5); // head colour
  expect(await page.evaluate(() => window.__studio!.state.color)).toBe(4);

  // ---- legs for frame 1 (standing): two lines ----
  await page.getByTestId('stool-line').click();
  await page.getByTestId('swatch-9').click();
  await drag(page, [5, 18], [5, 22]);
  await drag(page, [10, 18], [10, 22]);
  expect(await pixel(page, 5, 20)).toBe(9);

  // ---- onion skins and the iso guide are available ----
  await page.getByTestId('iso-grid').check();
  await page.getByTestId('onion-prev').check();

  // ---- frame 2 and 3: duplicate and move the legs ----
  await page.getByTestId('frame-dup').click();
  await expect(page.getByTestId('frame-1')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('stool-eraser').click();
  await drag(page, [4, 19], [11, 22]);
  expect(await pixel(page, 5, 20)).toBe(0);
  await page.getByTestId('stool-line').click();
  await drag(page, [4, 18], [3, 22]);
  await drag(page, [11, 18], [12, 22]);
  expect(await pixel(page, 3, 22)).toBe(9);
  await page.getByTestId('frame-dup').click();
  await page.getByTestId('stool-eraser').click();
  await drag(page, [2, 19], [13, 22]);
  await page.getByTestId('stool-line').click();
  await drag(page, [6, 18], [6, 22]);
  await drag(page, [9, 18], [9, 22]);
  await page.getByTestId('frame-ms').fill('150');
  await page.getByTestId('frame-ms').press('Enter');
  expect(await page.evaluate(() => window.__studio!.doc!.frames.map((f) => f.duration))).toEqual([120, 120, 150]);
  await page.screenshot({ path: shot('m4-studio.png') });

  // ---- hitbox on the last frame, feet point ----
  await page.getByTestId('stool-hurtbox').click();
  await drag(page, [4, 2], [11, 22]);
  expect(await page.evaluate(() => window.__studio!.doc!.frames[2]!.boxes.length)).toBe(1);
  await page.getByTestId('stool-origin').click();
  await click(page, 8, 22);
  expect(await page.evaluate(() => window.__studio!.doc!.origin)).toEqual({ x: 8, y: 22 });

  // ---- animations: idle (frame 1) and walk (frames 2-3) with mirrored directions ----
  await page.getByTestId('sec-anims').locator('summary').click();
  await page.getByTestId('clip-name').fill('idle');
  await page.getByTestId('clip-add').click();
  await page.getByTestId('clip-all').fill('1');
  await page.getByTestId('clip-all').press('Enter');
  await page.getByTestId('clip-name').fill('walk');
  await page.getByTestId('clip-add').click();
  await page.getByTestId('clip-all').fill('2-3');
  await page.getByTestId('clip-all').press('Enter');
  await page.getByTestId('clip-mirror').click();
  await page.getByTestId('clip-dir-E').fill('2, 3');
  await page.getByTestId('clip-dir-E').press('Enter');
  await page.getByTestId('clip-dir-S').fill('3, 2');
  await page.getByTestId('clip-dir-S').press('Enter');
  await page.getByTestId('clip-dir-N').fill('7');
  await page.getByTestId('clip-dir-N').press('Enter');
  await expect(page.getByTestId('clip-error')).toBeVisible(); // there are only 3 frames
  await expect(page.getByTestId('clip-error')).toContainText('Frame 7 does not exist');
  await page.getByTestId('clip-dir-N').fill('');
  await page.getByTestId('clip-dir-N').press('Enter');
  const clips = await page.evaluate(() => window.__studio!.doc!.clips);
  expect(clips.map((c) => c.name)).toEqual(['idle', 'walk']);
  expect(clips[1]).toEqual({ name: 'walk', loop: true, mirror: true, all: [1, 2], dirs: { E: [1, 2], S: [2, 1] }, events: [] });
  await expect(page.getByTestId('preview-canvas')).toBeVisible();

  // ---- save, export a sheet ----
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('studio-title')).toHaveText('hero');
  const spriteFile = path.join(workDir, 'Studio Game', 'assets', 'sprites', 'hero.sprite.json');
  await expect.poll(() => fs.existsSync(spriteFile)).toBe(true);
  const saved = JSON.parse(fs.readFileSync(spriteFile, 'utf8'));
  expect(saved.frames).toHaveLength(3);
  expect(saved.clips).toHaveLength(2);
  expect(saved.origin).toEqual({ x: 8, y: 22 });
  await page.getByTestId('sec-export').locator('summary').click();
  await page.getByTestId('export-sheet').click();
  await expect(page.getByTestId('export-result')).toContainText('sprite sheet'.length ? 'sheet written' : '');
  const sheetPng = fs.readFileSync(path.join(workDir, 'Studio Game', 'assets', 'sprites', 'hero.sheet.png'));
  const sheet = decodePng(new Uint8Array(sheetPng));
  expect(sheet.rgba.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  const atlas = JSON.parse(fs.readFileSync(path.join(workDir, 'Studio Game', 'assets', 'sprites', 'hero.atlas.json'), 'utf8'));
  expect(atlas.frames).toHaveLength(3);
  expect(atlas.clips).toHaveLength(2);

  // ---- back in the world: the asset shows up and goes onto the player ----
  await page.getByTestId('btn-ws-world').click();
  await page.locator('.dv-tab', { hasText: 'Assets' }).click();
  await expect(page.getByTestId('asset-hero')).toBeVisible();
  const playerId = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.tags.includes('player'))!.id);
  const pos = await page.evaluate((id) => window.__viewport!.entityToClient(id)!, playerId);
  await page.mouse.click(pos.x, pos.y);
  await page.locator('.dv-tab', { hasText: 'Inspector' }).click();
  await page.getByTestId('insp-sprite-asset').selectOption('hero');
  const a = await page.evaluate((id) => window.__store!.doc!.getEntity(id)!.components.animator as { asset: string; clip: string; controller: { states: Record<string, { clip: string }> } }, playerId);
  expect(a.asset).toBe('hero');
  expect(a.controller.states.walk!.clip).toBe('walk');
  await expect(page.getByTestId('insp-clip-walk')).toHaveValue('walk');
  expect(await page.evaluate(() => window.__viewport!.renderer.hasSprite('hero'))).toBe(true);
  await page.screenshot({ path: shot('m4-world-sprite.png') });
  await page.keyboard.press('Control+s');

  // ---- play: the drawn character animates, turns and mirrors ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await play(page, {}, 5);
  expect(await anim(page)).toMatchObject({ state: 'idle', frame: 0 });
  await play(page, { move_right: 1 }, 30); // screen-right: facing East
  const east = await anim(page);
  expect(east.state).toBe('walk');
  expect([1, 2]).toContain(east.frame);
  expect(east.flip).toBe(false);
  const seen = new Set<number>();
  for (let i = 0; i < 40; i++) {
    await play(page, { move_right: 1 }, 1);
    seen.add((await anim(page)).frame);
  }
  expect(seen).toEqual(new Set([1, 2])); // both walk frames show up
  await play(page, { move_left: 1 }, 30); // screen-left: facing West, reuses East flipped
  const west = await anim(page);
  expect(west.state).toBe('walk');
  expect(west.flip).toBe(true);
  await play(page, { move_down: 1, move_right: 1 }, 20); // facing down-right on screen: no SE frames, falls back to the all-directions list
  expect([1, 2]).toContain((await anim(page)).frame);
  await page.screenshot({ path: shot('m4-play.png') });
  await play(page, {}, 30);
  expect(await anim(page)).toMatchObject({ state: 'idle', frame: 0 });
  await page.getByTestId('btn-stop').click();

  // ---- the scene file records the sprite; deleting the sprite is reported ----
  const scene = JSON.parse(fs.readFileSync(path.join(workDir, 'Studio Game', 'scenes', 'main.scene.json'), 'utf8'));
  expect(scene.entities[0].components.sprite.asset).toBe('hero');
  await page.getByTestId('btn-ws-sprites').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await page.getByTestId('btn-ws-world').click();
  await expect(page.getByTestId('problem-count')).toContainText('problem');
  await page.locator('.dv-tab', { hasText: 'Problems' }).click();
  await expect(page.getByTestId('problems-panel')).toContainText('uses the sprite "hero"');

  expect(errors).toEqual([]);
  await app.close();
});

test('M4: import a PNG, find where a sprite is used, and keep unsaved drawing safe', async () => {
  test.setTimeout(90_000);
  const { app, workDir, errors } = await launchEditor();
  // a 4x4 PNG with two colours, written next to the project folder
  const { encodePng } = await import('../packages/runtime/src/sprites/png');
  const rgba = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) rgba.set(i % 2 === 0 ? [20, 200, 90, 255] : [0, 0, 0, 0], i * 4);
  const png = path.join(workDir, 'gem.png');
  fs.writeFileSync(png, encodePng(4, 4, rgba));
  await app.close();
  process.env.TILEWRIGHT_TEST_IMPORT = png;
  const second = await launchEditor();
  delete process.env.TILEWRIGHT_TEST_IMPORT;
  await createProjectViaUi(second.page, 'Import Game', 'empty-iso');
  await second.page.getByTestId('btn-ws-sprites').click();
  await second.page.getByTestId('sprite-import').click();
  await expect(second.page.getByTestId('sprite-gem')).toBeVisible();
  await expect(second.page.getByTestId('toast').last()).toContainText('Imported 1 frame');
  expect(fs.existsSync(path.join(second.workDir, 'Import Game', 'assets', 'sprites', 'gem.sprite.json'))).toBe(true);

  // unsaved drawing: switching sprites asks first
  await second.page.getByTestId('sprite-gem').click();
  await expect(second.page.getByTestId('studio-title')).toHaveText('gem');
  await second.page.getByTestId('stool-pencil').click();
  await second.page.getByTestId('swatch-3').click();
  const p = await second.page.evaluate(() => window.__studioPx!(1, 0));
  await second.page.mouse.click(p.x, p.y);
  await expect(second.page.getByTestId('studio-title')).toHaveText('gem •');
  await second.page.getByTestId('sprite-new').click();
  await second.page.getByTestId('new-sprite-name').fill('other');
  await second.page.getByTestId('new-sprite-ok').click();
  await expect(second.page.getByTestId('sprite-unsaved')).toBeVisible(); // asks before leaving gem
  await second.page.getByTestId('sprite-save-first').click();
  await expect(second.page.getByTestId('studio-title')).toHaveText('other');
  expect(await second.page.evaluate(() => window.__studio!.assets.get('gem')!.frames[0]!.cels.l1!.length > 0)).toBe(true);
  await second.page.getByTestId('sprite-gem').click(); // other is clean: switches at once
  await expect(second.page.getByTestId('studio-title')).toHaveText('gem');
  expect(await second.page.evaluate(() => window.__studio!.doc!.cel(0, 'l1')[1])).toBe(3); // the saved pixel came back
  // shapes with sliders become pixels
  await second.page.getByTestId('sprite-new').click();
  await second.page.getByTestId('new-sprite-name').fill('blob');
  await second.page.getByTestId('new-sprite-w').fill('64');
  await second.page.getByTestId('new-sprite-h').fill('96');
  await second.page.getByTestId('new-sprite-ok').click();
  await expect(second.page.getByTestId('studio-title')).toHaveText('blob');
  await second.page.getByTestId('sec-shapes').locator('summary').click();
  await second.page.getByTestId('shapes-on').click();
  await expect(second.page.getByTestId('shapes-on')).toBeChecked();
  await second.page.getByTestId('shape-0-h').fill('64');
  await second.page.getByTestId('shape-add').click();
  await expect(second.page.getByTestId('shape-1-h')).toBeVisible();
  await second.page.getByTestId('shapes-bake').click();
  const painted = await second.page.evaluate(() => {
    const d = window.__studio!.doc!;
    return { pixels: d.cel(0, d.layers[0]!.id).filter((v) => v !== 0).length, colours: d.palette.length, shapes: d.procedural!.shapes.length, height: d.procedural!.shapes[0]!.h };
  });
  expect(painted.pixels).toBeGreaterThan(300);
  expect(painted.colours).toBeGreaterThan(16); // the shaded sides were added to the palette
  expect(painted.shapes).toBe(2);
  expect(painted.height).toBe(64);
  expect(second.errors).toEqual([]);
  expect(errors).toEqual([]);
  await second.app.close();
});
