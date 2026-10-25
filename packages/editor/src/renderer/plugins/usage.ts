import type { EventRow, SceneData, UiDoc, UiNode } from '@tilewright/runtime';
import { host } from '@tilewright/behaviors';

/**
 * What in a project depends on a plugin: the objects that carry its behaviours and components, the event rows that use its blocks,
 * the screens that use its widgets, and the records of the kinds of data it keeps. Said before the plugin is turned off or taken away,
 * so the person knows what will stop working (nothing is deleted: it is kept in the files and works again with the plugin).
 */
export interface PluginUsage {
  objects: { what: string; count: number; scenes: string[] }[];
  rows: { what: string; count: number; scenes: string[] }[];
  screens: { what: string; count: number }[];
  data: { what: string; file: string; count: number }[];
}

function* rowsOf(rows: readonly EventRow[]): Generator<EventRow> {
  for (const r of rows) {
    yield r;
    yield* rowsOf(r.children);
  }
}

function* nodesOf(n: UiNode): Generator<UiNode> {
  yield n;
  for (const c of n.children) yield* nodesOf(c);
}

const sceneName = (path: string): string => path.replace(/^.*\//, '').replace('.scene.json', '');

export function pluginUsage(
  id: string,
  scenes: ReadonlyMap<string, SceneData>,
  ui: UiDoc,
  records: (kind: string) => number,
): PluginUsage {
  const contents = host.contentsOf(id);
  const behaviours = new Set(contents?.behaviors ?? []);
  const components = new Set([...host.ext.components.values()].filter((c) => c.plugin === id).map((c) => c.id));
  const conditions = new Set(contents?.conditions ?? []);
  const actions = new Set(contents?.actions ?? []);
  const widgets = new Set([...host.ext.widgets.values()].filter((w) => w.plugin === id).map((w) => w.id));
  const objects = new Map<string, { count: number; scenes: Set<string> }>();
  const rows = new Map<string, { count: number; scenes: Set<string> }>();
  const bump = (m: typeof objects, what: string, scene: string): void => {
    const v = m.get(what) ?? { count: 0, scenes: new Set<string>() };
    v.count++;
    v.scenes.add(sceneName(scene));
    m.set(what, v);
  };
  for (const [path, scene] of scenes) {
    for (const e of scene.entities) {
      for (const key of Object.keys(e.components)) {
        if (behaviours.has(key)) bump(objects, `the behaviour ${key}`, path);
        else if (components.has(key)) bump(objects, `the component ${key}`, path);
      }
    }
    for (const row of rowsOf(scene.events)) {
      for (const c of row.conditions) if (conditions.has(c.type)) bump(rows, `the condition ${c.type}`, path);
      for (const a of row.actions) if (actions.has(a.type)) bump(rows, `the action ${a.type}`, path);
    }
  }
  const screens = new Map<string, number>();
  for (const s of ui.screens) for (const n of nodesOf(s.root)) if (n.type === 'plugin' && widgets.has(n.source)) screens.set(s.name, (screens.get(s.name) ?? 0) + 1);
  const data = [...host.ext.dataKinds.values()]
    .filter((k) => k.plugin === id)
    .map((k) => ({ what: k.label.toLowerCase(), file: k.file, count: records(k.id) }))
    .filter((d) => d.count > 0);
  const list = (m: typeof objects): PluginUsage['objects'] => [...m].map(([what, v]) => ({ what, count: v.count, scenes: [...v.scenes].sort() })).sort((a, b) => b.count - a.count);
  return { objects: list(objects), rows: list(rows), screens: [...screens].map(([what, count]) => ({ what, count })), data };
}

/** The lines to show: what stops working, in plain words. Empty when nothing does. */
export function describeUsage(u: PluginUsage): string[] {
  const out: string[] = [];
  const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  for (const o of u.objects) out.push(`${plural(o.count, 'object', 'objects')} with ${o.what} (in ${o.scenes.join(', ')}) will stop doing it.`);
  for (const r of u.rows) out.push(`${plural(r.count, 'event row', 'event rows')} that use ${r.what} (in ${r.scenes.join(', ')}) will stop working.`);
  for (const s of u.screens) out.push(`The screen "${s.what}" has ${plural(s.count, 'piece', 'pieces')} that will be empty.`);
  for (const d of u.data) out.push(`The ${d.count} ${d.what} in ${d.file} will not load (they stay in the file).`);
  return out;
}
