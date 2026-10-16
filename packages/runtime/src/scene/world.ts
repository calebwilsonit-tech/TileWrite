export type EntityId = number;

export interface EntityInit {
  name?: string;
  tags?: Iterable<string>;
  components?: Record<string, unknown>;
}

export class Entity {
  /** False once destroyed. Stale handles must check this (or use EntityRef). */
  alive = true;
  /** True until the world flushes a spawn that happened mid-tick. */
  pending = false;
  readonly tags = new Set<string>();
  readonly components = new Map<string, unknown>();

  constructor(
    readonly id: EntityId,
    public name: string,
  ) {}

  has(component: string): boolean {
    return this.components.has(component);
  }

  get<T>(component: string): T | undefined {
    return this.components.get(component) as T | undefined;
  }

  /** Like get, but throws a readable error if the component is missing. */
  require<T>(component: string): T {
    const c = this.components.get(component);
    if (c === undefined) {
      throw new Error(`Entity "${this.name}" (#${this.id}) has no "${component}" component.`);
    }
    return c as T;
  }

  set<T>(component: string, data: T): this {
    this.components.set(component, data);
    return this;
  }

  remove(component: string): boolean {
    return this.components.delete(component);
  }
}

/** A handle that stays safe after the entity is destroyed. */
export class EntityRef {
  constructor(
    private readonly world: World,
    readonly id: EntityId,
  ) {}

  /** The entity, or undefined if it was destroyed. */
  get(): Entity | undefined {
    return this.world.get(this.id);
  }

  get alive(): boolean {
    return this.get() !== undefined;
  }
}

/**
 * Entities and their components.
 *
 * Ids increase forever and are never reused, so a stale id can never point at a different entity.
 * While a tick is running, spawns are invisible to queries and destroyed entities are skipped
 * immediately; both are settled by `flush()` at the end of the tick. Queries return snapshots,
 * so a loop can spawn and destroy freely.
 */
export class World {
  private nextId = 1;
  private readonly entities = new Map<EntityId, Entity>();
  private readonly doomed: Entity[] = [];
  private readonly spawned: Entity[] = [];
  private depth = 0;

  get inTick(): boolean {
    return this.depth > 0;
  }

  beginTick(): void {
    this.depth++;
  }

  endTick(): void {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) this.flush();
  }

  spawn(init: EntityInit = {}): Entity {
    const e = new Entity(this.nextId++, init.name ?? `entity_${this.nextId - 1}`);
    for (const t of init.tags ?? []) e.tags.add(t);
    for (const [k, v] of Object.entries(init.components ?? {})) e.components.set(k, v);
    this.entities.set(e.id, e);
    if (this.inTick) {
      e.pending = true;
      this.spawned.push(e);
    }
    return e;
  }

  /** Destroy by id or entity. Safe to call twice and safe on stale ids. */
  destroy(target: EntityId | Entity): void {
    const e = typeof target === 'number' ? this.entities.get(target) : target;
    if (!e || !e.alive) return;
    e.alive = false;
    if (this.inTick) this.doomed.push(e);
    else this.entities.delete(e.id);
  }

  /** The live entity with this id, or undefined (destroyed, never existed, or not yet spawned). */
  get(id: EntityId): Entity | undefined {
    const e = this.entities.get(id);
    return e && e.alive ? e : undefined;
  }

  ref(id: EntityId): EntityRef {
    return new EntityRef(this, id);
  }

  get count(): number {
    let n = 0;
    for (const e of this.entities.values()) if (e.alive && !e.pending) n++;
    return n;
  }

  /** Snapshot of all live, non-pending entities in id order. */
  all(): Entity[] {
    const out: Entity[] = [];
    for (const e of this.entities.values()) if (e.alive && !e.pending) out.push(e);
    return out;
  }

  /** Entities that have every listed component. */
  query(...components: string[]): Entity[] {
    return this.all().filter((e) => components.every((c) => e.components.has(c)));
  }

  withTag(tag: string): Entity[] {
    return this.all().filter((e) => e.tags.has(tag));
  }

  findByName(name: string): Entity | undefined {
    return this.all().find((e) => e.name === name);
  }

  /** Make mid-tick spawns visible and forget destroyed entities. */
  flush(): void {
    for (const e of this.spawned) e.pending = false;
    this.spawned.length = 0;
    for (const e of this.doomed) this.entities.delete(e.id);
    this.doomed.length = 0;
  }

  clear(): void {
    this.entities.clear();
    this.doomed.length = 0;
    this.spawned.length = 0;
  }
}
