import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { MockAnthropic, type MockBlock } from './mock-anthropic';

/**
 * Round 2, section 7.7: Claude draws with the engine's own tools (pixels, shapes that stay editable, SVG, fills, layers), makes a
 * tile that can be painted with at once (the tile template, the tile palette, a patch showing how it repeats), and a picture from a
 * provider goes through the tile import instead of becoming a plain sprite. Each opens in the studio.
 */

const KEY = 'sk-ant-api03-TESTKEY-0123456789abcdef';
const tool = (id: string, name: string, input: unknown): MockBlock => ({ type: 'tool_use', id, name, input });

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const idle = (page: Page) => expect(page.getByTestId('assistant-working')).toHaveCount(0, { timeout: 30_000 });

async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId('assistant-input').fill(text);
  await page.getByTestId('assistant-send').click();
}
function results(body: Body): { id: string; error: boolean; text: string; kinds: string[] }[] {
  const last = body.messages.at(-1);
  return (last.content as any[]).map((b) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const parts = typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : (b.content as any[]); // eslint-disable-line @typescript-eslint/no-explicit-any
    return { id: b.tool_use_id, error: b.is_error === true, text: parts.map((c) => c.text ?? '').join('\n'), kinds: parts.map((c) => c.type) };
  });
}

test('Round 2 section 7.7: Claude draws with shapes, SVG and fills, makes tiles that can be painted with, and a provider picture goes through the tile import', async () => {
  test.setTimeout(240_000);
  const mock = await MockAnthropic.start();
  const { page, app, workDir, errors } = await launchEditor(undefined, { TILEWRIGHT_ASSISTANT_BASE_URL: mock.url });
  await createProjectViaUi(page, 'Drawing', 'empty-iso');
  const dir = path.join(workDir, 'Drawing');
  await page.evaluate(() => window.__store!.updateProjectSettings({ plugins: ['combat', 'inventory', 'story', 'ai', 'lighting', 'storytender', 'example-assistant'] }));
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('key-input').fill(KEY);
  await page.getByTestId('key-save').click();
  await expect(page.getByTestId('key-saved')).toBeVisible();
  const sprite = (name: string) => path.join(dir, 'assets', 'sprites', `${name}.sprite.json`);
  const project = (): { tileset: { id: number; name: string; art?: string; leftArt?: string; rightArt?: string; props?: Record<string, unknown> }[] } => JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));

  // ---- a drawing of layers: pixels, editable shapes, an SVG and a flood fill ----
  mock.enqueue(
    {
      content: [
        tool('d1', 'draw_sprite', {
          name: 'badge',
          width: 24,
          height: 24,
          palette: ['#202030', '#c04040', '#f0d060', '#3070d0'],
          layers: [
            { name: 'Disc', shapes: [{ type: 'ellipse', cx: 12, cy: 12, rx: 11, ry: 11, fill: 2, stroke: 1, strokeWidth: 1 }] },
            { name: 'Frame', rows: [...Array.from({ length: 24 }, (_v, y) => (y === 0 || y === 23 ? '1'.repeat(24) : `1${'.'.repeat(22)}1`))], fills: [{ x: 2, y: 2, color: 3 }] },
            { name: 'Mark', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="3" y="3" width="4" height="4" fill="#3070d0"/></svg>' },
          ],
        }),
      ],
    },
    { content: [{ type: 'text', text: 'Drawn.' }] },
  );
  await send(page, 'Draw a badge.');
  const card = page.getByTestId('proposal').last();
  await expect(card).toContainText('Draw the sprite "badge"');
  await expect(card).toContainText('3 layers');
  await expect(card).toContainText('1 editable shape');
  await expect(card).toContainText('an SVG');
  expect(fs.existsSync(sprite('badge'))).toBe(false);
  await card.getByTestId('proposal-apply').click();
  await expect(card).toHaveAttribute('data-status', 'applied');
  await expect.poll(() => fs.existsSync(sprite('badge'))).toBe(true);
  const saved = JSON.parse(fs.readFileSync(sprite('badge'), 'utf8'));
  expect(saved.layers.map((l: { name: string; kind?: string }) => [l.name, l.kind ?? 'pixel'])).toEqual([['Disc', 'vector'], ['Frame', 'pixel'], ['Mark', 'pixel']]);
  expect(saved.frames[0].vectors.l1).toHaveLength(1); // the shape is still a shape
  expect(await page.evaluate(() => window.__studio!.state.openName)).toBe('badge'); // opened for touch-ups
  await idle(page);

  // ---- a tile: the template first, then a floor tile that is painted with at once ----
  mock.enqueue(
    { content: [tool('t0', 'tile_template', { kind: 'floor' })] },
    {
      content: [
        tool('t1', 'draw_tile', {
          name: 'moss',
          kind: 'floor',
          palette: ['#3f7a3a', '#2e5c2c', '#6aa84f'],
          faces: { top: 1 },
          layers: [{ name: 'Speckle', shapes: [{ type: 'ellipse', cx: 20, cy: 14, rx: 3, ry: 2, fill: 3 }, { type: 'ellipse', cx: 40, cy: 18, rx: 4, ry: 2, fill: 2 }] }],
          props: { walkable: true, tags: ['soft'] },
        }),
      ],
    },
    { content: [{ type: 'text', text: 'A mossy floor tile.' }] },
  );
  await send(page, 'Make a mossy floor tile.');
  const tileCard = page.getByTestId('proposal').last();
  await expect(tileCard).toContainText('Make the floor tile "moss"');
  const tpl = results(mock.requests.at(-1)!.body)[0]!;
  expect(tpl.text).toContain('canvas is 64 x 32 pixels');
  expect(tpl.text).toContain('T is the top face');
  await expect(tileCard.getByTestId('proposal-images').locator('img')).toHaveCount(2); // the tile, and the tile on the ground
  const before = project().tileset.length;
  await tileCard.getByTestId('proposal-apply').click();
  await expect(tileCard).toHaveAttribute('data-status', 'applied');
  await expect.poll(() => project().tileset.some((t) => t.name === 'moss')).toBe(true);
  const moss = project().tileset.find((t) => t.name === 'moss')!;
  expect(moss.art).toBe('moss');
  expect(moss.props).toEqual({ tags: ['soft'] }); // walkable is how it is unless said otherwise
  expect(fs.existsSync(sprite('moss'))).toBe(true);
  expect(JSON.parse(fs.readFileSync(sprite('moss'), 'utf8')).meta).toMatchObject({ kind: 'tile', preset: 'flat' });
  expect(await page.evaluate(() => window.__store!.state.options.tile)).toBe(moss.id); // selected, ready to paint
  expect(project().tileset.length).toBeGreaterThan(before);
  await idle(page);
  await page.screenshot({ path: shot('p4-assistant-tile.png') });

  // ---- a block: top and sides cut for the tile ----
  mock.enqueue(
    { content: [tool('b1', 'draw_tile', { name: 'bricks', kind: 'block', levels: 1, palette: ['#a04030', '#702818'], faces: { top: 1 }, layers: [{ name: 'Mortar', shapes: [{ type: 'path', points: [{ x: 0, y: 30 }, { x: 64, y: 30 }], stroke: 2 }] }] })] },
    { content: [{ type: 'text', text: 'A block.' }] },
  );
  await send(page, 'Now a brick block.');
  const blockCard = page.getByTestId('proposal').last();
  await expect(blockCard).toContainText('Make the block "bricks"');
  await blockCard.getByTestId('proposal-apply').click();
  await expect(blockCard).toHaveAttribute('data-status', 'applied');
  await expect.poll(() => project().tileset.some((t) => t.name === 'bricks')).toBe(true);
  const bricks = project().tileset.find((t) => t.name === 'bricks')!;
  expect([bricks.art, bricks.leftArt, bricks.rightArt]).toEqual(['bricks_top', 'bricks_left', 'bricks_right']);
  for (const n of ['bricks', 'bricks_top', 'bricks_left', 'bricks_right']) expect(fs.existsSync(sprite(n)), n).toBe(true);
  await idle(page);
  // Undo takes the tile and its pictures out again
  await blockCard.getByTestId('proposal-undo').click();
  await expect.poll(() => project().tileset.some((t) => t.name === 'bricks')).toBe(false);
  await expect.poll(() => fs.existsSync(sprite('bricks_top'))).toBe(false);

  // ---- a picture from the provider becomes tiles through the tile import ----
  mock.enqueue(
    { content: [tool('g1', 'generate_image', { provider: 'example-mock-art', prompt: 'mossy cobbles', name: 'cobbles', width: 64, height: 64, as: 'floor-tile', source: 'texture' })] },
    { content: [{ type: 'text', text: 'Tile made.' }] },
  );
  await send(page, 'Make a cobblestone floor tile with the picture maker.');
  const gen = page.getByTestId('proposal').last();
  await expect(gen).toContainText('floor tiles');
  expect(project().tileset.some((t) => t.name === 'cobbles')).toBe(false); // the provider has not been asked yet
  await gen.getByTestId('proposal-apply').click();
  await expect(gen).toHaveAttribute('data-status', 'applied');
  await expect.poll(() => project().tileset.some((t) => t.name === 'cobbles')).toBe(true);
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Tile made');
  const made = results(mock.requests.at(-1)!.body)[0]!;
  expect(made.text).toContain('floor tile');
  expect(made.text).toContain('added it to the tile palette');
  expect(made.text).toContain('Laid on the floor diamond');
  const cob = JSON.parse(fs.readFileSync(sprite('cobbles'), 'utf8'));
  expect([cob.width, cob.height]).toEqual([64, 32]); // fitted to the project's tile shape, not the 64 x 64 the provider made
  expect(errors).toEqual([]);
  await app.close();
  await mock.close();
});
