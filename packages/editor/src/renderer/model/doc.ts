import {
  CURRENT_SCHEMA_VERSION,
  TileMap,
  tileMapFromRows,
  tileMapToRows,
  type EntityData,
  type RegionData,
  type SceneData,
} from '@tilewright/runtime';
import { EditBuffer, readCell, sameCell, writeCell, type CellData, type CellEdit, type CellPatch } from './cells';
import { History, type Command } from './history';

export type DocEvent =
  | { type: 'cells'; cells: { x: number; y: number }[] }
  | { type: 'map' }
  | { type: 'entities' }
  | { type: 'regions' }
  | { type: 'meta' }
  | { type: 'history' };

export type DocListener = (event: DocEvent) => void;

/** An in-progress gesture on the map. Edits show immediately; `commit` makes them one undo step. */
export class Stroke {
  private readonly buffer: EditBuffer;
  private done = false;

  constructor(
    private readonly doc: EditorDoc,
    readonly label: string,
  ) {
    this.buffer = new EditBuffer(doc.map.width);
  }

  /** Change cell (x, y). Out-of-bounds cells are ignored. Returns true if the cell exists. */
  apply(x: number, y: number, patch: CellPatch | ((c: CellData) => CellPatch)): boolean {
    if (this.done || !this.doc.map.inBounds(x, y)) return false;
    const before = readCell(this.doc.map, x, y);
    const p = typeof patch === 'function' ? patch(before) : patch;
    const after = { ...before, ...p };
    if (sameCell(before, after)) return true;
    writeCell(this.doc.map, x, y, after);
    this.buffer.record(x, y, before, after);
    this.doc.emit({ type: 'cells', cells: [{ x, y }] });
    return true;
  }

  get changed(): number {
    return this.buffer.edits().length;
  }

  /** Keep the changes as one undo step (nothing is added if nothing changed). */
  commit(): void {
    if (this.done) return;
    this.done = true;
    const edits = this.buffer.edits();
    if (edits.length === 0) return;
    this.doc.pushCellCommand(this.label, edits);
  }

  /** Throw the changes away. */
  cancel(): void {
    if (this.done) return;
    this.done = true;
    const edits = this.buffer.edits();
    for (const e of edits) writeCell(this.doc.map, e.x, e.y, e.before);
    if (edits.length > 0) this.doc.emit({ type: 'cells', cells: edits.map((e) => ({ x: e.x, y: e.y })) });
  }
}

/**
 * The scene being edited, in mutable form, plus its undo history.
 * All edits go through methods here so they are undoable and the views stay in sync.
 */
export class EditorDoc {
  readonly history = new History();
  dirty = false;
  private readonly listeners = new Set<DocListener>();
  private nextId = 1;

  constructor(
    public name: string,
    public map: TileMap,
    public entities: EntityData[] = [],
    public regions: RegionData[] = [],
  ) {
    this.nextId = this.computeNextId();
  }

  static fromScene(scene: SceneData): EditorDoc {
    const copy = structuredClone(scene);
    return new EditorDoc(copy.name, tileMapFromRows(copy.map), copy.entities, copy.regions);
  }

  toScene(): SceneData {
    return structuredClone({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: this.name,
      map: tileMapToRows(this.map),
      entities: this.entities,
      regions: this.regions,
    });
  }

  private computeNextId(): number {
    let max = 0;
    for (const e of [...this.entities, ...this.regions]) {
      const m = /(\d+)$/.exec(e.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  newId(prefix: string): string {
    return `${prefix}${this.nextId++}`;
  }

  subscribe(fn: DocListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event: DocEvent): void {
    if (event.type !== 'history') this.dirty = true;
    for (const l of [...this.listeners]) l(event);
  }

  markSaved(): void {
    this.dirty = false;
    this.emit({ type: 'history' });
    this.dirty = false;
  }

  // ---- map ----

  beginStroke(label: string): Stroke {
    return new Stroke(this, label);
  }

  /** One-shot edit of several cells as a single undo step. */
  paint(label: string, edits: { x: number; y: number; patch: CellPatch | ((c: CellData) => CellPatch) }[]): number {
    const s = this.beginStroke(label);
    for (const e of edits) s.apply(e.x, e.y, e.patch);
    const n = s.changed;
    s.commit();
    return n;
  }

  pushCellCommand(label: string, edits: CellEdit[]): void {
    const cells = edits.map((e) => ({ x: e.x, y: e.y }));
    this.history.push({
      label,
      redo: () => {
        for (const e of edits) writeCell(this.map, e.x, e.y, e.after);
        this.emit({ type: 'cells', cells });
      },
      undo: () => {
        for (const e of edits) writeCell(this.map, e.x, e.y, e.before);
        this.emit({ type: 'cells', cells });
      },
    });
    this.emit({ type: 'history' });
    this.dirty = true;
  }

  /** Change the map size, keeping the cells that still fit (anchored at the top-left corner). */
  resizeMap(width: number, height: number, fillTile = 1): void {
    const oldMap = this.map;
    const newMap = new TileMap(width, height);
    newMap.fill(fillTile, 0);
    for (let y = 0; y < Math.min(height, oldMap.height); y++) {
      for (let x = 0; x < Math.min(width, oldMap.width); x++) writeCell(newMap, x, y, readCell(oldMap, x, y));
    }
    this.run({
      label: `Resize map to ${width} x ${height}`,
      redo: () => {
        this.map = newMap;
        this.emit({ type: 'map' });
      },
      undo: () => {
        this.map = oldMap;
        this.emit({ type: 'map' });
      },
    });
  }

  // ---- entities ----

  getEntity(id: string): EntityData | undefined {
    return this.entities.find((e) => e.id === id);
  }

  addEntities(items: Omit<EntityData, 'id'>[], label = 'Add entity'): EntityData[] {
    const added = items.map((it) => ({ ...structuredClone(it), id: this.newId('e') }));
    this.run({
      label: added.length > 1 ? `${label} (${added.length})` : label,
      redo: () => {
        this.entities.push(...structuredClone(added));
        this.emit({ type: 'entities' });
      },
      undo: () => {
        const ids = new Set(added.map((a) => a.id));
        this.entities = this.entities.filter((e) => !ids.has(e.id));
        this.emit({ type: 'entities' });
      },
    });
    return this.entities.filter((e) => added.some((a) => a.id === e.id));
  }

  removeEntities(ids: string[], label = 'Delete'): void {
    const set = new Set(ids);
    const removed = this.entities.map((e, index) => ({ e: structuredClone(e), index })).filter((r) => set.has(r.e.id));
    if (removed.length === 0) return;
    this.run({
      label: removed.length > 1 ? `${label} (${removed.length})` : label,
      redo: () => {
        this.entities = this.entities.filter((e) => !set.has(e.id));
        this.emit({ type: 'entities' });
      },
      undo: () => {
        for (const r of removed) this.entities.splice(r.index, 0, structuredClone(r.e));
        this.emit({ type: 'entities' });
      },
    });
  }

  /** Change one or more entities with a mutation function; one undo step. */
  updateEntities(ids: string[], label: string, mutate: (e: EntityData) => void): void {
    const pairs: { id: string; before: EntityData; after: EntityData }[] = [];
    for (const id of ids) {
      const cur = this.getEntity(id);
      if (!cur) continue;
      const after = structuredClone(cur);
      mutate(after);
      if (JSON.stringify(after) !== JSON.stringify(cur)) pairs.push({ id, before: structuredClone(cur), after });
    }
    if (pairs.length === 0) return;
    const set = (key: 'before' | 'after'): void => {
      for (const p of pairs) {
        const i = this.entities.findIndex((e) => e.id === p.id);
        if (i >= 0) this.entities[i] = structuredClone(p[key]);
      }
      this.emit({ type: 'entities' });
    };
    this.run({ label, redo: () => set('after'), undo: () => set('before') });
  }

  // ---- regions ----

  addRegion(r: Omit<RegionData, 'id'>): RegionData {
    const region: RegionData = { ...r, id: this.newId('r') };
    this.run({
      label: `Add region "${region.name}"`,
      redo: () => {
        this.regions.push(structuredClone(region));
        this.emit({ type: 'regions' });
      },
      undo: () => {
        this.regions = this.regions.filter((x) => x.id !== region.id);
        this.emit({ type: 'regions' });
      },
    });
    return region;
  }

  updateRegion(id: string, label: string, mutate: (r: RegionData) => void): void {
    const cur = this.regions.find((r) => r.id === id);
    if (!cur) return;
    const before = structuredClone(cur);
    const after = structuredClone(cur);
    mutate(after);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const set = (v: RegionData): void => {
      const i = this.regions.findIndex((r) => r.id === id);
      if (i >= 0) this.regions[i] = structuredClone(v);
      this.emit({ type: 'regions' });
    };
    this.run({ label, redo: () => set(after), undo: () => set(before) });
  }

  removeRegion(id: string): void {
    const index = this.regions.findIndex((r) => r.id === id);
    if (index < 0) return;
    const removed = structuredClone(this.regions[index]!);
    this.run({
      label: `Delete region "${removed.name}"`,
      redo: () => {
        this.regions = this.regions.filter((r) => r.id !== id);
        this.emit({ type: 'regions' });
      },
      undo: () => {
        this.regions.splice(index, 0, structuredClone(removed));
        this.emit({ type: 'regions' });
      },
    });
  }

  rename(name: string): void {
    const before = this.name;
    if (before === name) return;
    this.run({
      label: 'Rename scene',
      redo: () => {
        this.name = name;
        this.emit({ type: 'meta' });
      },
      undo: () => {
        this.name = before;
        this.emit({ type: 'meta' });
      },
    });
  }

  // ---- history ----

  /** Apply and record a command. */
  run(cmd: Command): void {
    this.history.run(cmd);
    this.emit({ type: 'history' });
    this.dirty = true;
  }

  undo(): string | undefined {
    const l = this.history.undo();
    if (l) {
      this.dirty = true;
      this.emit({ type: 'history' });
    }
    return l;
  }

  redo(): string | undefined {
    const l = this.history.redo();
    if (l) {
      this.dirty = true;
      this.emit({ type: 'history' });
    }
    return l;
  }
}
