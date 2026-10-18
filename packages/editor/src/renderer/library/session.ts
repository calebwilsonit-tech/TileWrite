import { compositeFrame, parseSprite, type UiPrefab } from '@tilewright/runtime';
import { store } from '../app/store';
import { api, joinPath } from '../project/api';
import { assetFs } from '../project/assetFs';
import { ownTiles } from '../project/tiles';
import { thumbnailSprite, type Built, type PackSource } from './build';
import { emptyLinks, LINKS_FILE, parseLinks, recordInstall, type Link, type LinksFile } from './links';
import { applyImport, checkPack, decodeFile, findClashes, parsePack, type Clash, type Pack, type Resolution } from './pack';
import { libraryChanged } from './changes';
import { Library, type LibraryFs, type LibraryItem, type SaveOptions } from './store';

/** The glue between the library, the open project and the files on disk. */

const libFs: LibraryFs = {
  read: (f) => api().fs.read(f),
  write: (f, t) => api().fs.write(f, t),
  remove: (f) => api().fs.remove(f),
  exists: (f) => api().fs.exists(f),
};

let cached: Library | null = null;

/** The one library of this computer, loaded from disk (again each time, so another window's changes show up). */
export async function openLibrary(): Promise<Library> {
  if (!cached) cached = new Library(libFs, (await api().info()).library);
  await cached.load();
  return cached;
}

/** What the open project offers to a pack: its tiles, rules, interface pieces and tile size. Null when no project is open. */
export function currentSource(): PackSource | null {
  const p = store.state.project;
  if (!p) return null;
  return { fs: assetFs, dir: p.dir, tiles: ownTiles(p.project), autotile: p.project.autotile, uiPrefabs: store.uiDoc.prefabs, tileSize: { w: p.project.iso.tileW, h: p.project.iso.tileH } };
}

const ASSET_DIRS = ['assets/sprites', 'assets/structures', 'assets/tables', 'assets/components', 'assets/behaviors', 'assets/audio'];

/** Every file the project has in the folders packs write to (for finding name clashes). */
export async function projectFiles(dir: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const d of ASSET_DIRS) {
    try {
      for (const e of await assetFs.list(joinPath(dir, d))) if (!e.dir) out.add(`${d}/${e.name}`);
    } catch {
      /* the folder does not exist yet */
    }
  }
  return out;
}

/** A small picture of a pack for the grid; '' when it holds nothing to draw. */
export function thumbnailOf(pack: Pack): string {
  const name = thumbnailSprite(pack);
  if (!name) return '';
  const file = pack.files.find((f) => f.path.endsWith(`/${name}.sprite.json`));
  if (!file || file.encoding !== 'utf8') return '';
  try {
    const r = parseSprite(JSON.parse(file.data));
    if (!r.ok) return '';
    const s = r.value;
    const src = document.createElement('canvas');
    src.width = s.width;
    src.height = s.height;
    src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(compositeFrame(s, 0)), s.width, s.height), 0, 0);
    const size = 64;
    const scale = Math.min(size / s.width, size / s.height);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    const w = Math.max(1, Math.round(s.width * scale));
    const h = Math.max(1, Math.round(s.height * scale));
    g.drawImage(src, (size - w) / 2, (size - h) / 2, w, h);
    return c.toDataURL('image/png');
  } catch {
    return '';
  }
}

export async function saveToLibrary(built: Built, opts: SaveOptions = {}): Promise<LibraryItem> {
  const lib = await openLibrary();
  const saved = await lib.save(built.pack, { thumb: thumbnailOf(built.pack), ...opts });
  libraryChanged();
  return saved;
}

// ---------- installing ----------

export interface InstallOptions {
  mode: 'link' | 'copy';
  how: Resolution;
  /** The pack holds code: it is only installed when the user says so. */
  approveCode?: boolean;
  /** The library item this came from (links are remembered against it). */
  item?: { id: string; name: string; version: number; source?: string };
}

export interface InstallReport {
  written: number;
  tiles: number;
  uiPrefabs: number;
  renamed: string[];
  skipped: string[];
  warnings: string[];
}

export async function readLinks(dir: string): Promise<LinksFile> {
  const file = joinPath(dir, LINKS_FILE);
  return (await assetFs.exists(file)) ? parseLinks(await assetFs.read(file)) : emptyLinks();
}

/** What would clash if this pack went into the open project. */
export async function previewClashes(pack: Pack): Promise<{ clashes: Clash[]; problems: string[] }> {
  const p = store.state.project;
  if (!p) return { clashes: [], problems: [] };
  const have = { files: await projectFiles(p.dir), tiles: ownTiles(p.project), uiPrefabs: store.uiDoc.prefabs as UiPrefab[] };
  return { clashes: findClashes(pack, have), problems: checkPack(pack, { tileW: p.project.iso.tileW, tileH: p.project.iso.tileH }) };
}

/** Bring a pack into the open project: files written, tiles and rules merged, interface pieces added, everything reloaded. */
export async function installPack(pack: Pack, opts: InstallOptions): Promise<InstallReport> {
  const p = store.state.project;
  if (!p) throw new Error('Open a project first.');
  if (pack.code && !opts.approveCode) throw new Error('This pack contains code. Tilewright only installs it after you have looked at it and said yes.');
  const problems = checkPack(pack, { tileW: p.project.iso.tileW, tileH: p.project.iso.tileH });
  const blocking = problems.filter((x) => !x.includes('will not line up'));
  if (blocking.length > 0) throw new Error(blocking[0]);
  const have = { files: await projectFiles(p.dir), tiles: ownTiles(p.project), uiPrefabs: store.uiDoc.prefabs as UiPrefab[] };
  const r = applyImport(pack, have, opts.how);
  for (const f of r.files) {
    const data = decodeFile(f);
    const full = joinPath(p.dir, ...f.path.split('/'));
    if (typeof data === 'string') await assetFs.write(full, data);
    else await assetFs.writeBinary(full, data);
  }
  if (pack.tiles.length > 0 || pack.autotile.length > 0) {
    const rules = [...p.project.autotile.filter((x) => !r.autotile.some((n) => n.id === x.id)), ...r.autotile];
    const ok = await store.updateTiles(r.tiles, rules);
    if (!ok) throw new Error('The tiles could not be saved.');
  }
  if (pack.uiPrefabs.length > 0) store.setUiDoc({ ...store.uiDoc, prefabs: r.uiPrefabs });
  await store.flushStory();
  await store.loadStory();
  await store.loadStructureFiles();
  const { studio } = await import('../studio/store');
  await studio.loadAssets();
  if (opts.item) {
    const links = await readLinks(p.dir);
    const link: Link = { itemId: opts.item.id, name: opts.item.name, mode: opts.mode, version: opts.item.version, files: r.files.map((f) => f.path), tiles: pack.tiles.map((t) => r.tiles.find((x) => x.id === r.tileMap.get(t.id))?.name ?? t.name), prefabs: pack.uiPrefabs.map((x) => x.name), installedAt: new Date().toISOString(), author: pack.author, licence: pack.licence, source: opts.item.source ?? '' };
    await assetFs.write(joinPath(p.dir, LINKS_FILE), JSON.stringify(recordInstall(links, link), null, 2) + '\n');
  }
  return { written: r.files.length, tiles: pack.tiles.length, uiPrefabs: pack.uiPrefabs.length, renamed: r.renamed, skipped: r.skipped, warnings: problems.filter((x) => x.includes('will not line up')) };
}

/** Add a library item to the open project (the current version, or a given one). */
export async function addFromLibrary(id: string, opts: { mode: 'link' | 'copy'; how: Resolution; approveCode?: boolean; version?: number }): Promise<InstallReport> {
  const lib = await openLibrary();
  const item = lib.item(id);
  if (!item) throw new Error('That library item no longer exists.');
  const version = opts.version ?? item.current;
  const pack = await lib.readPack(id, version);
  return installPack(pack, { mode: opts.mode, how: opts.how, approveCode: opts.approveCode, item: { id, name: item.name, version, ...(item.origin ? { source: `${item.origin.hub} (${item.origin.id})` } : {}) } });
}

/** Bring every linked item up to the library's current version (what the library has wins over local edits to those pieces). */
export async function updateLinked(): Promise<{ updated: string[]; gone: string[] }> {
  const p = store.state.project;
  if (!p) return { updated: [], gone: [] };
  const lib = await openLibrary();
  const links = await readLinks(p.dir);
  const updated: string[] = [];
  const gone: string[] = [];
  for (const l of links.links) {
    if (l.mode !== 'link') continue;
    const item = lib.item(l.itemId);
    if (!item) {
      gone.push(l.name);
      continue;
    }
    if (item.current === l.version) continue;
    await addFromLibrary(l.itemId, { mode: 'link', how: 'replace', approveCode: false });
    updated.push(l.name);
  }
  return { updated, gone };
}

// ---------- sharing ----------

/** Save a library item as a .twpack file anywhere on the computer. */
export async function exportItem(id: string): Promise<string | null> {
  const lib = await openLibrary();
  const item = lib.item(id);
  if (!item) throw new Error('That library item no longer exists.');
  const pack = await lib.readPack(id);
  return api().saveFile(`Save "${item.name}" as an asset pack`, `${item.name.replace(/[^A-Za-z0-9 _-]/g, '')}.twpack`, JSON.stringify(pack));
}

/** Read a .twpack file from the computer into the library. */
export async function importPackFile(): Promise<{ item?: LibraryItem; error?: string }> {
  const f = await api().importFile('Choose an asset pack', ['twpack', 'json']);
  if (!f) return {};
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(f.bytes));
  } catch {
    return { error: 'That file is not a Tilewright asset pack.' };
  }
  const r = parsePack(json);
  if (!r.ok) return { error: r.error };
  const bad = checkPack(r.pack).filter((x) => !x.includes('will not line up'));
  if (bad.length > 0) return { error: bad[0] };
  const lib = await openLibrary();
  const item = await lib.save(r.pack, { thumb: thumbnailOf(r.pack), note: 'Imported from a file' });
  libraryChanged();
  return { item };
}
