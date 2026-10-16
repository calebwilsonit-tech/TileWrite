import { CURRENT_SCHEMA_VERSION, type EntityData, type PrefabData, type PrefabNode } from './schema';

export type PrefabMap = ReadonlyMap<string, PrefabData>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `over` laid on top of `base`: objects merge key by key, everything else (numbers, arrays, ...) is replaced. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined) return structuredClone(base);
  if (isObject(base) && isObject(over)) {
    const out: Record<string, unknown> = structuredClone(base);
    for (const [k, v] of Object.entries(over)) out[k] = k in out ? deepMerge(out[k], v) : structuredClone(v);
    return out as T;
  }
  return structuredClone(over) as T;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The smallest overrides that turn `base` into `actual` (only what differs). Returns undefined if nothing differs.
 * Keys that exist only in `base` cannot be expressed as overrides and are ignored.
 */
export function diffOverrides(base: unknown, actual: unknown): unknown {
  if (isObject(base) && isObject(actual)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(actual)) {
      if (!(k in base)) {
        out[k] = structuredClone(v);
        continue;
      }
      const d = diffOverrides(base[k], v);
      if (d !== undefined) out[k] = d;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return same(base, actual) ? undefined : structuredClone(actual);
}

export const MAX_PREFAB_DEPTH = 8;

interface Transform3 {
  x: number;
  y: number;
  h: number;
}

function offsetTransform(components: Record<string, unknown>, parent: Transform3 | undefined): void {
  const t = components.transform as Partial<Transform3> | undefined;
  if (!t || !parent) return;
  t.x = (t.x ?? 0) + parent.x;
  t.y = (t.y ?? 0) + parent.y;
  t.h = (t.h ?? 0) + parent.h;
}

/** The base components of a prefab node: its own components over those of the prefab it is an instance of. */
function nodeComponents(node: PrefabNode, prefabs: PrefabMap, depth: number, problems: string[], trail: string[]): { components: Record<string, unknown>; tags: string[] } {
  let components: Record<string, unknown> = {};
  let tags: string[] = [];
  if (node.prefab) {
    const inner = prefabs.get(node.prefab);
    if (!inner) problems.push(`The prefab "${node.prefab}" used inside "${node.name}" does not exist.`);
    else if (trail.includes(inner.name) || depth >= MAX_PREFAB_DEPTH) problems.push(`The prefab "${inner.name}" contains itself (directly or through other prefabs).`);
    else {
      const base = nodeComponents(inner.root, prefabs, depth + 1, problems, [...trail, inner.name]);
      components = base.components;
      tags = base.tags;
    }
  }
  return { components: deepMerge(components, node.components), tags: [...new Set([...tags, ...node.tags])] };
}

export interface ExpandResult {
  entities: EntityData[];
  problems: string[];
}

function expandNode(node: PrefabNode, id: string, prefabs: PrefabMap, parent: Transform3 | undefined, problems: string[], depth: number, trail: string[], out: EntityData[], instance?: { name: string; tags: string[]; components: Record<string, unknown> }): void {
  const base = nodeComponents(node, prefabs, depth, problems, trail);
  let components = base.components;
  let tags = base.tags;
  let name = node.name;
  if (instance) {
    components = deepMerge(components, instance.components);
    tags = [...new Set([...tags, ...instance.tags])];
    if (instance.name) name = instance.name;
  } else offsetTransform(components, parent);
  const t = components.transform as Partial<Transform3> | undefined;
  const here: Transform3 | undefined = t ? { x: t.x ?? 0, y: t.y ?? 0, h: t.h ?? 0 } : parent;
  out.push({ id, name, tags, components });
  // parts that come with a nested prefab
  const innerChildren: PrefabNode[] = [];
  const collect = (n: PrefabNode, d: number, tr: string[]): void => {
    if (n.prefab) {
      const inner = prefabs.get(n.prefab);
      if (inner && !tr.includes(inner.name) && d < MAX_PREFAB_DEPTH) collect(inner.root, d + 1, [...tr, inner.name]);
    }
    innerChildren.push(...n.children);
  };
  collect(node, depth, trail);
  innerChildren.forEach((child, i) => expandNode(child, `${id}.${i + 1}`, prefabs, here, problems, depth + 1, trail, out));
}

/**
 * Turn the entities of a scene into plain entities: instances of prefabs are filled in from their prefab
 * (plus overrides), and the parts a prefab brings along are added with ids like `e5.1`.
 */
export function expandEntities(entities: readonly EntityData[], prefabs: PrefabMap): ExpandResult {
  const out: EntityData[] = [];
  const problems: string[] = [];
  for (const e of entities) {
    if (!e.prefab) {
      out.push(structuredClone(e));
      continue;
    }
    const prefab = prefabs.get(e.prefab);
    if (!prefab) {
      problems.push(`"${e.name}" is an instance of the prefab "${e.prefab}", which does not exist.`);
      continue;
    }
    expandNode(prefab.root, e.id, prefabs, undefined, problems, 0, [prefab.name], out, { name: e.name, tags: e.tags, components: e.components });
  }
  return { entities: out, problems };
}

/** A prefab made from an object in the scene (its position is reset so every instance starts at the origin). */
export function extractPrefab(entity: EntityData, name: string): PrefabData {
  const components = structuredClone(entity.components);
  const t = components.transform as Partial<Transform3> | undefined;
  if (t) {
    t.x = 0;
    t.y = 0;
    t.h = 0;
  }
  return { schemaVersion: CURRENT_SCHEMA_VERSION, name, root: { name, tags: [...entity.tags], components, children: [] } };
}

/**
 * How an instance is stored in a scene: only what differs from its prefab. The instance's own position is
 * always kept (it is almost always different).
 */
export function collapseInstance(resolved: EntityData, prefab: PrefabData, prefabs: PrefabMap): EntityData {
  const problems: string[] = [];
  const base = nodeComponents(prefab.root, prefabs, 0, problems, [prefab.name]);
  const diff = (diffOverrides(base.components, resolved.components) ?? {}) as Record<string, unknown>;
  const t = resolved.components.transform as Partial<Transform3> | undefined;
  if (t) diff.transform = { ...((diff.transform as object) ?? {}), x: t.x, y: t.y, h: t.h };
  return { id: resolved.id, name: resolved.name, tags: resolved.tags.filter((tag) => !base.tags.includes(tag)), components: diff, prefab: prefab.name };
}

/** Fill in one instance from its prefab so the editor can show and edit all of its settings. */
export function resolveInstance(instance: EntityData, prefabs: PrefabMap): EntityData | null {
  if (!instance.prefab) return structuredClone(instance);
  const r = expandEntities([instance], prefabs);
  const root = r.entities[0];
  return root ? { ...root, prefab: instance.prefab } : null;
}
