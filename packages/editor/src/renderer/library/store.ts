import { joinPath } from '../project/api';
import { PACK_KINDS, parsePack, type Pack, type PackKind } from './pack';

/**
 * The personal asset library: a folder outside any project (so it is shared by all of them) holding every saved item as a pack.
 *   index.json                    what is in the library (names, folders, tags, thumbnails, which version is current)
 *   packs/<id>/v<n>.pack.json     every saved version of an item, kept so an older one can be brought back
 */

export interface LibraryFs {
  read(file: string): Promise<string>;
  write(file: string, text: string): Promise<void>;
  remove(file: string): Promise<void>;
  exists(file: string): Promise<boolean>;
}

export interface LibraryVersion {
  n: number;
  savedAt: string;
  note: string;
}

export interface LibraryItem {
  id: string;
  name: string;
  kind: PackKind;
  folder: string;
  tags: string[];
  description: string;
  author: string;
  licence: string;
  /** A small picture (data URL) shown in the grid. */
  thumb: string;
  /** The version projects get when they add the item. */
  current: number;
  versions: LibraryVersion[];
  /** True when the pack holds code. */
  code: boolean;
}

export interface LibraryIndex {
  version: 1;
  folders: string[];
  items: LibraryItem[];
}

export const emptyIndex = (): LibraryIndex => ({ version: 1, folders: [], items: [] });

const INDEX = 'index.json';
const packFile = (root: string, id: string, n: number): string => joinPath(root, 'packs', id, `v${n}.pack.json`);

export function folderProblem(name: string, existing: readonly string[]): string | null {
  const n = name.trim();
  if (n.length === 0) return 'Give the folder a name.';
  if (n.length > 40) return 'Folder names can be at most 40 characters.';
  if (/[\\:*?"<>|]/.test(n)) return 'A folder name cannot contain any of \\ : * ? " < > |';
  if (existing.some((f) => f.toLowerCase() === n.toLowerCase())) return `A folder called "${n}" already exists.`;
  return null;
}

export interface Query {
  text?: string;
  kind?: PackKind | '';
  tag?: string;
  /** undefined = everywhere; '' = items not in a folder */
  folder?: string;
}

/** Items matching a search: words match the name, tags, kind label and description. */
export function searchItems(items: readonly LibraryItem[], q: Query): LibraryItem[] {
  const words = (q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return items
    .filter((i) => (q.kind ? i.kind === q.kind : true))
    .filter((i) => (q.tag ? i.tags.some((t) => t.toLowerCase() === q.tag!.toLowerCase()) : true))
    .filter((i) => (q.folder === undefined ? true : i.folder === q.folder))
    .filter((i) => {
      const hay = `${i.name} ${i.tags.join(' ')} ${i.kind} ${i.description} ${i.author}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const allTags = (items: readonly LibraryItem[]): string[] => [...new Set(items.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b));

const newId = (name: string, taken: (id: string) => boolean): string => {
  const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item';
  let id = stem;
  let n = 2;
  while (taken(id)) id = `${stem}-${n++}`;
  return id;
};

export interface SaveOptions {
  /** Save as a new version of this item instead of a new item. */
  id?: string;
  folder?: string;
  tags?: string[];
  thumb?: string;
  note?: string;
}

export class Library {
  index: LibraryIndex = emptyIndex();
  constructor(
    private readonly fs: LibraryFs,
    readonly root: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async load(): Promise<void> {
    const file = joinPath(this.root, INDEX);
    if (!(await this.fs.exists(file))) {
      this.index = emptyIndex();
      return;
    }
    try {
      const raw = JSON.parse(await this.fs.read(file)) as Partial<LibraryIndex>;
      const items = (raw.items ?? []).filter((i): i is LibraryItem => !!i && typeof i.id === 'string' && (PACK_KINDS as readonly string[]).includes(i.kind));
      this.index = { version: 1, folders: raw.folders ?? [], items };
    } catch {
      throw new Error('The library list is damaged (index.json). Its packs are still in the packs folder; move index.json away to start a fresh list.');
    }
  }

  private async persist(): Promise<void> {
    await this.fs.write(joinPath(this.root, INDEX), JSON.stringify(this.index, null, 2) + '\n');
  }

  item(id: string): LibraryItem | undefined {
    return this.index.items.find((i) => i.id === id);
  }

  /** Save a pack: a new item, or (with options.id) the next version of an existing one. */
  async save(pack: Pack, opts: SaveOptions = {}): Promise<LibraryItem> {
    const existing = opts.id ? this.item(opts.id) : undefined;
    if (opts.id && !existing) throw new Error('That library item no longer exists.');
    const item: LibraryItem =
      existing ??
      ({
        id: newId(pack.name, (id) => this.index.items.some((i) => i.id === id)),
        name: pack.name,
        kind: pack.kind,
        folder: opts.folder ?? '',
        tags: opts.tags ?? pack.tags,
        description: pack.description,
        author: pack.author,
        licence: pack.licence,
        thumb: opts.thumb ?? '',
        current: 0,
        versions: [],
        code: pack.code,
      } satisfies LibraryItem);
    const n = (item.versions.at(-1)?.n ?? 0) + 1;
    await this.fs.write(packFile(this.root, item.id, n), JSON.stringify(pack));
    item.versions.push({ n, savedAt: this.now(), note: opts.note ?? (n === 1 ? 'First saved' : 'Saved again') });
    item.current = n;
    item.code = pack.code;
    item.kind = pack.kind;
    item.licence = pack.licence || item.licence;
    item.description = pack.description || item.description;
    if (opts.thumb) item.thumb = opts.thumb;
    if (opts.tags && existing) item.tags = opts.tags;
    if (opts.folder !== undefined && existing) item.folder = opts.folder;
    if (!existing) this.index.items.push(item);
    if (item.folder && !this.index.folders.includes(item.folder)) this.index.folders.push(item.folder);
    await this.persist();
    return item;
  }

  async readPack(id: string, version?: number): Promise<Pack> {
    const item = this.item(id);
    if (!item) throw new Error('That library item no longer exists.');
    const n = version ?? item.current;
    if (!item.versions.some((v) => v.n === n)) throw new Error(`Version ${n} of "${item.name}" is not in the library.`);
    const r = parsePack(JSON.parse(await this.fs.read(packFile(this.root, id, n))));
    if (!r.ok) throw new Error(`"${item.name}" could not be read: ${r.error}`);
    return r.pack;
  }

  /** Make an older version the one projects get; the newer ones stay in the history. */
  async restore(id: string, version: number): Promise<void> {
    const item = this.item(id);
    if (!item?.versions.some((v) => v.n === version)) throw new Error('That version is not in the library.');
    item.current = version;
    await this.persist();
  }

  async update(id: string, patch: Partial<Pick<LibraryItem, 'name' | 'folder' | 'tags' | 'description' | 'thumb'>>): Promise<void> {
    const item = this.item(id);
    if (!item) throw new Error('That library item no longer exists.');
    if (patch.name !== undefined) {
      if (patch.name.trim().length === 0) throw new Error('Give the item a name.');
      item.name = patch.name.trim();
    }
    if (patch.folder !== undefined) {
      item.folder = patch.folder;
      if (patch.folder && !this.index.folders.includes(patch.folder)) this.index.folders.push(patch.folder);
    }
    if (patch.tags) item.tags = [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))];
    if (patch.description !== undefined) item.description = patch.description;
    if (patch.thumb !== undefined) item.thumb = patch.thumb;
    await this.persist();
  }

  async remove(id: string): Promise<void> {
    const item = this.item(id);
    if (!item) return;
    for (const v of item.versions) await this.fs.remove(packFile(this.root, id, v.n)).catch(() => undefined);
    this.index.items = this.index.items.filter((i) => i.id !== id);
    await this.persist();
  }

  async addFolder(name: string): Promise<string | null> {
    const problem = folderProblem(name, this.index.folders);
    if (problem) return problem;
    this.index.folders.push(name.trim());
    this.index.folders.sort((a, b) => a.localeCompare(b));
    await this.persist();
    return null;
  }

  /** Remove a folder; the items in it go back to "no folder". */
  async removeFolder(name: string): Promise<void> {
    this.index.folders = this.index.folders.filter((f) => f !== name);
    for (const i of this.index.items) if (i.folder === name) i.folder = '';
    await this.persist();
  }
}
