import { rowVariables, HOST_VALUES } from '@tilewright/behaviors';
import { findWidget, walkWidgets, type UiDoc, type UiNode, type TableData } from '@tilewright/runtime';

/** Everything a widget can be tied to, grouped for the binding picker. */
export interface BindingChoice {
  /** How it is written in a text: the part that goes between { and }. */
  path: string;
  label: string;
  group: string;
}

export interface BindingFacts {
  variables: readonly string[];
  tables: readonly TableData[];
  /** What can be carried, and the variable that holds how many are carried (from the plugin that keeps the inventory). */
  carried: readonly { name: string; variable: string }[];
  /** Objects of the open scene and the numeric fields of their parts: `Player.health.hp`. */
  objects: readonly { name: string; fields: readonly string[] }[];
}

const SETTINGS = ['master', 'music', 'sfx', 'voice', 'cameraZoom', 'screenShake', 'showFps', 'fullscreen', 'difficulty', 'language'];
const BUILTIN_VARS = ['run.count', 'run.seed', 'time.hour', 'time.clock', 'time.day', 'time.seasonName', 'wave.index', 'wave.total', 'wave.alive', 'turn.round'];

/** The values in view where a widget sits: inside a list of table rows, `row.name` is the cell of the row it is repeating. */
export function scopeNames(doc: UiDoc, widgetId: string, tables: readonly TableData[]): BindingChoice[] {
  const out: BindingChoice[] = [];
  const roots = [...doc.screens.map((s) => s.root), ...doc.prefabs.map((p) => p.widget)];
  const chain: UiNode[] = [];
  const find = (node: UiNode, path: UiNode[]): boolean => {
    if (node.id === widgetId) {
      chain.push(...path, node);
      return true;
    }
    return node.children.some((c) => find(c, [...path, node]));
  };
  for (const r of roots) if (find(r, [])) break;
  // a prefab used as a template: its repeats come from whatever lists use it
  if (chain.length === 0) return out;
  const rootPrefab = doc.prefabs.find((p) => p.widget.id === chain[0]!.id);
  const repeaters = chain.filter((w) => ['list', 'grid', 'hand', 'turnOrder'].includes(w.type));
  if (rootPrefab) {
    for (const r of roots) walkWidgets(r, (w) => w.template === rootPrefab.name && repeaters.push(w));
  }
  const seen = new Set<string>();
  for (const r of repeaters) {
    const src = r.source;
    const add = (path: string, label: string): void => {
      if (seen.has(path)) return;
      seen.add(path);
      out.push({ path, label, group: `In the list "${r.name}"` });
    };
    add('index', 'Which number this one is (1, 2, 3...)');
    if (src.startsWith('table:')) {
      add('row.id', 'The row\'s id');
      const t = tables.find((x) => x.name === src.slice(6));
      for (const c of t?.columns ?? []) add(`row.${c.id}`, `${c.label ?? c.id} (this row)`);
    } else for (const [name, label] of rowVariables(r.type === 'turnOrder' && src === '' ? 'turns' : src)) add(name, label);
  }
  return out;
}

export function bindingChoices(doc: UiDoc, widgetId: string | null, facts: BindingFacts): BindingChoice[] {
  const out: BindingChoice[] = widgetId ? scopeNames(doc, widgetId, facts.tables) : [];
  for (const v of [...new Set(facts.variables)].sort()) out.push({ path: v, label: v, group: 'Variables (flags and counters)' });
  for (const v of BUILTIN_VARS) out.push({ path: v, label: v, group: 'Game state' });
  for (const [path, label] of HOST_VALUES) out.push({ path, label, group: 'The game and its screens' });
  for (const s of SETTINGS) out.push({ path: `settings.${s}`, label: `settings.${s}`, group: 'Player settings' });
  for (const c of facts.carried) out.push({ path: c.variable, label: `How many "${c.name}" are carried`, group: 'Things carried' });
  for (const t of facts.tables) {
    for (const r of t.rows.slice(0, 60)) {
      for (const c of t.columns) out.push({ path: `${t.name}.${r.id}.${c.id}`, label: `${t.name} → ${r.id} → ${c.id}`, group: `Table ${t.name}` });
    }
  }
  for (const o of facts.objects) for (const f of o.fields) out.push({ path: `@${o.name}.${f}`, label: `${o.name} → ${f.replace(/\./g, ' → ')}`, group: 'Objects in this scene' });
  return out;
}

/** Words typed with {names} in them: the names. */
export function namesUsed(text: string): string[] {
  return [...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]!.trim());
}

/** The numeric fields of a component, as `component.field` (for the picker's object list). */
export function numericFields(components: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(components)) {
    if (name === 'meta' || name === 'transform' || typeof value !== 'object' || value === null) continue;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') out.push(`${name}.${k}`);
  }
  return out.slice(0, 40);
}

export { findWidget };
