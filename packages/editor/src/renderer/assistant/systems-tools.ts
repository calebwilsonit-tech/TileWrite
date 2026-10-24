import { GENERATOR_NAMES, TableSchema, UiScreenSchema, generate, roleOfScreen, newGeneratorSpec, type TableData, type VariableData } from '@tilewright/runtime';
import { listPacks, packContents } from '@tilewright/behaviors';
import { lineDiff, type ToolOutput } from '@tilewright/assistant';
import { store } from '../app/store';
import { listTemplates } from '../project/templates';
import { checkUiDoc } from '../uidesigner/ui-edit';
import { fail, json, requireEditing, undoTop, type Proposal } from './tool-core';

const text = (t: string): ToolOutput => ({ content: t });

/** The widget tree as an outline: type, name and how many children, indented. */
function outline(node: { type: string; name: string; children?: unknown }, depth = 0): string[] {
  const kids = (Array.isArray(node.children) ? node.children : []) as { type: string; name: string; children?: unknown }[];
  return [`${'  '.repeat(depth)}${node.type} "${node.name}"`, ...kids.flatMap((k) => outline(k, depth + 1))];
}

/** Reading tools about plugins, templates, tables and interface screens. Null when the name is not one of them. */
export async function runSystemsRead(name: string, input: Record<string, unknown>): Promise<ToolOutput | null> {
  switch (name) {
    case 'list_plugins': {
      const p = store.state.project?.project;
      if (!p) return fail('No project is open.');
      const on = new Set(p.plugins ?? listPacks().filter((x) => x.active).map((x) => x.id));
      return text(
        json(
          listPacks().map((x) => ({ id: x.id, name: x.name, on: on.has(x.id), needs: x.requires, description: x.description, adds: packContents(x.id)?.behaviors ?? [] })),
        ),
      );
    }
    case 'list_templates':
      return text(json(listTemplates().map((t) => ({ id: t.id, name: t.name, description: t.description, plugins: t.build('x').project.plugins }))));
    case 'get_tables': {
      const names = input.names as string[] | undefined;
      const list = store.tables.filter((t) => !names || names.includes(t.name));
      return text(list.length === 0 ? '(There are no data tables yet.)' : json(list, 0));
    }
    case 'get_ui_screens': {
      const doc = store.uiDoc;
      const wanted = input.screen as string | undefined;
      if (wanted) {
        const s = doc.screens.find((x) => x.name === wanted || x.id === wanted);
        return s ? text(json(s, 0)) : fail(`There is no screen "${wanted}". The screens are: ${doc.screens.map((x) => x.name).join(', ') || '(none)'}.`);
      }
      return text(doc.screens.length === 0 ? '(No interface screens yet.)' : doc.screens.map((s) => `${s.name} (id ${s.id})${roleOfScreen(s) && roleOfScreen(s) !== s.name.toLowerCase() ? ` role ${roleOfScreen(s)}` : ''}${s.opensOnStart ? ' opens on start' : ''}${s.modal ? ' modal' : ''}\n${outline(s.root as never).join('\n')}`).join('\n\n'));
    }
    default:
      return null;
  }
}

function setPacks(input: Record<string, unknown>): Proposal {
  const p = store.state.project?.project;
  if (!p) return fail('No project is open.');
  const all = listPacks();
  const known = new Set(all.map((x) => x.id));
  const enable = (input.enable as string[] | undefined) ?? [];
  const disable = (input.disable as string[] | undefined) ?? [];
  for (const id of [...enable, ...disable]) if (!known.has(id)) fail(`There is no plugin "${id}". The plugins are: ${[...known].join(', ')}.`);
  const before = [...(p.plugins ?? all.filter((x) => x.active).map((x) => x.id))];
  const next = new Set(before);
  for (const id of enable) {
    next.add(id);
    for (const dep of all.find((x) => x.id === id)?.requires ?? []) next.add(dep);
  }
  for (const id of disable) {
    next.delete(id);
    for (const x of all) if (x.requires.includes(id)) next.delete(x.id);
  }
  const after = [...next];
  const added = after.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !next.has(id));
  if (added.length === 0 && removed.length === 0) fail('The game already has exactly those plugins.');
  return {
    tool: 'set_plugins',
    title: 'Change the plugins',
    lines: [...added.map((id) => `Switch on ${all.find((x) => x.id === id)?.name ?? id}`), ...removed.map((id) => `Switch off ${all.find((x) => x.id === id)?.name ?? id}`)],
    async apply() {
      const ok = await store.updateProjectSettings({ plugins: after });
      return ok ? `The game now uses: ${after.join(', ') || '(no plugins)'}. list_behaviors and list_event_blocks show what that adds.` : fail('The settings could not be saved.');
    },
    async undo() {
      return store.updateProjectSettings({ plugins: before });
    },
  };
}

function writeTable(input: Record<string, unknown>): Proposal {
  const parsed = TableSchema.safeParse({ ...input });
  if (!parsed.success) return fail(`The table is not valid: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const t = parsed.data;
  const ids = new Set(t.columns.map((c) => c.id));
  const seen = new Set<string>();
  for (const r of t.rows) {
    if (seen.has(r.id)) fail(`Two rows have the id "${r.id}".`);
    seen.add(r.id);
    for (const k of Object.keys(r)) if (k !== 'id' && !ids.has(k)) fail(`The row "${r.id}" has a value "${k}" but there is no column with that id. The columns are: ${[...ids].join(', ')}.`);
  }
  if (ids.size !== t.columns.length) fail('Two columns have the same id.');
  const previous = store.tables.find((x) => x.name === t.name);
  const show = (x: TableData | undefined): string => (x ? [x.columns.map((c) => `${c.id}:${c.type}`).join(' | '), ...x.rows.map((r) => x.columns.map((c) => String(r[c.id] ?? '')).join(' | '))].join('\n') : '');
  return {
    tool: 'write_table',
    title: previous ? `Replace the table ${t.name}` : `New table ${t.name}`,
    lines: [`${previous ? 'Replace' : 'Create'} the table "${t.name}": ${t.columns.length} columns, ${t.rows.length} rows.`],
    diff: { name: `${t.name}.table.json`, lines: lineDiff(show(previous), show(t)) },
    async apply() {
      store.setTable(t);
      await store.flushStory();
      return `The table "${t.name}" is saved with ${t.rows.length} rows.`;
    },
    async undo() {
      if (previous) store.setTable(previous);
      else await store.removeTable(t.name);
      await store.flushStory();
      return true;
    },
  };
}

function setVariables(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const list = input.variables as VariableData[];
  const before = structuredClone(doc.variables);
  const after = structuredClone(before);
  for (const v of list) {
    const i = after.findIndex((x) => x.name === v.name);
    if (i >= 0) after[i] = { ...after[i]!, value: v.value };
    else after.push({ name: v.name, value: v.value });
  }
  const label = 'Claude: set the variables';
  return {
    tool: 'set_variables',
    title: 'Set starting variables',
    lines: list.map((v) => `${v.name} starts as ${JSON.stringify(v.value)}`),
    async apply() {
      doc.setVariables(label, after);
      return `The scene now starts with ${after.length} variable(s).`;
    },
    undo: undoTop(doc, label),
  };
}

function generateMap(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const kind = input.kind as 'dungeon' | 'cave' | 'island' | 'town';
  const spec = { ...newGeneratorSpec(kind), width: Number(input.width), height: Number(input.height), ...(input.seed !== undefined ? { seed: Number(input.seed) } : {}), ...(input.lockSeed !== undefined ? { lockSeed: input.lockSeed === true } : {}), ...(input.atStart !== undefined ? { atStart: input.atStart === true } : {}) };
  const label = `Generate ${GENERATOR_NAMES[kind].toLowerCase()}`;
  return {
    tool: 'generate_map',
    title: 'Generate the map',
    lines: [`Make a ${spec.width} x ${spec.height} ${GENERATOR_NAMES[kind].toLowerCase()} from seed ${spec.seed}${spec.atStart ? ', made again each time the game starts' : ''}.`, 'The tiles are replaced; objects stay where they are.'],
    async apply() {
      const result = doc.applyGenerated(label, spec, generate(spec));
      return `The map was made (seed ${spec.seed}).${result.problems.length > 0 ? ` Remarks: ${result.problems.join(' | ')}` : ''}`;
    },
    undo: undoTop(doc, label),
  };
}

function writeUiScreen(input: Record<string, unknown>): Proposal {
  const parsed = UiScreenSchema.safeParse(input.screen);
  if (!parsed.success) return fail(`The screen is not valid: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const screen = parsed.data;
  const before = store.uiDoc;
  const exists = before.screens.some((s) => s.id === screen.id || s.name === screen.name);
  const next = { ...before, screens: exists ? before.screens.map((s) => (s.id === screen.id || s.name === screen.name ? screen : s)) : [...before.screens, screen] };
  const problems = checkUiDoc(next, { tables: new Set(store.tables.map((t) => t.name)) });
  return {
    tool: 'write_ui_screen',
    title: exists ? `Replace the screen ${screen.name}` : `New screen ${screen.name}`,
    lines: [`${exists ? 'Replace' : 'Add'} the screen "${screen.name}".`, ...problems.slice(0, 5).map((p) => `Warning: ${p}`)],
    async apply() {
      store.setUiDoc(next);
      await store.flushStory();
      return `The screen "${screen.name}" is saved.${problems.length ? ` The checker reports: ${problems.slice(0, 5).join(' | ')}` : ' The checker found no problems.'}`;
    },
    async undo() {
      store.setUiDoc(before);
      await store.flushStory();
      return true;
    },
  };
}

/** Action tools for plugins, tables, variables, procedural maps and interface screens. Null when the name is not one of them. */
export function prepareSystemsAction(name: string, input: Record<string, unknown>): Proposal | null {
  switch (name) {
    case 'set_plugins':
      return setPacks(input);
    case 'write_table':
      return writeTable(input);
    case 'set_variables':
      return setVariables(input);
    case 'generate_map':
      return generateMap(input);
    case 'write_ui_screen':
      return writeUiScreen(input);
    default:
      return null;
  }
}
