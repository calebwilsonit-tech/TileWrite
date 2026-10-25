import {
  CURRENT_SCHEMA_VERSION,
  GeneratorSpecSchema,
  TileMap,
  groundHeightAt,
  type GeneratorSpec,
  type Generated,
  around,
  resolveTile,
  type AutotileRule,
  type TileSet,
  collapseInstance,
  resolveInstance,
  type PrefabData,
  tileMapFromRows,
  tileMapToRows,
  type EntityData,
  type EventRow,
  type GraphData,
  type GravityDir,
  type RegionData,
  type SceneData,
  type VariableData,
  type WireData,
} from '@tilewright/runtime';
import { EditBuffer, readCell, sameCell, writeCell, type CellData, type CellEdit, type CellPatch } from './cells';
import { History, type Command } from './history';

export type DocEvent =
  | { type: 'cells'; cells: { x: number; y: number }[] }
  | { type: 'map' }
  | { type: 'tiles' }
  | { type: 'entities' }
  | { type: 'regions' }
  | { type: 'wires' }
  | { type: 'events' }
  | { type: 'graphs' }
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
    // painting a whole column over a cell that was edited block by block starts it afresh
    if (p.stack === undefined && before.stack && ((p.tile !== undefined && p.tile !== before.tile) || (p.height !== undefined && p.height !== before.height) || (p.slope !== undefined && p.slope !== before.slope) || (p.deck !== undefined && p.deck !== before.deck))) after.stack = null;
    if (sameCell(before, after)) return true;
    if (this.doc.cellGuard && !this.doc.cellGuard(before, after)) return true; // a locked layer: the cell stays as it is
    writeCell(this.doc.map, x, y, after);
    this.buffer.record(x, y, before, after);
    this.doc.emit({ type: 'cells', cells: [{ x, y }] });
    if (before.tile !== after.tile || before.height !== after.height) this.resolveAround(x, y);
    return true;
  }

  /** Autotiling: after a cell changed, its look and its neighbours' looks may have to change too. */
  private resolveAround(x: number, y: number): void {
    const at = this.doc.autotile;
    if (!at || at.rules.length === 0) return;
    const changed: { x: number; y: number }[] = [];
    for (const c of around(this.doc.map, x, y)) {
      const to = resolveTile(this.doc.map, at.tileset, at.rules, c.x, c.y);
      const before = readCell(this.doc.map, c.x, c.y);
      if (to === before.tile || before.stack) continue;
      const after = { ...before, tile: to };
      writeCell(this.doc.map, c.x, c.y, after);
      this.buffer.record(c.x, c.y, before, after);
      changed.push(c);
    }
    if (changed.length > 0) this.doc.emit({ type: 'cells', cells: changed });
  }

  /** Work out the look of every cell again (after the rules changed). Returns how many cells changed. */
  resolveAll(): number {
    const at = this.doc.autotile;
    if (!at) return 0;
    const changed: { x: number; y: number }[] = [];
    for (let y = 0; y < this.doc.map.height; y++) {
      for (let x = 0; x < this.doc.map.width; x++) {
        const before = readCell(this.doc.map, x, y);
        const to = resolveTile(this.doc.map, at.tileset, at.rules, x, y);
        if (to === before.tile || before.stack) continue;
        const after = { ...before, tile: to };
        writeCell(this.doc.map, x, y, after);
        this.buffer.record(x, y, before, after);
        changed.push({ x, y });
      }
    }
    if (changed.length > 0) this.doc.emit({ type: 'cells', cells: changed });
    return changed.length;
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
  /** Prefabs instances in this scene follow (set by the app; used when loading and saving). */
  prefabs: ReadonlyMap<string, PrefabData> = new Map();
  private readonly listeners = new Set<DocListener>();
  private nextId = 1;
  /** The project's tiles and autotile rules; when there are rules, painting keeps every cell's look up to date. */
  autotile: { tileset: TileSet; rules: readonly AutotileRule[] } | null = null;
  /** The rules that make this scene's map (Generate panel), or null. */
  generator: GeneratorSpec | null = null;
  /** Which way gravity pulls in this scene ('-z', down, when not set). */
  gravity: GravityDir = '-z';
  /** Seconds a turn of gravity takes in this scene (not set: the project's rule, 0.25 with the timedGravity flag, else at once). */
  gravityTurn: number | undefined = undefined;
  /** May the game place and break blocks while it runs, and how many edits one run may make. */
  blockRules: { runtime: boolean; limit: number } = { runtime: false, limit: 200 };
  /** Returns false to refuse a change to a cell (a locked layer). */
  cellGuard: ((before: CellData, after: CellData) => boolean) | null = null;

  constructor(
    public name: string,
    public map: TileMap,
    public entities: EntityData[] = [],
    public regions: RegionData[] = [],
    public wires: WireData[] = [],
    public variables: VariableData[] = [],
    public events: EventRow[] = [],
    public graphs: GraphData[] = [],
  ) {
    this.nextId = this.computeNextId();
  }

  /** Open a scene; instances of prefabs are filled in from their prefab so every setting can be seen and edited. */
  static fromScene(scene: SceneData, prefabs: ReadonlyMap<string, PrefabData> = new Map()): EditorDoc {
    const copy = structuredClone(scene);
    const entities = copy.entities.map((e) => (e.prefab && prefabs.has(e.prefab) ? (resolveInstance(e, prefabs) ?? e) : e));
    const doc = new EditorDoc(copy.name, tileMapFromRows(copy.map), entities, copy.regions, copy.wires, copy.variables, copy.events, copy.graphs ?? []);
    doc.prefabs = prefabs;
    const rules = copy.generator ? GeneratorSpecSchema.safeParse(copy.generator) : null;
    doc.generator = rules?.success ? rules.data : null;
    doc.gravity = copy.gravity ?? '-z';
    doc.gravityTurn = copy.gravityTurn;
    doc.blockRules = { runtime: copy.blocks?.runtime ?? false, limit: copy.blocks?.limit ?? 200 };
    return doc;
  }

  toScene(): SceneData {
    return structuredClone({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: this.name,
      map: tileMapToRows(this.map),
      // instances are stored as just their overrides, so editing a prefab updates every instance
      entities: this.entities.map((e) => {
        const p = e.prefab ? this.prefabs.get(e.prefab) : undefined;
        return p ? collapseInstance(e, p, this.prefabs) : e;
      }),
      regions: this.regions,
      wires: this.wires,
      variables: this.variables,
      events: this.events,
      graphs: this.graphs,
      ...(this.generator ? { generator: this.generator } : {}),
      ...(this.gravity !== '-z' ? { gravity: this.gravity } : {}),
      ...(this.gravityTurn !== undefined ? { gravityTurn: this.gravityTurn } : {}),
      ...(this.blockRules.runtime ? { blocks: this.blockRules } : {}),
    });
  }

  /** Whether the game may place and break blocks while it runs, and the limit on edits (an undo step). */
  setBlockRules(rules: { runtime: boolean; limit: number }): void {
    const before = { ...this.blockRules };
    if (before.runtime === rules.runtime && before.limit === rules.limit) return;
    this.run({
      label: 'Blocks while playing',
      redo: () => {
        this.blockRules = { ...rules };
        this.emit({ type: 'events' });
      },
      undo: () => {
        this.blockRules = before;
        this.emit({ type: 'events' });
      },
    });
  }

  /** Which way gravity pulls in this scene (an undo step). */
  setGravity(dir: GravityDir): void {
    const before = this.gravity;
    if (before === dir) return;
    this.run({
      label: 'Turn gravity',
      redo: () => {
        this.gravity = dir;
        this.emit({ type: 'events' });
      },
      undo: () => {
        this.gravity = before;
        this.emit({ type: 'events' });
      },
    });
  }

  /** How long a turn of gravity takes in this scene, in seconds (an undo step); undefined goes back to the project's rule. */
  setGravityTurn(seconds: number | undefined): void {
    const before = this.gravityTurn;
    if (before === seconds) return;
    this.run({
      label: 'Change how long gravity takes to turn',
      redo: () => {
        this.gravityTurn = seconds;
        this.emit({ type: 'events' });
      },
      undo: () => {
        this.gravityTurn = before;
        this.emit({ type: 'events' });
      },
    });
  }

  private computeNextId(): number {
    let max = 0;
    for (const e of [...this.entities, ...this.regions, ...this.wires, ...this.events, ...this.graphs]) {
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

  /** Work out every cell's look from the autotile rules again, as one undo step. Returns how many cells changed. */
  reapplyAutotile(label = 'Apply autotiling'): number {
    const s = this.beginStroke(label);
    const n = s.resolveAll();
    s.commit();
    return n;
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

  /** Change the generator rules (an undo step). */
  setGenerator(label: string, spec: GeneratorSpec | null): void {
    const before = structuredClone(this.generator);
    const after = structuredClone(spec);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.run({
      label,
      redo: () => {
        this.generator = structuredClone(after);
        this.emit({ type: 'events' });
      },
      undo: () => {
        this.generator = structuredClone(before);
        this.emit({ type: 'events' });
      },
    });
  }

  /**
   * Make the map from the rules and keep it in the scene: the old map and every object the generator placed before are
   * replaced, the player (if there is one) is moved to the start. One undo step brings everything back.
   */
  applyGenerated(label: string, spec: GeneratorSpec, made: Generated): { problems: string[] } {
    const problems: string[] = [...made.notes];
    const oldMap = this.map;
    const oldEntities = structuredClone(this.entities);
    const oldGenerator = structuredClone(this.generator);
    const kept = this.entities.filter((e) => !e.tags.includes('generated'));
    const startH = groundHeightAt(made.map, made.start.x + 0.5, made.start.y + 0.5);
    const placed: EntityData[] = [];
    made.placements.forEach((p, i) => {
      const h = groundHeightAt(made.map, p.x, p.y);
      const inst: EntityData = { id: `gen${i + 1}`, name: p.prefab, tags: ['generated', ...(p.tag ? [p.tag] : [])], prefab: p.prefab, components: { transform: { x: p.x, y: p.y, h, facing: 2 } } };
      const resolved = this.prefabs.has(p.prefab) ? resolveInstance(inst, this.prefabs) : null;
      if (!resolved) {
        problems.push(`The prefab "${p.prefab}" does not exist, so nothing was placed for it.`);
        return;
      }
      placed.push({ ...resolved, id: `gen${i + 1}`, tags: [...new Set([...inst.tags, ...resolved.tags])] }); // the prefab's own tags come along (a monster stays on its side)
    });
    const moved = kept.map((e) => (e.tags.includes('player') && e.components.transform ? { ...e, components: { ...e.components, transform: { ...(e.components.transform as object), x: made.start.x + 0.5, y: made.start.y + 0.5, h: startH } } } : e));
    const newEntities = [...moved, ...placed];
    const after = structuredClone(spec);
    this.run({
      label,
      redo: () => {
        this.map = made.map;
        this.entities = structuredClone(newEntities);
        this.generator = structuredClone(after);
        this.emit({ type: 'map' });
        this.emit({ type: 'entities' });
        this.emit({ type: 'events' });
      },
      undo: () => {
        this.map = oldMap;
        this.entities = structuredClone(oldEntities);
        this.generator = structuredClone(oldGenerator);
        this.emit({ type: 'map' });
        this.emit({ type: 'entities' });
        this.emit({ type: 'events' });
      },
    });
    return { problems };
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

  /**
   * The project's prefabs changed (made, updated, deleted). Instances are re-filled from the new prefab,
   * keeping what was overridden on them. Not an undo step: it follows files on disk.
   */
  setPrefabs(next: ReadonlyMap<string, PrefabData>): void {
    const old = this.prefabs;
    this.entities = this.entities.map((e) => {
      const p = e.prefab ? old.get(e.prefab) : undefined;
      if (!e.prefab || !p) return e;
      const saved = collapseInstance(e, p, old);
      return next.has(e.prefab) ? (resolveInstance(saved, next) ?? e) : e;
    });
    this.prefabs = next;
    this.emit({ type: 'entities' });
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
    // the event and action nodes made for an object go with it
    const set = new Set(ids);
    for (const e of this.entities) {
      const owner = (e.components.quick as { owner?: string } | undefined)?.owner;
      if (owner && set.has(owner)) set.add(e.id);
    }
    const removed = this.entities.map((e, index) => ({ e: structuredClone(e), index })).filter((r) => set.has(r.e.id));
    if (removed.length === 0) return;
    const droppedWires = this.wires.map((w, index) => ({ w: structuredClone(w), index })).filter((r) => set.has(r.w.from.entity) || set.has(r.w.to.entity));
    this.run({
      label: removed.length > 1 ? `${label} (${removed.length})` : label,
      redo: () => {
        this.entities = this.entities.filter((e) => !set.has(e.id));
        this.wires = this.wires.filter((w) => !set.has(w.from.entity) && !set.has(w.to.entity));
        this.emit({ type: 'entities' });
        this.emit({ type: 'wires' });
      },
      undo: () => {
        for (const r of removed) this.entities.splice(r.index, 0, structuredClone(r.e));
        for (const r of droppedWires) this.wires.splice(r.index, 0, structuredClone(r.w));
        this.emit({ type: 'entities' });
        this.emit({ type: 'wires' });
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

  // ---- wires, variables, event sheet ----

  addWire(from: WireData['from'], to: WireData['to']): WireData | null {
    if (this.wires.some((w) => w.from.entity === from.entity && w.from.output === from.output && w.to.entity === to.entity && w.to.input === to.input)) return null;
    const wire: WireData = { id: this.newId('w'), from, to };
    this.run({
      label: 'Connect with a wire',
      redo: () => {
        this.wires.push(structuredClone(wire));
        this.emit({ type: 'wires' });
      },
      undo: () => {
        this.wires = this.wires.filter((w) => w.id !== wire.id);
        this.emit({ type: 'wires' });
      },
    });
    return wire;
  }

  removeWire(id: string): void {
    const index = this.wires.findIndex((w) => w.id === id);
    if (index < 0) return;
    const wire = structuredClone(this.wires[index]!);
    this.run({
      label: 'Remove wire',
      redo: () => {
        this.wires = this.wires.filter((w) => w.id !== id);
        this.emit({ type: 'wires' });
      },
      undo: () => {
        this.wires.splice(index, 0, structuredClone(wire));
        this.emit({ type: 'wires' });
      },
    });
  }

  /** Replace the whole event sheet (every edit in the sheet editor is one undo step). */
  setEvents(label: string, rows: EventRow[]): void {
    const before = structuredClone(this.events);
    const after = structuredClone(rows);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.run({
      label,
      redo: () => {
        this.events = structuredClone(after);
        this.emit({ type: 'events' });
      },
      undo: () => {
        this.events = structuredClone(before);
        this.emit({ type: 'events' });
      },
    });
  }

  /** Replace all the logic graphs (every edit in the graph editor is one undo step). */
  setGraphs(label: string, graphs: GraphData[]): void {
    const before = structuredClone(this.graphs);
    const after = structuredClone(graphs);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.run({
      label,
      redo: () => {
        this.graphs = structuredClone(after);
        this.emit({ type: 'graphs' });
      },
      undo: () => {
        this.graphs = structuredClone(before);
        this.emit({ type: 'graphs' });
      },
    });
  }

  setVariables(label: string, vars: VariableData[]): void {
    const before = structuredClone(this.variables);
    const after = structuredClone(vars);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.run({
      label,
      redo: () => {
        this.variables = structuredClone(after);
        this.emit({ type: 'events' });
      },
      undo: () => {
        this.variables = structuredClone(before);
        this.emit({ type: 'events' });
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
