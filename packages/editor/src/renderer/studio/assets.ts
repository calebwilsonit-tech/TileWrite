import {
  AsepriteError,
  celFor,
  decodePng,
  encodeRle,
  exportSheet,
  indexImage,
  newCel,
  newSprite,
  parseAseprite,
  parseSprite,
  parseScene,
  stringifySprite,
  type SheetOptions,
  type SpriteData,
  type ProjectData,
} from '@tilewright/runtime';
import { joinPath } from '../project/api';
import { UserError, type ProjectFs } from '../project/io';

/** File operations the asset code needs, on top of the basic project ones. */
export interface AssetFs extends ProjectFs {
  list(dir: string): Promise<{ name: string; dir: boolean; size?: number }[]>;
  writeBinary(file: string, bytes: Uint8Array): Promise<void>;
  readBinary(file: string): Promise<Uint8Array>;
}

export const SPRITE_DIR = 'assets/sprites';
const SPRITE_EXT = '.sprite.json';
const META_FILE = 'assets/meta.json';

/** Sprite names become file names, so keep them simple and portable. */
export function spriteNameProblem(name: string, existing: readonly string[] = []): string | null {
  const n = name.trim();
  if (n.length === 0) return 'Give the sprite a name.';
  if (n.length > 40) return 'Sprite names can be at most 40 characters.';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(n)) return 'Use letters, numbers, spaces, - and _ in a sprite name, starting with a letter or number.';
  if (existing.some((e) => e.toLowerCase() === n.toLowerCase())) return `A sprite called "${n}" already exists.`;
  return null;
}

const spriteFile = (dir: string, name: string): string => joinPath(dir, SPRITE_DIR, `${name}${SPRITE_EXT}`);

export async function listSprites(fs: AssetFs, dir: string): Promise<string[]> {
  try {
    const entries = await fs.list(joinPath(dir, SPRITE_DIR));
    return entries
      .filter((e) => !e.dir && e.name.endsWith(SPRITE_EXT))
      .map((e) => e.name.slice(0, -SPRITE_EXT.length))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return []; // no assets folder yet
  }
}

/** Check every frame decodes, so a damaged file is reported on load instead of crashing the studio. */
export function verifySprite(s: SpriteData): void {
  for (let f = 0; f < s.frames.length; f++) {
    for (const layer of s.layers) {
      try {
        celFor(s, f, layer.id);
      } catch (e) {
        throw new UserError(`Sprite "${s.name}" has damaged pixel data in frame ${f + 1}, layer "${layer.name}": ${(e as Error).message}.`);
      }
    }
  }
}

export async function loadSprite(fs: AssetFs, dir: string, name: string): Promise<SpriteData> {
  let text: string;
  try {
    text = await fs.read(spriteFile(dir, name));
  } catch {
    throw new UserError(`Tilewright could not read the sprite "${name}". Is the file missing?`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new UserError(`The sprite "${name}" is damaged: it is not valid JSON (${(e as Error).message}).`);
  }
  const r = parseSprite(json);
  if (!r.ok) throw new UserError(`${r.error} (sprite "${name}")`);
  verifySprite(r.value);
  return r.value;
}

export async function loadAllSprites(fs: AssetFs, dir: string): Promise<{ sprites: Map<string, SpriteData>; problems: string[] }> {
  const sprites = new Map<string, SpriteData>();
  const problems: string[] = [];
  for (const name of await listSprites(fs, dir)) {
    try {
      sprites.set(name, await loadSprite(fs, dir, name));
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  return { sprites, problems };
}

export async function saveSprite(fs: AssetFs, dir: string, sprite: SpriteData): Promise<void> {
  const problem = spriteNameProblem(sprite.name);
  if (problem) throw new UserError(problem);
  await fs.write(spriteFile(dir, sprite.name), stringifySprite(sprite));
}

export async function deleteSprite(fs: AssetFs, dir: string, name: string): Promise<void> {
  await fs.remove(spriteFile(dir, name));
  for (const ext of ['.sheet.png', '.atlas.json']) await fs.remove(joinPath(dir, SPRITE_DIR, `${name}${ext}`)).catch(() => undefined);
}

/** Write `<name>.sheet.png` and `<name>.atlas.json` next to the sprite: the packed sprite sheet. */
export async function exportSpriteSheet(fs: AssetFs, dir: string, sprite: SpriteData, opts: SheetOptions = {}): Promise<{ png: string; atlas: string; width: number; height: number }> {
  const sheet = exportSheet(sprite, { ...opts, imageName: `${sprite.name}.sheet.png` });
  const png = joinPath(dir, SPRITE_DIR, `${sprite.name}.sheet.png`);
  const atlas = joinPath(dir, SPRITE_DIR, `${sprite.name}.atlas.json`);
  await fs.writeBinary(png, sheet.png);
  await fs.write(atlas, JSON.stringify(sheet.atlas, null, 2) + '\n');
  return { png, atlas, width: sheet.width, height: sheet.height };
}

// ---- import ----

export interface ImportResult {
  sprite: SpriteData;
  notes: string[];
}

/** A PNG becomes a sprite: one frame, or a grid of frames when frameW/frameH are given. */
export function importPng(bytes: Uint8Array, name: string, frameW?: number, frameH?: number): ImportResult {
  let img;
  try {
    img = decodePng(bytes);
  } catch (e) {
    throw new UserError(`Could not read that image: ${(e as Error).message}`);
  }
  if (img.width > 512 || img.height > 512) {
    if (!frameW || !frameH) throw new UserError(`That image is ${img.width} x ${img.height}; sprites can be at most 512 x 512. If it is a sprite sheet, tell Tilewright the size of one frame.`);
  }
  const fw = frameW && frameW > 0 ? Math.min(frameW, img.width) : img.width;
  const fh = frameH && frameH > 0 ? Math.min(frameH, img.height) : img.height;
  if (fw > 512 || fh > 512) throw new UserError('A single frame can be at most 512 x 512 pixels.');
  const cols = Math.floor(img.width / fw);
  const rows = Math.floor(img.height / fh);
  const sprite = newSprite(name, fw, fh);
  sprite.frames = [];
  let palette = sprite.palette;
  const notes: string[] = [];
  let approximated = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const part = new Uint8ClampedArray(fw * fh * 4);
      for (let y = 0; y < fh; y++) {
        const src = ((r * fh + y) * img.width + c * fw) * 4;
        part.set(img.rgba.subarray(src, src + fw * 4), y * fw * 4);
      }
      const idx = indexImage(part, palette, 256);
      palette = idx.palette;
      approximated += idx.approximated;
      sprite.frames.push({ duration: 100, cels: { l1: encodeRle(idx.indices) }, boxes: [] });
    }
  }
  if (sprite.frames.length === 0) throw new UserError('That image is smaller than one frame.');
  sprite.palette = palette;
  sprite.origin = { x: Math.floor(fw / 2), y: fh - 1 };
  if (approximated > 0) notes.push(`${approximated} pixels used colours beyond the 255-colour limit and were matched to the nearest colour.`);
  notes.push(`Imported ${sprite.frames.length} frame${sprite.frames.length > 1 ? 's' : ''} of ${fw} x ${fh}.`);
  return { sprite, notes };
}

export function importAseprite(bytes: Uint8Array, name: string): ImportResult {
  try {
    const sprite = parseAseprite(bytes, name);
    return { sprite, notes: [`Imported ${sprite.frames.length} frame${sprite.frames.length > 1 ? 's' : ''}, ${sprite.layers.length} layer${sprite.layers.length > 1 ? 's' : ''} and ${sprite.clips.length} animation${sprite.clips.length === 1 ? '' : 's'} from Aseprite.`] };
  } catch (e) {
    if (e instanceof AsepriteError) throw new UserError(e.message);
    throw new UserError(`Could not read that Aseprite file: ${(e as Error).message}`);
  }
}

/** Pick the importer from the file name. */
export function importAny(file: { name: string; bytes: Uint8Array }): ImportResult {
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'imported';
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'png') return importPng(file.bytes, base);
  if (ext === 'ase' || ext === 'aseprite') return importAseprite(file.bytes, base);
  throw new UserError(`Tilewright can import PNG and Aseprite files, not ".${ext ?? ''}" files.`);
}

/** A blank sprite with an empty cel on its first layer (so the studio has something to draw on). */
export function blankSprite(name: string, width: number, height: number): SpriteData {
  const s = newSprite(name, width, height);
  s.frames[0]!.cels.l1 = encodeRle(newCel(width, height));
  return s;
}

// ---- tags and references ----

export type AssetMeta = { tags: Record<string, string[]> };

export async function loadMeta(fs: AssetFs, dir: string): Promise<AssetMeta> {
  try {
    const raw = JSON.parse(await fs.read(joinPath(dir, META_FILE))) as Partial<AssetMeta>;
    return { tags: raw.tags && typeof raw.tags === 'object' ? raw.tags : {} };
  } catch {
    return { tags: {} };
  }
}

export async function saveMeta(fs: AssetFs, dir: string, meta: AssetMeta): Promise<void> {
  await fs.write(joinPath(dir, META_FILE), JSON.stringify(meta, null, 2) + '\n');
}

export interface Reference {
  scene: string;
  entity: string;
  entityName: string;
}

/** Where is this sprite used? Looks through every scene in the project. */
export async function findReferences(fs: AssetFs, dir: string, project: ProjectData, spriteName: string): Promise<Reference[]> {
  const out: Reference[] = [];
  for (const scenePath of project.scenes) {
    try {
      const parsed = parseScene(JSON.parse(await fs.read(joinPath(dir, scenePath))));
      if (!parsed.ok) continue;
      for (const e of parsed.value.entities) {
        const sprite = e.components.sprite as { asset?: string } | undefined;
        const anim = e.components.animator as { asset?: string } | undefined;
        if (sprite?.asset === spriteName || anim?.asset === spriteName) out.push({ scene: scenePath, entity: e.id, entityName: e.name });
      }
    } catch {
      /* an unreadable scene has no references we can show */
    }
  }
  return out;
}
