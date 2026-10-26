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

/** The values the pieces of a control (a slider's thumb, a pop-up's option, a scrollbar, a marker) can read; they are in view only inside those pieces. */
export const CONTROL_VALUES: [string, string][] = [
  ['slider.value', 'Slider: its value'],
  ['slider.value2', 'Slider: the second thumb’s value (a range)'],
  ['slider.fraction', 'Slider: how far along (0 to 1)'],
  ['slider.percent', 'Slider: how far along (0 to 100)'],
  ['slider.text', 'Slider: the value as words'],
  ['slider.dragging', 'Slider: 1 while it is held'],
  ['option.label', 'Pop-up option: its words'],
  ['option.value', 'Pop-up option: its value'],
  ['option.detail', 'Pop-up option: its description'],
  ['option.group', 'Pop-up option: its group'],
  ['option.chosen', 'Pop-up option: 1 when chosen'],
  ['option.highlight', 'Pop-up option: 1 when it is the highlighted one'],
  ['popup.text', 'Choice list: what is chosen, as words'],
  ['popup.open', 'Choice list: 1 while open'],
  ['popup.query', 'Choice list: the search words typed'],
  ['scroll.pos', 'Scroller: how far it has gone (0 to 1)'],
  ['scroll.row', 'Scroller: the first row in view'],
  ['scroll.rows', 'Scroller: how many rows are in view'],
  ['scroll.hidden_before', 'Scroller: rows out of view before'],
  ['scroll.hidden_after', 'Scroller: rows out of view after'],
  ['scroll.page', 'Scroller: the page in view'],
  ['scroll.pages', 'Scroller: how many pages'],
  ['scroll.top', 'Scroller: 1 at the start'],
  ['scroll.bottom', 'Scroller: 1 at the end'],
  ['field.text', 'Field: the words typed'],
  ['field.placeholder', 'Field: the hint'],
  ['field.empty', 'Field: 1 when nothing is typed'],
  ['field.editing', 'Field: 1 while being typed in'],
  ['toggle.on', 'Tick box: 1 when ticked'],
  ['tab.name', 'Tab: its name'],
  ['tab.selected', 'Tab: 1 when it is the one showing'],
  ['bind.name', 'Key binding: the control’s name'],
  ['bind.key', 'Key binding: the key or button'],
  ['marker.id', 'Map marker: its id'],
  ['marker.label', 'Map marker: its words'],
  ['marker.state', 'Map marker: its state'],
  ['marker.highlight', 'Map marker: 1 when highlighted'],
  ['marker.count', 'Map marker: how many a group stands for'],
  ['marker.revealed', 'Map marker: 1 when its place is known (fog)'],
  ['map.zoom', 'Map: the zoom'],
  ['map.distance', 'Map marker: cells from the player'],
];

export function bindingChoices(doc: UiDoc, widgetId: string | null, facts: BindingFacts): BindingChoice[] {
  const out: BindingChoice[] = widgetId ? scopeNames(doc, widgetId, facts.tables) : [];
  for (const v of [...new Set(facts.variables)].sort()) out.push({ path: v, label: v, group: 'Variables (flags and counters)' });
  for (const v of BUILTIN_VARS) out.push({ path: v, label: v, group: 'Game state' });
  for (const [path, label] of HOST_VALUES) out.push({ path, label, group: 'The game and its screens' });
  for (const s of SETTINGS) out.push({ path: `settings.${s}`, label: `settings.${s}`, group: 'Player settings' });
  for (const [path, label] of CONTROL_VALUES) out.push({ path, label, group: 'Inside the parts of a control' });
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
