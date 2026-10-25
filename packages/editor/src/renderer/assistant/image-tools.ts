import {
  compositeFrame,
  encodePng,
  encodeRle,
  newSprite,
  parseSprite,
  type SpriteData,
} from "@tilewright/runtime";
import { host } from "@tilewright/behaviors";
import { fail, type Proposal } from "./tool-core";
import { api, joinPath } from "../project/api";
import {
  SPRITE_DIR,
  deleteSprite,
  importPng,
  saveSprite,
  spriteNameProblem,
} from "../studio/assets";
import { assetFs } from "../project/assetFs";
import { studio } from "../studio/store";
import { store } from "../app/store";

/**
 * Claude making pictures. Two ways: it draws small pixel art itself (`draw_sprite`: a palette and rows of characters), or it asks a
 * picture provider a plugin added (`generate_image`: words in, a PNG out). Either way the result is an ordinary sprite file of
 * the project, shown to the person before it is kept (a provider is asked only after the person says yes: it may cost money).
 */

const MAX_SIZE = 512;

/** "#rrggbb" or "#rrggbbaa" as the palette's "#rrggbbaa". */
const withAlpha = (hex: string): string =>
  hex.length === 7 ? `${hex.toLowerCase()}ff` : hex.toLowerCase();

const CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Rows of characters as palette indices. Every mistake says which row and what to do. */
function indicesOf(
  rows: readonly string[],
  width: number,
  height: number,
  colours: number,
  frame: string,
): Uint8Array {
  if (rows.length !== height)
    fail(
      `${frame} has ${rows.length} rows but the picture is ${height} high. Give exactly ${height} rows.`,
    );
  const out = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    if (row.length !== width)
      fail(
        `${frame}, row ${y + 1} is ${row.length} characters long but the picture is ${width} wide ("${row.slice(0, 40)}"). Every row must be exactly ${width} characters.`,
      );
    [...row].forEach((ch, x) => {
      if (ch === "." || ch === " ") return;
      const i = CHARS.indexOf(ch.toLowerCase());
      if (i < 1 || i > colours)
        fail(
          `${frame}, row ${y + 1}, column ${x + 1}: "${ch}" is not "." or one of the ${colours} palette colours (1 to ${CHARS[colours]}).`,
        );
      out[y * width + x] = i;
    });
  });
  return out;
}

/** A sprite's first frame as PNG bytes, enlarged so small pictures can be seen. */
export function previewPng(sprite: SpriteData, frame = 0): Uint8Array {
  const scale = Math.max(
    1,
    Math.min(8, Math.floor(192 / Math.max(sprite.width, sprite.height))),
  );
  const rgba = compositeFrame(sprite, frame);
  const w = sprite.width * scale;
  const h = sprite.height * scale;
  const big = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from =
        (Math.floor(y / scale) * sprite.width + Math.floor(x / scale)) * 4;
      big.set(rgba.subarray(from, from + 4), (y * w + x) * 4);
    }
  }
  return encodePng(w, h, big);
}

async function existingSpriteText(name: string): Promise<string | null> {
  const p = store.state.project;
  if (!p) return fail("No project is open.");
  const file = joinPath(p.dir, SPRITE_DIR, `${name}.sprite.json`);
  return (await api().fs.exists(file)) ? api().fs.read(file) : null;
}

function nameFor(name: string, replace: boolean): void {
  const taken = [...studio.assets.keys()];
  const problem = spriteNameProblem(
    name,
    replace ? taken.filter((n) => n !== name) : taken,
  );
  if (problem)
    fail(
      replace || !taken.includes(name)
        ? problem
        : `${problem} (Use replace: true to overwrite it, or pick another name.)`,
    );
}

/** Save a sprite and take it back out again (or put the old one back) when undone. */
function saveWithUndo(
  sprite: SpriteData,
  previous: string | null,
): { apply(): Promise<void>; undo(): Promise<boolean> } {
  return {
    async apply() {
      const p = store.state.project;
      if (!p) return fail("No project is open.");
      await saveSprite(assetFs, p.dir, sprite);
      await studio.loadAssets();
    },
    async undo() {
      const p = store.state.project;
      if (!p) return false;
      if (previous === null) await deleteSprite(assetFs, p.dir, sprite.name);
      else
        await api().fs.write(
          joinPath(p.dir, SPRITE_DIR, `${sprite.name}.sprite.json`),
          previous,
        );
      await studio.loadAssets();
      return true;
    },
  };
}

async function drawSprite(input: Record<string, unknown>): Promise<Proposal> {
  const name = String(input.name).trim();
  const width = Number(input.width);
  const height = Number(input.height);
  const replace = input.replace === true;
  nameFor(name, replace);
  const colours = (input.palette as string[]).map(withAlpha);
  const frames = [
    input.rows as string[],
    ...((input.moreFrames as string[][] | undefined) ?? []),
  ];
  const sprite = newSprite(name, width, height);
  sprite.palette = ["#00000000", ...colours];
  sprite.frames = frames.map((rows, i) => ({
    duration: Number(input.frameMs ?? 120),
    cels: {
      l1: encodeRle(
        indicesOf(
          rows,
          width,
          height,
          colours.length,
          i === 0 ? "The first frame" : `Frame ${i + 1}`,
        ),
      ),
    },
    boxes: [],
  }));
  sprite.origin = { x: Math.floor(width / 2), y: height - 1 };
  if (sprite.frames.length > 1)
    sprite.clips = [
      {
        name: "idle",
        loop: true,
        mirror: false,
        all: sprite.frames.map((_, i) => i),
        dirs: {},
        events: [],
      },
    ];
  const previous = replace ? await existingSpriteText(name) : null;
  const save = saveWithUndo(sprite, previous);
  const unused = colours.filter(
    (_c, i) =>
      !frames.some((rows) =>
        rows.some((r) => r.toLowerCase().includes(CHARS[i + 1]!)),
      ),
  );
  return {
    tool: "draw_sprite",
    title: `${previous === null ? "Draw" : "Redraw"} the sprite "${name}"`,
    lines: [
      `${width} x ${height} pixels, ${colours.length} colours, ${frames.length} frame${frames.length === 1 ? "" : "s"}.`,
      ...(unused.length > 0
        ? [
            `${unused.length} colour${unused.length === 1 ? "" : "s"} in the palette ${unused.length === 1 ? "is" : "are"} not used.`,
          ]
        : []),
      ...(previous !== null
        ? ["It replaces the sprite that is there now."]
        : []),
    ],
    images: [{ name, png: previewPng(sprite) }],
    async apply() {
      await save.apply();
      return `Saved the sprite "${name}" (${width} x ${height}). It is in the sprite list; objects can use it as their picture.`;
    },
    undo: save.undo,
  };
}

function generateImage(input: Record<string, unknown>): Proposal {
  const provider = host.ext.imageProviders.get(String(input.provider));
  if (!provider)
    return fail(
      `There is no picture provider "${String(input.provider)}". list_image_providers says which exist.`,
    );
  const name = String(input.name).trim();
  const width = Number(input.width);
  const height = Number(input.height);
  const replace = input.replace === true;
  nameFor(name, replace);
  if (width > MAX_SIZE || height > MAX_SIZE)
    fail(`A sprite can be at most ${MAX_SIZE} x ${MAX_SIZE} pixels.`);
  const reference =
    typeof input.reference === "string" && input.reference
      ? input.reference
      : "";
  if (reference && !studio.assets.has(reference))
    fail(`There is no sprite "${reference}" to use as a reference.`);
  let saved: { apply(): Promise<void>; undo(): Promise<boolean> } | null = null;
  const proposal: Proposal = {
    tool: "generate_image",
    title: `Make a picture "${name}" with ${provider.label}`,
    lines: [
      `Asks "${provider.label}" (from the plugin ${provider.plugin}) for a ${width} x ${height} picture: "${String(input.prompt).slice(0, 200)}".`,
      ...(provider.needsKey
        ? ["This service may charge you for each picture."]
        : []),
      ...(reference ? [`Starting from the sprite "${reference}".`] : []),
    ],
    async apply() {
      const p = store.state.project;
      if (!p) return fail("No project is open.");
      const hasKey = provider.needsKey ? await api().assistant.providerKey.has(provider.id) : true;
      if (!hasKey)
        return fail(
          `${provider.label} needs a key and none is saved. Ask the user to add it in the assistant's settings (Picture providers), then try again.`,
        );
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
          ...(provider.needsKey
            ? { fetch: (url: string, init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array } = {}) => api().assistant.providerKey.fetch({ provider: provider.id, plugin: provider.plugin, url, ...init }) }
            : {}),
        });
      } catch (e) {
        return fail(
          `${provider.label} could not make the picture: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const imported = importPng(png, name);
      const previous = replace ? await existingSpriteText(name) : null;
      saved = saveWithUndo(imported.sprite, previous);
      await saved.apply();
      proposal.images = [{ name, png }];
      return `Saved the picture as the sprite "${name}" (${imported.sprite.width} x ${imported.sprite.height}). ${imported.notes.join(" ")}`;
    },
    undo: async () => (saved ? saved.undo() : false),
  };
  return proposal;
}

/** The tools that make pictures. Null when the name is not one of them. */
export async function prepareImageAction(
  name: string,
  input: Record<string, unknown>,
): Promise<Proposal | null> {
  if (name === "draw_sprite") return drawSprite(input);
  if (name === "generate_image") return generateImage(input);
  return null;
}
