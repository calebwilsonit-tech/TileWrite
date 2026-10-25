import { compositeFrame, decodePng, encodePng, parseSprite, type SpriteData } from '@tilewright/runtime';
import { host } from '@tilewright/behaviors';
import { fail, type Proposal } from './tool-core';
import { api, joinPath } from '../project/api';
import { SPRITE_DIR, deleteSprite, importPng, saveSprite, spriteNameProblem } from '../studio/assets';
import { assetFs } from '../project/assetFs';
import { studio } from '../studio/store';
import { store } from '../app/store';
import { ownTiles } from '../project/tiles';
import { DrawProblem, buildSprite, fitSvgTo, withAlpha, type DrawLayer, type DrawSpec } from './drawing';
import { browserRasterizeSvgAt } from './pictures-browser';
import type { Raster } from './pictures';
import { importTiles, projectPalette } from '../tilestudio/import';
import { makeTile, tilePatch, tileTemplate, templateRows, type MadeTile } from '../tilestudio/make-tile';
import { rgbaOf, type Rgba } from '../tilestudio/pixels';
import { upsertTile } from '../tilestudio/tiles';

/**
 * Claude making pictures. Three ways: it draws itself with the engine's own tools (`draw_sprite`: pixels, shapes that stay
 * editable, SVG, fills and layers; `draw_tile`: a floor tile or a block made to the project's tile shape and put in the tile
 * palette), or it asks a picture provider a plugin added (`generate_image`: words in, a PNG out, which becomes a sprite or goes
 * through the tile import: fitted to the project's tile shape, its colours matched to the tiles already there). Whichever, the
 * result is ordinary sprite files of the project, shown to the person before it is kept (a provider is asked only after the person
 * says yes: it may cost money), and opened in the studio for touch-ups.
 */

const MAX_SIZE = 512;
/** A sheet of tiles from a provider is cut into at most this many tiles (each block is four sprites). */
const MOST_TILES = 16;

const CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** A sprite's first frame as PNG bytes, enlarged so small pictures can be seen. */
export function previewPng(sprite: SpriteData, frame = 0): Uint8Array {
  const scale = Math.max(1, Math.min(8, Math.floor(192 / Math.max(sprite.width, sprite.height))));
  return enlargedPng(sprite.width, sprite.height, compositeFrame(sprite, frame), scale);
}

function enlargedPng(width: number, height: number, rgba: Uint8ClampedArray, scale: number): Uint8Array {
  if (scale <= 1) return encodePng(width, height, rgba);
  const w = width * scale;
  const h = height * scale;
  const big = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
      big.set(rgba.subarray(from, from + 4), (y * w + x) * 4);
    }
  }
  return encodePng(w, h, big);
}

const pngOf = (img: Rgba, scale = 1): Uint8Array => enlargedPng(img.width, img.height, img.data, scale);

async function existingSpriteText(name: string): Promise<string | null> {
  const p = store.state.project;
  if (!p) return fail('No project is open.');
  const file = joinPath(p.dir, SPRITE_DIR, `${name}.sprite.json`);
  return (await api().fs.exists(file)) ? api().fs.read(file) : null;
}

function nameFor(name: string, replace: boolean): void {
  const taken = [...studio.assets.keys()];
  const problem = spriteNameProblem(name, replace ? taken.filter((n) => n !== name) : taken);
  if (problem) fail(replace || !taken.includes(name) ? problem : `${problem} (Use replace: true to overwrite it, or pick another name.)`);
}

/** Save sprites and take them out again (or put the old ones back) when undone. */
function saveWithUndo(sprites: SpriteData[], previous: Map<string, string | null>): { apply(): Promise<void>; undo(): Promise<boolean> } {
  return {
    async apply() {
      const p = store.state.project;
      if (!p) return fail('No project is open.');
      for (const s of sprites) await saveSprite(assetFs, p.dir, s);
      await studio.loadAssets();
    },
    async undo() {
      const p = store.state.project;
      if (!p) return false;
      for (const s of sprites) {
        const before = previous.get(s.name) ?? null;
        if (before === null) await deleteSprite(assetFs, p.dir, s.name);
        else await api().fs.write(joinPath(p.dir, SPRITE_DIR, `${s.name}.sprite.json`), before);
      }
      await studio.loadAssets();
      return true;
    },
  };
}

/** The SVG layers of a drawing, drawn by the window at the size of the picture. */
async function svgRasters(layers: readonly DrawLayer[] | undefined, width: number, height: number): Promise<Map<number, Raster>> {
  const out = new Map<number, Raster>();
  for (const [i, l] of (layers ?? []).entries()) {
    if (!l.svg) continue;
    try {
      out.set(i, await browserRasterizeSvgAt(fitSvgTo(l.svg, width, height), width, height));
    } catch (e) {
      if (e instanceof DrawProblem) throw e;
      fail(`Layer "${l.name}": the SVG could not be drawn (${e instanceof Error ? e.message : String(e)}). Check that it is a valid SVG with an <svg> element.`);
    }
  }
  return out;
}

const layersOf = (input: Record<string, unknown>): DrawLayer[] | undefined => input.layers as DrawLayer[] | undefined;

function describeLayers(layers: readonly DrawLayer[]): string[] {
  return layers.map((l) => `Layer "${l.name}": ${l.rows ? 'pixels' : l.shapes ? `${l.shapes.length} editable shape${l.shapes.length === 1 ? '' : 's'}` : l.svg ? 'an SVG' : 'fills'}${l.fills && l.rows ? ` and ${l.fills.length} fill${l.fills.length === 1 ? '' : 's'}` : ''}.`);
}

/** Open a saved sprite in the studio (the sprite studio, or the tile studio for a tile), without taking the person away from the chat. */
function openInStudio(name: string): void {
  studio.openSprite(name);
}

async function drawSprite(input: Record<string, unknown>): Promise<Proposal> {
  const name = String(input.name).trim();
  const width = Number(input.width);
  const height = Number(input.height);
  const replace = input.replace === true;
  nameFor(name, replace);
  const layers = layersOf(input);
  if (!input.rows && (!layers || layers.length === 0)) fail('Give the drawing: "rows" (pixels) and/or "layers" (rows, shapes or an svg each).');
  const spec: DrawSpec = { name, width, height, palette: input.palette as string[] | undefined, rows: input.rows as string[] | undefined, moreFrames: input.moreFrames as string[][] | undefined, layers, frameMs: Number(input.frameMs ?? 120) };
  if (!spec.palette && !(layers ?? []).every((l) => l.svg)) fail('A palette is needed (colours as "#rrggbb"), unless every layer is an SVG.');
  let built: ReturnType<typeof buildSprite>;
  try {
    built = buildSprite(spec, await svgRasters(layers, width, height));
  } catch (e) {
    if (e instanceof DrawProblem) return fail(e.message);
    throw e;
  }
  const { sprite, notes } = built;
  const previous = replace ? await existingSpriteText(name) : null;
  const save = saveWithUndo([sprite], new Map([[name, previous]]));
  return {
    tool: 'draw_sprite',
    title: `${previous === null ? 'Draw' : 'Redraw'} the sprite "${name}"`,
    lines: [
      `${width} x ${height} pixels, ${sprite.palette.length - 1} colours, ${sprite.frames.length} frame${sprite.frames.length === 1 ? '' : 's'}, ${sprite.layers.length} layer${sprite.layers.length === 1 ? '' : 's'}.`,
      ...(layers ? describeLayers(layers) : []),
      ...notes,
      ...(previous !== null ? ['It replaces the sprite that is there now.'] : []),
      'It is opened in the sprite studio for touch-ups.',
    ],
    images: [{ name, png: previewPng(sprite) }],
    async apply() {
      await save.apply();
      openInStudio(name);
      return `Saved the sprite "${name}" (${width} x ${height}, ${sprite.layers.length} layer${sprite.layers.length === 1 ? '' : 's'}) and opened it in the sprite studio. It is in the sprite list; objects can use it as their picture.`;
    },
    undo: save.undo,
  };
}

// ---------- tiles ----------

const tileIso = (): { tileW: number; tileH: number; heightPx: number } => {
  const p = store.state.project;
  if (!p) return fail('No project is open.');
  return p.project.iso;
};

/** The canvas for a tile in this project, as words and rows (the read tool tile_template). */
export function tileTemplateText(input: Record<string, unknown>): string {
  const kind = input.kind === 'block' ? 'block' : 'floor';
  const t = tileTemplate(tileIso(), kind, Number(input.levels ?? 1));
  const rows = templateRows(t);
  const guide = (g: (typeof t.guides)[number]): string => `  ${g.label}: ${g.points.map(([x, y]) => `(${x}, ${y})`).join(' ')}`;
  return [
    `A ${kind === 'floor' ? 'floor tile' : `block ${t.levels} level${t.levels === 1 ? '' : 's'} tall`} in this project: the canvas is ${t.width} x ${t.height} pixels (the project's tiles are ${tileIso().tileW} x ${tileIso().tileH}, ${tileIso().heightPx} pixels to a level).`,
    'Faces (polygons in canvas pixels; anything you draw outside them is cut away):',
    ...t.guides.map(guide),
    `The canvas as rows (${t.height} rows of ${t.width}): T is the top face${kind === 'block' ? ', L the left face, R the right face' : ''}, "." is outside.`,
    ...rows,
    kind === 'block'
      ? 'Light comes from the top left: the top is the lightest, the left side a little darker (about 0.8 of the top), the right side darker still (about 0.62). Give the faces a base colour with "faces" and draw the detail on top.'
      : 'Draw the floor so it repeats edge to edge: what runs off one side should meet the other side. Give it a base colour with "faces.top" and draw the detail on top.',
  ].join('\n');
}

const darker = (hex: string, k: number): string => {
  const ch = (i: number): string =>
    Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * k)))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}${hex.length >= 9 ? hex.slice(7, 9) : 'ff'}`;
};

/** Sprites and a tile for each made picture, put in the project; and everything needed to take them out again. */
function installTiles(made: { made: MadeTile; tileName: string }[], props: Record<string, unknown> | undefined, previous: Map<string, string | null>, previousTiles: ReturnType<typeof ownTiles>) {
  const sprites = made.flatMap((m) => m.made.sprites);
  const save = saveWithUndo(sprites, previous);
  let ids: number[] = [];
  return {
    sprites,
    async apply(): Promise<number[]> {
      const p = store.state.project;
      if (!p) return fail('No project is open.');
      await save.apply();
      let tiles = [...ownTiles(p.project)];
      ids = [];
      for (const m of made) {
        const top = sprites.find((s) => s.name === m.made.topSprite)!;
        const form = { ...m.made.form, name: m.tileName, props: { ...m.made.form.props, ...(props as object | undefined) } };
        const next = upsertTile(tiles, top, form);
        tiles = next.tiles;
        ids.push(next.id);
      }
      const ok = await store.updateTiles(tiles, p.project.autotile);
      if (!ok) return fail('The tile palette could not be saved.');
      store.setOptions({ tile: ids[0]! });
      openInStudio(made[0]!.made.sprites[0]!.name);
      return ids;
    },
    async undo(): Promise<boolean> {
      const p = store.state.project;
      if (!p) return false;
      await store.updateTiles(previousTiles, p.project.autotile);
      return save.undo();
    },
  };
}

async function drawTile(input: Record<string, unknown>): Promise<Proposal> {
  const iso = tileIso();
  const name = String(input.name).trim();
  const replace = input.replace === true;
  const kind = input.kind === 'block' ? 'block' : 'floor';
  const template = tileTemplate(iso, kind, Number(input.levels ?? 1));
  const own = kind === 'block' ? [name, `${name}_top`, `${name}_left`, `${name}_right`] : [name];
  for (const n of own) nameFor(n, replace);
  const palette = [...(input.palette as string[])].map(withAlpha);
  // the faces first, as a layer under everything else
  const faces = input.faces as { top?: number; left?: number; right?: number } | undefined;
  const layers: DrawLayer[] = [];
  if (faces && (faces.top || faces.left || faces.right)) {
    const top = faces.top ?? 0;
    let left = faces.left ?? 0;
    let right = faces.right ?? 0;
    if (kind === 'block' && top > 0 && (left === 0 || right === 0)) {
      // sides default to darker versions of the top, appended to the palette
      if (palette.length + 2 > 35) fail('The palette has no room for the darker side colours: leave out "faces.left" and "faces.right" only when it has at most 33 colours.');
      if (left === 0) {
        palette.push(darker(palette[top - 1]!, 0.8));
        left = palette.length;
      }
      if (right === 0) {
        palette.push(darker(palette[top - 1]!, 0.62));
        right = palette.length;
      }
    }
    for (const c of [top, left, right]) if (c > palette.length) fail(`"faces" uses colour ${c}, but the palette has ${palette.length} colours.`);
    const mask = templateRows(template);
    const colourOfFace = [top, left, right];
    layers.push({
      name: 'Faces',
      rows: mask.map((row) =>
        [...row]
          .map((ch) => {
            const f = ch === 'T' ? 0 : ch === 'L' ? 1 : ch === 'R' ? 2 : -1;
            const c = f < 0 ? 0 : colourOfFace[f]!;
            return c > 0 ? CHARS[c]! : '.';
          })
          .join(''),
      ),
    });
  }
  if (input.rows) layers.push({ name: 'Pixels', rows: input.rows as string[] });
  layers.push(...(layersOf(input) ?? []));
  if (layers.length === 0) fail('Draw something: "faces", "rows" or "layers". tile_template shows the canvas.');
  const spec: DrawSpec = { name, width: template.width, height: template.height, palette, layers };
  let built: ReturnType<typeof buildSprite>;
  try {
    built = buildSprite(spec, await svgRasters(layers, template.width, template.height));
  } catch (e) {
    if (e instanceof DrawProblem) return fail(`${e.message} (The canvas for this tile is ${template.width} x ${template.height}; tile_template shows it.)`);
    throw e;
  }
  const madeTile = makeTile(rgbaOf(built.sprite), iso, template, name);
  const p = store.state.project!;
  const tileName = typeof input.tileName === 'string' && input.tileName.trim() ? input.tileName.trim() : name;
  const previous = new Map<string, string | null>();
  for (const n of own) previous.set(n, replace ? await existingSpriteText(n) : null);
  const install = installTiles([{ made: madeTile, tileName }], input.props as Record<string, unknown> | undefined, previous, [...ownTiles(p.project)]);
  const existingTile = replace ? ownTiles(p.project).find((t) => t.art === madeTile.topSprite) : undefined;
  return {
    tool: 'draw_tile',
    title: `${existingTile ? 'Redraw' : 'Make'} the ${kind === 'floor' ? 'floor tile' : 'block'} "${tileName}"`,
    lines: [
      `${template.width} x ${template.height} pixels, cut to the ${kind === 'floor' ? 'floor diamond' : 'top and two sides'} of this project (${iso.tileW} x ${iso.tileH}).`,
      ...(kind === 'block' ? [`Its pictures are ${own.slice(1).map((n) => `"${n}"`).join(', ')}: the top and the two sides of the tile.`] : []),
      ...describeLayers(layers),
      ...built.notes,
      'It is added to the tile palette and selected, so it can be painted with at once. The second picture shows it repeated over the ground.',
    ],
    images: [{ name: tileName, png: pngOf(madeTile.picture, 4) }, { name: `${tileName} on the ground`, png: pngOf(tilePatch(madeTile.picture, iso, 4, 4, 1), 2) }],
    async apply() {
      const ids = await install.apply();
      return `Made the ${kind === 'floor' ? 'floor tile' : 'block'} "${tileName}" (tile ${ids[0]}) and added it to the tile palette; it is selected for painting. Its sprite${own.length === 1 ? ' is' : 's are'} ${own.map((n) => `"${n}"`).join(', ')}, opened in the studio. Use get_tiles to see it with the others.`;
    },
    undo: install.undo,
  };
}

// ---------- pictures from a provider ----------

function generateImage(input: Record<string, unknown>): Proposal {
  const provider = host.ext.imageProviders.get(String(input.provider));
  if (!provider) return fail(`There is no picture provider "${String(input.provider)}". list_image_providers says which exist.`);
  const name = String(input.name).trim();
  const width = Number(input.width);
  const height = Number(input.height);
  const replace = input.replace === true;
  const as = (input.as as 'sprite' | 'floor-tile' | 'block-tile' | undefined) ?? 'sprite';
  if (width > MAX_SIZE || height > MAX_SIZE) fail(`A picture can be at most ${MAX_SIZE} x ${MAX_SIZE} pixels.`);
  const columns = Number(input.columns ?? 1);
  const rows = Number(input.rows ?? 1);
  if (as === 'sprite') nameFor(name, replace);
  else if (columns * rows > MOST_TILES) fail(`A sheet can have at most ${MOST_TILES} tiles; ${columns} x ${rows} is ${columns * rows}.`);
  const reference = typeof input.reference === 'string' && input.reference ? input.reference : '';
  if (reference && !studio.assets.has(reference)) fail(`There is no sprite "${reference}" to use as a reference.`);
  let undoer: (() => Promise<boolean>) | null = null;
  const what = as === 'sprite' ? 'a sprite' : as === 'floor-tile' ? 'floor tiles' : 'block tiles';
  const proposal: Proposal = {
    tool: 'generate_image',
    title: `Make a picture "${name}" with ${provider.label}`,
    lines: [
      `Asks "${provider.label}" (from the plugin ${provider.plugin}) for a ${width} x ${height} picture: "${String(input.prompt).slice(0, 200)}".`,
      `It becomes ${what}${as === 'sprite' ? '' : `: fitted to this project's tile shape, its colours matched to the tiles already there, and added to the tile palette${columns * rows > 1 ? ` (a sheet of ${columns} x ${rows})` : ''}`}.`,
      ...(provider.needsKey ? ['This service may charge you for each picture.'] : []),
      ...(reference ? [`Starting from the sprite "${reference}".`] : []),
    ],
    async apply() {
      const p = store.state.project;
      if (!p) return fail('No project is open.');
      const hasKey = provider.needsKey ? await api().assistant.providerKey.has(provider.id) : true;
      if (!hasKey) return fail(`${provider.label} needs a key and none is saved. Ask the user to add it in the assistant's settings (Picture providers), then try again.`);
      let referenceBytes: Uint8Array | undefined;
      if (reference) {
        const text = await existingSpriteText(reference);
        const parsed = text ? parseSprite(JSON.parse(text)) : null;
        if (parsed?.ok) referenceBytes = previewPng(parsed.value);
      }
      let png: Uint8Array;
      try {
        png = await provider.generate({
          prompt: String(input.prompt),
          width,
          height,
          ...(referenceBytes ? { reference: referenceBytes } : {}),
          // the key stays in the main process: the provider writes {{key}} where it goes and the request is made there
          ...(provider.needsKey ? { fetch: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array } = {}) => api().assistant.providerKey.fetch({ provider: provider.id, plugin: provider.plugin, url, ...init }) } : {}),
        });
      } catch (e) {
        return fail(`${provider.label} could not make the picture: ${e instanceof Error ? e.message : String(e)}`);
      }
      proposal.images = [{ name, png }];
      if (as === 'sprite') {
        const imported = importPng(png, name);
        const previous = replace ? await existingSpriteText(name) : null;
        const saved = saveWithUndo([imported.sprite], new Map([[name, previous]]));
        await saved.apply();
        undoer = saved.undo;
        openInStudio(name);
        return `Saved the picture as the sprite "${name}" (${imported.sprite.width} x ${imported.sprite.height}) and opened it in the studio. ${imported.notes.join(' ')}`;
      }
      // a tile: through the tile import
      const iso = p.project.iso;
      const kind = as === 'floor-tile' ? 'floor' : 'block';
      let decoded;
      try {
        decoded = decodePng(png);
      } catch (e) {
        return fail(`The picture could not be read (${e instanceof Error ? e.message : String(e)}).`);
      }
      const palette = projectPalette(studio.assets.values(), 32);
      const result = importTiles({ width: decoded.width, height: decoded.height, data: decoded.rgba }, { iso, kind, levels: Number(input.levels ?? 1), source: (input.source as 'texture' | 'picture' | undefined) ?? 'texture', columns, rows, palette: palette.length >= 4 ? palette : undefined });
      if (result.tiles.length === 0) return fail(result.notes.join(' '));
      const single = result.tiles.length === 1;
      const made = result.tiles.map((t) => {
        const n = single ? name : `${name}_${t.row + 1}_${t.col + 1}`;
        return { made: makeTile(t.img, iso, result.template, n), tileName: single ? name : `${name} ${t.row + 1}-${t.col + 1}` };
      });
      const own = made.flatMap((m) => m.made.sprites.map((s) => s.name));
      for (const n of own) nameFor(n, replace);
      const previous = new Map<string, string | null>();
      for (const n of own) previous.set(n, replace ? await existingSpriteText(n) : null);
      const install = installTiles(made, undefined, previous, [...ownTiles(p.project)]);
      const ids = await install.apply();
      undoer = install.undo;
      proposal.images = [{ name, png }, ...made.slice(0, 2).map((m) => ({ name: m.tileName, png: pngOf(m.made.picture, 3) }))];
      return `Made ${made.length} ${kind === 'floor' ? 'floor tile' : 'block'}${made.length === 1 ? '' : 's'} from the picture (tile${ids.length === 1 ? '' : 's'} ${ids.join(', ')}) and added ${ids.length === 1 ? 'it' : 'them'} to the tile palette; the first is selected for painting. ${result.notes.join(' ')}`;
    },
    undo: async () => (undoer ? undoer() : false),
  };
  return proposal;
}

/** The tools that make pictures. Null when the name is not one of them. */
export async function prepareImageAction(name: string, input: Record<string, unknown>): Promise<Proposal | null> {
  if (name === 'draw_sprite') return drawSprite(input);
  if (name === 'draw_tile') return drawTile(input);
  if (name === 'generate_image') return generateImage(input);
  return null;
}
