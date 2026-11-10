import { _electron as electron, expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INK, paletteOf, rasterize, rgbaOf, type Op, type Picture, type TilePicture } from './draw';
import { PICTURES } from './pictures';
import { TILES, clipTile } from './tiles';

/**
 * Draws every picture of the game in the real editor: the Sprite studio and the Tile studio, with the mouse, one stroke
 * at a time (rectangles, ellipses, lines, pencil dots, fills), then frames, the feet point and the animations, and for
 * the ground the tile studio's block canvas, "Clip art to the guides", "Split into faces" and "Send to the palette".
 * After each picture the studio's pixels are compared with what the strokes should give. What the editor saved is
 * copied to art/out, which the game is built from.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const OUT = path.join(HERE, 'out');
const only = process.env.NG_ONLY?.split(',');

interface View {
  x: number;
  y: number;
  zoom: number;
}

class Painter {
  private tool = '';
  private swatch = -1;
  private size = -1;
  private filled: boolean | null = null;
  private view: View = { x: 0, y: 0, zoom: 1 };
  constructor(private readonly page: Page) {}

  reset(): void {
    this.tool = '';
    this.swatch = -1;
    this.size = -1;
    this.filled = null;
  }

  /** Where the pixels are on the page (asked once a frame: the picture stays put while it is drawn on). */
  async measure(): Promise<void> {
    const [a, b] = await this.page.evaluate(() => [window.__studioPx!(0, 0), window.__studioPx!(1, 0)]);
    this.view = { x: a!.x, y: a!.y, zoom: b!.x - a!.x };
  }

  private at(x: number, y: number): [number, number] {
    return [this.view.x + x * this.view.zoom, this.view.y + y * this.view.zoom];
  }

  private async pick(tool: string): Promise<void> {
    if (this.tool === tool) return;
    await this.page.getByTestId(`stool-${tool}`).click();
    this.tool = tool;
    this.size = -1; // the options under the tools are drawn again
    this.filled = null;
  }

  private async colour(index: number): Promise<void> {
    if (this.swatch === index) return;
    await this.page.getByTestId(`swatch-${index}`).click();
    this.swatch = index;
  }

  private async brush(size: number): Promise<void> {
    if (this.size === size) return;
    await this.page.getByTestId('studio-size').fill(String(size));
    this.size = size;
  }

  private async fill(on: boolean): Promise<void> {
    if (this.filled === on) return;
    await this.page.getByLabel('Filled shapes').setChecked(on);
    this.filled = on;
  }

  private async drag(a: [number, number], b: [number, number]): Promise<void> {
    const [ax, ay] = this.at(...a);
    const [bx, by] = this.at(...b);
    const m = this.page.mouse;
    await m.move(ax, ay);
    await m.down();
    if (ax !== bx || ay !== by) await m.move((ax + bx) / 2, (ay + by) / 2);
    await m.move(bx, by);
    await m.up();
  }

  async stroke(op: Op, palette: string[]): Promise<void> {
    if (op.t === 'erase') {
      await this.pick('eraser');
      await this.brush(op.size ?? 1);
      await this.pick('line'); // rubbing out along a straight line: the eraser follows the mouse, so go straight
      await this.pick('eraser');
      await this.brush(op.size ?? 1);
      await this.drag(op.a, op.b);
      return;
    }
    const index = palette.indexOf(op.c) + 1;
    if (op.t === 'rect' || op.t === 'ellipse') {
      await this.pick(op.t);
      await this.fill(op.outline === undefined);
      if (op.outline !== undefined) await this.brush(op.outline);
      await this.colour(index);
      await this.drag(op.a, op.b);
    } else if (op.t === 'line') {
      await this.pick('line');
      await this.brush(op.size ?? 1);
      await this.colour(index);
      await this.drag(op.a, op.b);
    } else if (op.t === 'dots') {
      await this.pick('pencil');
      await this.brush(op.size ?? 1);
      await this.colour(index);
      for (const d of op.pts) {
        const [x, y] = this.at(...d);
        await this.page.mouse.click(x, y);
      }
    } else {
      await this.pick('fill');
      await this.colour(index);
      const [x, y] = this.at(...op.at);
      await this.page.mouse.click(x, y);
    }
  }
}

async function commit(page: Page, testId: string, value: string | number): Promise<void> {
  const f = page.getByTestId(testId);
  await f.fill(String(value));
  await f.press('Enter');
}

/** Set the picture's palette: the first colours replace the studio's starting ones, the rest are added. */
async function setPalette(page: Page, inks: string[]): Promise<void> {
  const have = await page.evaluate(() => window.__studio!.doc!.palette.length - 1);
  for (let i = 0; i < inks.length; i++) {
    const hex = INK[inks[i] as keyof typeof INK];
    if (i < have) {
      await page.getByTestId(`swatch-${i + 1}`).click();
      await page.getByTestId('palette-edit').fill(hex);
    } else {
      await page.getByTestId('palette-new').fill(hex);
      await page.getByTestId('palette-add').click();
    }
  }
  const got = await page.evaluate((n) => window.__studio!.doc!.palette.slice(1, n + 1), inks.length);
  expect(got.map((c) => c.slice(0, 7).toLowerCase())).toEqual(inks.map((k) => INK[k as keyof typeof INK]));
}

/** Open one of the studio's folded sections (Animations, Properties...) if it is shut. */
async function openSection(page: Page, testId: string): Promise<void> {
  const sec = page.getByTestId(testId);
  if (!(await sec.evaluate((el) => (el as HTMLDetailsElement).open))) await sec.locator('summary').click();
}

async function setZoom(page: Page, w: number, h: number): Promise<void> {
  const box = (await page.getByTestId('studio-canvas').boundingBox())!;
  // the biggest zoom at which the whole picture fits in the canvas with room to spare (a stroke outside it would land on a button)
  const zoom = Math.max(1, Math.min(12, Math.floor(Math.min((box.width - 60) / w, (box.height - 60) / h))));
  await page.locator('label.opt', { hasText: 'Zoom' }).locator('input').fill(String(zoom));
  await page.waitForTimeout(150);
  // the studio keeps the picture where it was when the zoom changes: pan it (right-drag) to the middle of the canvas
  const corners = (): Promise<{ x: number; y: number }[]> => page.evaluate(([pw, ph]) => [window.__studioPx!(-0.5, -0.5), window.__studioPx!(pw! - 0.5, ph! - 0.5)], [w, h]);
  const [a, b] = await corners();
  const dx = box.x + box.width / 2 - (a!.x + b!.x) / 2;
  const dy = box.y + box.height / 2 - (a!.y + b!.y) / 2;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(cx + dx / 2, cy + dy / 2);
    await page.mouse.move(cx + dx, cy + dy);
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(100);
  }
  const [c, d] = await corners();
  if (!(c!.x > box.x + 10 && c!.y > box.y + 10 && d!.x < box.x + box.width - 10 && d!.y < box.y + box.height - 10)) throw new Error(`The picture (${w} x ${h}) is not wholly inside the studio's canvas.`);
}

/** The pixels of a frame as the studio has them (every layer drawn together would be the same: there is one layer). */
const celOf = (page: Page, frame: number): Promise<number[]> =>
  page.evaluate((f) => {
    const d = window.__studio!.doc!;
    return Array.from(d.cel(f, d.layer));
  }, frame);

async function drawFrames(page: Page, painter: Painter, p: Picture, want: Uint8Array[]): Promise<void> {
  const palette = paletteOf(p);
  for (let i = 0; i < p.frames.length; i++) {
    const f = p.frames[i]!;
    if (i > 0) {
      await page.getByTestId(f.from === 'copy' ? 'frame-dup' : 'frame-add').click();
      await expect(page.getByTestId(`frame-${i}`)).toHaveAttribute('aria-pressed', 'true');
    }
    if (f.ms !== undefined) await commit(page, 'frame-ms', f.ms);
    await painter.measure();
    for (const op of f.ops) await painter.stroke(op, palette);
    if ('preset' in p) continue; // a tile is compared after it has been clipped
    const got = await celOf(page, i);
    const exp = Array.from(want[i]!);
    const diff = got.reduce((n, v, k) => n + (v === exp[k] ? 0 : 1), 0);
    expect(diff, `${p.name}, frame ${i + 1}: ${diff} pixels differ from the strokes`).toBe(0);
  }
}

test('draw the art of Nightgarden in the sprite studio and the tile studio', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nightgarden-art-'));
  const workDir = path.join(base, 'projects');
  fs.mkdirSync(workDir, { recursive: true });
  const app = await electron.launch({ args: [path.join(ROOT, 'packages', 'editor'), `--user-data-dir=${path.join(base, 'userdata')}`], env: { ...process.env, TILEWRIGHT_TEST_DIR: workDir } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1500, height: 920 }).catch(() => undefined);
  await page.getByTestId('btn-new-project').click();
  await page.getByTestId('project-name-input').fill('Nightgarden Art');
  await page.getByTestId('template-empty').locator('..').click();
  await page.getByTestId('btn-create-project').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  const dir = path.join(workDir, 'Nightgarden Art');
  await page.getByTestId('btn-ws-sprites').click();
  const painter = new Painter(page);
  const done: string[] = [];

  // ---------- the things of the garden: the sprite studio ----------
  for (const p of PICTURES) {
    if (only && !only.includes(p.name.split('_')[0]!)) continue;
    // a picture that is already drawn and kept is not drawn again, unless it is asked for by name (or NG_FORCE is set)
    if (!only && !process.env.NG_FORCE && fs.existsSync(path.join(OUT, 'sprites', `${p.name}.sprite.json`))) continue;
    await page.getByTestId('sprite-new').click();
    await page.getByTestId('new-sprite-name').fill(p.name);
    await page.getByTestId('new-sprite-w').fill(String(p.w));
    await page.getByTestId('new-sprite-h').fill(String(p.h));
    await page.getByTestId('new-sprite-ok').click();
    await expect(page.getByTestId('studio-title')).toHaveText(p.name);
    painter.reset();
    await setZoom(page, p.w, p.h);
    await setPalette(page, paletteOf(p));
    await drawFrames(page, painter, p, rasterize(p)).catch(async (e) => {
      await page.screenshot({ path: path.join(HERE, 'preview', 'failed.png') });
      throw e;
    });
    const feet = p.feet ?? [Math.floor(p.w / 2), p.h - 1];
    await openSection(page, 'sec-props');
    await commit(page, 'prop-ox', feet[0]);
    await commit(page, 'prop-oy', feet[1]);
    if (p.clips?.length) await openSection(page, 'sec-anims');
    for (const c of p.clips ?? []) {
      await page.getByTestId('clip-name').fill(c.name);
      await page.getByTestId('clip-add').click();
      await expect(page.getByTestId(`clip-${c.name}`)).toBeVisible();
      if (c.mirror) await page.getByTestId('clip-mirror').check();
      if (c.all) await commit(page, 'clip-all', c.all);
      for (const [d, list] of Object.entries(c.dirs ?? {})) await commit(page, `clip-dir-${d}`, list);
      await expect(page.getByTestId('clip-error')).toHaveCount(0);
    }
    await page.getByTestId('studio-save').click();
    await expect.poll(() => fs.existsSync(path.join(dir, 'assets', 'sprites', `${p.name}.sprite.json`))).toBe(true);
    fs.mkdirSync(path.join(OUT, 'sprites'), { recursive: true });
    fs.copyFileSync(path.join(dir, 'assets', 'sprites', `${p.name}.sprite.json`), path.join(OUT, 'sprites', `${p.name}.sprite.json`));
    done.push(p.name);
  }

  // ---------- the ground: the tile studio ----------
  await page.getByTestId('studio-mode-tile').click();
  const tiles: Record<string, unknown>[] = [];
  for (const t of TILES as TilePicture[]) {
    if (only ? !only.includes('tiles') : !process.env.NG_FORCE && fs.existsSync(path.join(OUT, 'tiles.json'))) continue;
    await page.getByTestId('ts-preset').selectOption(t.preset);
    await page.getByTestId('ts-name').fill(t.name);
    await page.getByTestId('ts-create').click();
    await expect(page.getByTestId('studio-title')).toContainText(t.name);
    expect(await page.evaluate(() => [window.__studio!.doc!.width, window.__studio!.doc!.height])).toEqual([t.w, t.h]);
    painter.reset();
    await setZoom(page, t.w, t.h);
    await setPalette(page, paletteOf(t));
    await drawFrames(page, painter, t, []);
    await page.getByTestId('ts-clip').click();
    // clipping rebuilds the picture (and its palette), so the colours are compared, not the palette numbers
    const got = await page.evaluate(() => Array.from(window.__studio!.doc!.composite(0)));
    const exp = Array.from(rgbaOf(t, clipTile(rasterize(t)[0]!)).data);
    let diff = 0;
    for (let k = 0; k < exp.length; k += 4) if (got[k + 3] !== exp[k + 3] || (exp[k + 3] !== 0 && (got[k] !== exp[k] || got[k + 1] !== exp[k + 1] || got[k + 2] !== exp[k + 2]))) diff++;
    expect(diff, `tile ${t.name}: ${diff} pixels differ from the strokes`).toBe(0);
    await page.getByTestId('studio-save').click();
    await page.getByTestId('ts-split').click();
    for (const face of ['top', 'left', 'right']) await expect.poll(() => fs.existsSync(path.join(dir, 'assets', 'sprites', `${t.name}_${face}.sprite.json`)), { timeout: 15_000 }).toBe(true);
    // the top face is the tile's own picture: open it, give the tile its name, its sides and its settings, and send it to the palette
    await page.getByTestId(`sprite-${t.name}_top`).click();
    await expect(page.getByTestId('studio-title')).toContainText(`${t.name}_top`);
    await commit(page, 'ts-tile-name', `ng ${t.tile.name}`);
    if (t.tile.water) await page.getByTestId('ts-water').check();
    await page.getByTestId('ts-left-art').selectOption(`${t.name}_left`);
    await page.getByTestId('ts-right-art').selectOption(`${t.name}_right`);
    await commit(page, 'ts-face-levels', t.tile.faceLevels ?? 1);
    await page.getByTestId('ts-send').click();
    await expect.poll(() => page.evaluate((n) => window.__store!.state.project!.project.tileset.find((x) => x.name === n) !== undefined, `ng ${t.tile.name}`)).toBe(true);
    const made = await page.evaluate((n) => window.__store!.state.project!.project.tileset.find((x) => x.name === n)!, `ng ${t.tile.name}`);
    tiles.push({ ...made, name: t.tile.name, want: t.tile.id });
    done.push(`tile ${t.name}`);
  }
  await page.screenshot({ path: path.join(HERE, 'preview', 'studio.png') });
  await page.evaluate(() => window.__store!.save());
  expect(errors).toEqual([]);
  await app.close();

  // ---------- keep what the editor saved ----------
  fs.mkdirSync(path.join(OUT, 'sprites'), { recursive: true });
  const from = path.join(dir, 'assets', 'sprites');
  for (const f of fs.readdirSync(from)) if (f.endsWith('.sprite.json')) fs.copyFileSync(path.join(from, f), path.join(OUT, 'sprites', f));
  if (tiles.length > 0) fs.writeFileSync(path.join(OUT, 'tiles.json'), JSON.stringify(tiles, null, 2) + '\n');
  console.log(`drew ${done.length}: ${done.join(', ')}`);
});
