import { useEffect, useMemo, useState } from 'react';
import { customNameProblem } from '@tilewright/behaviors';
import {
  COLUMN_TYPES,
  COLUMN_TYPE_NAMES,
  FIELD_TYPES,
  FIELD_TYPE_NAMES,
  checkFields,
  checkTable,
  coerceCell,
  csvIntoTable,
  defaultCell,
  freshRowId,
  newCustomBehavior,
  newCustomComponent,
  newRow,
  newTable,
  tableCell,
  tableToCsv,
  type Column,
  type ColumnType,
  type CustomBehaviorData,
  type CustomComponentData,
  type CustomField,
  type CustomFieldType,
  type TableData,
} from '@tilewright/runtime';
import { store, useApp } from '../app/store';
import { useStudio } from '../studio/store';
import { RowsEditor } from './EventsPanel';
import { CheckField, NumberField, SelectField, TextField } from './fields';

type Tab = 'tables' | 'components' | 'behaviours' | 'events';
const TABS: { id: Tab; label: string }[] = [
  { id: 'tables', label: 'Tables' },
  { id: 'components', label: 'Components' },
  { id: 'behaviours', label: 'Behaviours' },
  { id: 'events', label: 'Events' },
];

/**
 * Your own game data and building blocks, with no code: data tables (spreadsheets of units, items, recipes, waves...),
 * custom components (named, typed settings an object carries), custom behaviours (event rows with settings of their own,
 * reusable on any object) and custom events.
 */
export function DataPanel() {
  useApp((s) => s.storyVersion);
  const [tab, setTab] = useState<Tab>('tables');
  return (
    <div className="story-panel" data-testid="data-panel">
      <div className="seg" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} data-testid={`data-tab-${t.id}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'tables' && <TablesTab />}
      {tab === 'components' && <ComponentsTab />}
      {tab === 'behaviours' && <BehavioursTab />}
      {tab === 'events' && <EventsTab />}
    </div>
  );
}

/** A name box with a Create button; shows why a name cannot be used. */
function NewName({ testId, placeholder, onCreate, problem }: { testId: string; placeholder: string; onCreate(name: string): void; problem(name: string): string | null }) {
  const [name, setName] = useState('');
  const [why, setWhy] = useState('');
  const go = (): void => {
    const bad = problem(name.trim());
    if (bad) return setWhy(bad);
    setWhy('');
    onCreate(name.trim());
    setName('');
  };
  return (
    <div>
      <div className="row">
        <input data-testid={`${testId}-name`} placeholder={placeholder} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        <button data-testid={`${testId}-create`} onClick={go}>
          Create
        </button>
      </div>
      {why && <p className="hint warn-text">{why}</p>}
    </div>
  );
}

// ---------- tables ----------

function CellEditor({ column, value, onChange, testId, tables }: { column: Column; value: string | number | boolean | undefined; onChange(v: string | number | boolean): void; testId: string; tables: TableData[] }) {
  const sprites = useStudio((s) => s.names);
  const v = value ?? defaultCell(column);
  switch (column.type) {
    case 'boolean':
      return <input data-testid={testId} type="checkbox" checked={v === true} onChange={(e) => onChange(e.target.checked)} />;
    case 'color':
      return <input data-testid={testId} type="color" value={/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : '#ffffff'} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select data-testid={testId} value={String(v)} onChange={(e) => onChange(e.target.value)}>
          {column.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case 'ref': {
      const other = tables.find((t) => t.name === column.table);
      return (
        <select data-testid={testId} value={String(v)} onChange={(e) => onChange(e.target.value)}>
          <option value="">(none)</option>
          {(other?.rows ?? []).map((r) => (
            <option key={r.id}>{r.id}</option>
          ))}
        </select>
      );
    }
    case 'sprite':
      return (
        <select data-testid={testId} value={String(v)} onChange={(e) => onChange(e.target.value)}>
          <option value="">(none)</option>
          {sprites.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      );
    default:
      return <DraftInput testId={testId} value={String(v)} number={column.type === 'number'} onCommit={(raw) => onChange(coerceCell(column, raw))} />;
  }
}

/** A text box that only commits when you leave it or press Enter. */
function DraftInput({ value, onCommit, testId, number }: { value: string; onCommit(v: string): void; testId: string; number?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      data-testid={testId}
      type={number ? 'number' : 'text'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function TablesTab() {
  const tables = store.tables;
  const [name, setName] = useState<string>(tables[0]?.name ?? '');
  const [newCol, setNewCol] = useState<{ id: string; type: ColumnType }>({ id: '', type: 'text' });
  const [csv, setCsv] = useState<string | null>(null);
  const table = tables.find((t) => t.name === name) ?? tables[0];
  const sprites = useStudio((s) => s.names);
  const problems = useMemo(
    () => (table ? checkTable(table, new Map(tables.map((t) => [t.name, t])), { sprites: new Set(sprites), prefabs: new Set(store.state.prefabNames) }) : []),
    [table, tables, sprites],
  );
  const edit = (fn: (t: TableData) => TableData): void => table && store.setTable(fn(structuredClone(table)));
  const create = (n: string): void => {
    const t = newTable(n);
    store.setTable(t);
    setName(n);
  };
  const tableProblem = (n: string): string | null => (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(n) ? 'Table names use letters, numbers and _, and start with a letter (for example "Units").' : tables.some((t) => t.name === n) ? `There is already a table called "${n}".` : null);

  return (
    <div className="story-body" data-testid="tables-tab">
      <p className="hint">A table is a spreadsheet of game data: items, units, buildings, recipes, waves, cards, barks. Read a cell anywhere you can type a value as <code>{'{Units.knight.hp}'}</code> (table, row, column). Event rows can repeat for each row of a table.</p>
      <NewName testId="table-new" placeholder="New table name (for example Units)" onCreate={create} problem={tableProblem} />
      <div className="row wrap">
        {tables.map((t) => (
          <button key={t.name} className={t.name === table?.name ? 'small on' : 'small'} data-testid={`table-pick-${t.name}`} onClick={() => setName(t.name)}>
            {t.name} ({t.rows.length})
          </button>
        ))}
      </div>
      {table && (
        <>
          <TextField label="What it is for" testId="table-description" value={table.description} onCommit={(v) => edit((t) => ({ ...t, description: v }))} />
          <div style={{ overflowX: 'auto' }}>
            <table className="data-grid" data-testid="table-grid">
              <thead>
                <tr>
                  <th>id</th>
                  {table.columns.map((c) => (
                    <th key={c.id}>
                      <span data-testid={`col-head-${c.id}`}>{c.id}</span>
                      <select
                        aria-label={`Type of ${c.id}`}
                        data-testid={`col-type-${c.id}`}
                        value={c.type}
                        onChange={(e) =>
                          edit((t) => ({
                            ...t,
                            columns: t.columns.map((x) => (x.id === c.id ? { ...x, type: e.target.value as ColumnType } : x)),
                            rows: t.rows.map((r) => ({ ...r, [c.id]: coerceCell({ ...c, type: e.target.value as ColumnType }, r[c.id] ?? '') })),
                          }))
                        }
                      >
                        {COLUMN_TYPES.map((ty) => (
                          <option key={ty} value={ty}>
                            {COLUMN_TYPE_NAMES[ty]}
                          </option>
                        ))}
                      </select>
                      {c.type === 'select' && <DraftInput testId={`col-options-${c.id}`} value={c.options.join(', ')} onCommit={(raw) => edit((t) => ({ ...t, columns: t.columns.map((x) => (x.id === c.id ? { ...x, options: raw.split(',').map((o) => o.trim()).filter(Boolean) } : x)) }))} />}
                      {c.type === 'ref' && (
                        <select aria-label={`Table of ${c.id}`} data-testid={`col-table-${c.id}`} value={c.table} onChange={(e) => edit((t) => ({ ...t, columns: t.columns.map((x) => (x.id === c.id ? { ...x, table: e.target.value } : x)) }))}>
                          <option value="">(table)</option>
                          {tables.map((o) => (
                            <option key={o.name}>{o.name}</option>
                          ))}
                        </select>
                      )}
                      <button className="small" aria-label={`Delete column ${c.id}`} data-testid={`col-delete-${c.id}`} onClick={() => edit((t) => ({ ...t, columns: t.columns.filter((x) => x.id !== c.id), rows: t.rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== c.id)) as typeof r) }))}>
                        ✕
                      </button>
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, ri) => (
                  <tr key={ri} data-testid={`row-${r.id}`}>
                    <td>
                      <DraftInput testId={`cell-${r.id}-id`} value={r.id} onCommit={(v) => v.trim() !== '' && !table.rows.some((x) => x.id === v.trim()) && edit((t) => ({ ...t, rows: t.rows.map((x, i) => (i === ri ? { ...x, id: v.trim() } : x)) }))} />
                    </td>
                    {table.columns.map((c) => (
                      <td key={c.id}>
                        <CellEditor column={c} tables={tables} testId={`cell-${r.id}-${c.id}`} value={tableCell(table, r.id, c.id)} onChange={(v) => edit((t) => ({ ...t, rows: t.rows.map((x, i) => (i === ri ? { ...x, [c.id]: v } : x)) }))} />
                      </td>
                    ))}
                    <td>
                      <button className="small" aria-label={`Delete row ${r.id}`} data-testid={`row-delete-${r.id}`} onClick={() => edit((t) => ({ ...t, rows: t.rows.filter((_, i) => i !== ri) }))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row wrap">
            <button data-testid="row-add" className="primary" onClick={() => edit((t) => ({ ...t, rows: [...t.rows, newRow(t, freshRowId(t))] }))}>
              + Row
            </button>
            <input data-testid="col-add-id" placeholder="New column name" value={newCol.id} onChange={(e) => setNewCol({ ...newCol, id: e.target.value })} />
            <select data-testid="col-add-type" aria-label="Type of the new column" value={newCol.type} onChange={(e) => setNewCol({ ...newCol, type: e.target.value as ColumnType })}>
              {COLUMN_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {COLUMN_TYPE_NAMES[ty]}
                </option>
              ))}
            </select>
            <button
              data-testid="col-add"
              onClick={() => {
                const id = newCol.id.trim();
                if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(id) || id === 'id' || table.columns.some((c) => c.id === id)) return store.notify('warn', 'Column names use letters, numbers and _, start with a letter, and must be different from the others.');
                const column: Column = { id, label: id, type: newCol.type, options: newCol.type === 'select' ? ['a', 'b'] : [], table: '' };
                edit((t) => ({ ...t, columns: [...t.columns, column], rows: t.rows.map((r) => ({ ...r, [id]: defaultCell(column) })) }));
                setNewCol({ id: '', type: newCol.type });
              }}
            >
              + Column
            </button>
          </div>
          <div className="row wrap">
            <button data-testid="table-csv-show" onClick={() => setCsv(tableToCsv(table))}>
              Edit as CSV…
            </button>
            <button
              data-testid="table-delete"
              onClick={() => {
                void store.removeTable(table.name);
                setName('');
              }}
            >
              Delete this table
            </button>
          </div>
          {csv !== null && (
            <div>
              <p className="hint">The table as CSV, which a spreadsheet program can open. Change it and press Apply to replace the rows (new columns are added as text).</p>
              <textarea data-testid="table-csv-text" rows={8} style={{ width: '100%' }} value={csv} onChange={(e) => setCsv(e.target.value)} />
              <div className="row">
                <button
                  data-testid="table-csv-apply"
                  onClick={() => {
                    edit((t) => csvIntoTable(t, csv));
                    setCsv(null);
                  }}
                >
                  Apply
                </button>
                <button onClick={() => setCsv(null)}>Close</button>
              </div>
            </div>
          )}
          {problems.length > 0 && (
            <ul className="problems" data-testid="table-problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {tables.length === 0 && <p className="hint">No tables yet. Make one, add columns (name, hp, cost...) and rows.</p>}
    </div>
  );
}

// ---------- fields (custom components and behaviours) ----------

function FieldsEditor({ fields, onChange, testPrefix }: { fields: CustomField[]; onChange(next: CustomField[]): void; testPrefix: string }) {
  const set = (i: number, patch: Partial<CustomField>): void => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const [fresh, setFresh] = useState('');
  return (
    <div data-testid={`${testPrefix}-fields`}>
      {fields.map((f, i) => (
        <fieldset className="story-card" key={f.key} data-testid={`${testPrefix}-field-${f.key}`}>
          <legend>{f.key}</legend>
          <TextField label="Label shown" testId={`${testPrefix}-label-${f.key}`} value={f.label} onCommit={(v) => set(i, { label: v })} />
          <SelectField<CustomFieldType> label="Kind of value" testId={`${testPrefix}-type-${f.key}`} value={f.type} options={FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_NAMES[t] }))} onChange={(t) => set(i, { type: t, default: t === 'boolean' ? false : t === 'number' ? 0 : '' })} />
          {f.type === 'number' && (
            <>
              <NumberField label="Starts at" testId={`${testPrefix}-default-${f.key}`} value={Number(f.default) || 0} onCommit={(v) => set(i, { default: v })} />
              <NumberField label="Smallest" value={f.min ?? 0} onCommit={(v) => set(i, { min: v })} />
              <NumberField label="Largest" value={f.max ?? 100} onCommit={(v) => set(i, { max: v })} />
            </>
          )}
          {f.type === 'boolean' && <CheckField label="Starts on" testId={`${testPrefix}-default-${f.key}`} value={f.default === true} onChange={(v) => set(i, { default: v })} />}
          {f.type === 'text' && <TextField label="Starts as" testId={`${testPrefix}-default-${f.key}`} value={String(f.default ?? '')} onCommit={(v) => set(i, { default: v })} />}
          {f.type === 'select' && <TextField label="Choices (separated by commas)" testId={`${testPrefix}-options-${f.key}`} value={f.options.join(', ')} onCommit={(v) => set(i, { options: v.split(',').map((o) => o.trim()).filter(Boolean) })} />}
          {f.type === 'tableRow' && <SelectField<string> label="Table" testId={`${testPrefix}-table-${f.key}`} value={f.table} options={[{ value: '', label: '(choose a table)' }, ...store.tables.map((t) => ({ value: t.name, label: t.name }))]} onChange={(v) => set(i, { table: v })} />}
          <TextField label="Help text" value={f.help} onCommit={(v) => set(i, { help: v })} />
          <button className="small" data-testid={`${testPrefix}-delete-${f.key}`} onClick={() => onChange(fields.filter((_, j) => j !== i))}>
            Delete field
          </button>
        </fieldset>
      ))}
      <div className="row">
        <input data-testid={`${testPrefix}-newfield`} placeholder="New field name (for example hp)" value={fresh} onChange={(e) => setFresh(e.target.value)} />
        <button
          data-testid={`${testPrefix}-addfield`}
          onClick={() => {
            const key = fresh.trim();
            if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(key) || fields.some((f) => f.key === key)) return store.notify('warn', 'Field names use letters, numbers and _, start with a letter, and must be different from the others.');
            onChange([...fields, { key, label: key, type: 'number', default: 0, help: '', options: [], table: '' }]);
            setFresh('');
          }}
        >
          + Field
        </button>
      </div>
    </div>
  );
}

// ---------- components ----------

function ComponentsTab() {
  const list = store.components;
  const [name, setName] = useState(list[0]?.name ?? '');
  const c = list.find((x) => x.name === name) ?? list[0];
  const taken = new Set([...list.map((x) => x.name), ...store.customBehaviors.map((b) => b.name)]);
  const problems = c ? checkFields(`"${c.name}"`, c.fields, new Set(store.tables.map((t) => t.name))) : [];
  const edit = (patch: Partial<CustomComponentData>): void => c && store.setComponent({ ...c, ...patch });
  return (
    <div className="story-body" data-testid="components-tab">
      <p className="hint">A component is a named set of settings an object carries (Stats, Shopkeeper, Crop). Add it to an object in the Inspector like any behaviour; its fields appear there, and event rows can read them.</p>
      <NewName
        testId="component-new"
        placeholder="New component name (for example Stats)"
        problem={(n) => customNameProblem(n, taken)}
        onCreate={(n) => {
          store.setComponent(newCustomComponent(n));
          setName(n);
        }}
      />
      <div className="row wrap">
        {list.map((x) => (
          <button key={x.name} className={x.name === c?.name ? 'small on' : 'small'} data-testid={`component-pick-${x.name}`} onClick={() => setName(x.name)}>
            {x.name}
          </button>
        ))}
      </div>
      {c && (
        <>
          <TextField label="What it is for" testId="component-description" value={c.description} onCommit={(v) => edit({ description: v })} />
          <FieldsEditor fields={c.fields} testPrefix="cmp" onChange={(fields) => edit({ fields })} />
          {problems.length > 0 && (
            <ul className="problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <button
            data-testid="component-delete"
            onClick={() => {
              void store.removeComponent(c.name);
              setName('');
            }}
          >
            Delete this component
          </button>
        </>
      )}
      {list.length === 0 && <p className="hint">No components yet.</p>}
    </div>
  );
}

// ---------- behaviours ----------

function BehavioursTab() {
  const list = store.customBehaviors;
  const [name, setName] = useState(list[0]?.name ?? '');
  const b = list.find((x) => x.name === name) ?? list[0];
  const taken = new Set([...list.map((x) => x.name), ...store.components.map((c) => c.name)]);
  const edit = (patch: Partial<CustomBehaviorData>): void => b && store.setCustomBehavior({ ...b, ...patch });
  const signals = (v: string): { name: string; label: string }[] =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z][A-Za-z0-9_]*$/.test(s))
      .map((s) => ({ name: s, label: s }));
  return (
    <div className="story-body" data-testid="behaviours-tab">
      <p className="hint">A custom behaviour is event rows with settings of their own. The rows run for every object that has it; in them, &ldquo;this object&rdquo; is the object, and a setting is read as <code>{'{self.speed}'}</code>. Add it from the Inspector like a built-in behaviour.</p>
      <NewName
        testId="behavior-new"
        placeholder="New behaviour name (for example Wander)"
        problem={(n) => customNameProblem(n, taken)}
        onCreate={(n) => {
          store.setCustomBehavior(newCustomBehavior(n));
          setName(n);
        }}
      />
      <div className="row wrap">
        {list.map((x) => (
          <button key={x.name} className={x.name === b?.name ? 'small on' : 'small'} data-testid={`behavior-pick-${x.name}`} onClick={() => setName(x.name)}>
            {x.name}
          </button>
        ))}
      </div>
      {b && (
        <>
          <TextField label="What it does" testId="behavior-description" value={b.description} onCommit={(v) => edit({ description: v })} />
          <TextField label="Group in the Add menu" value={b.category} onCommit={(v) => edit({ category: v.trim() || 'Custom' })} />
          <h4>Settings</h4>
          <FieldsEditor fields={b.params} testPrefix="bhv" onChange={(params) => edit({ params })} />
          <TextField label="Signals it receives (separated by commas)" testId="behavior-inputs" value={b.inputs.map((s) => s.name).join(', ')} onCommit={(v) => edit({ inputs: signals(v) })} />
          <TextField label="Signals it sends (separated by commas)" testId="behavior-outputs" value={b.outputs.map((s) => s.name).join(', ')} onCommit={(v) => edit({ outputs: signals(v) })} />
          <h4>What it does each tick</h4>
          <RowsEditor rows={b.rows} newId={() => `r${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`} onChange={(_label, rows) => edit({ rows })} />
          <button
            data-testid="behavior-delete"
            onClick={() => {
              void store.removeCustomBehavior(b.name);
              setName('');
            }}
          >
            Delete this behaviour
          </button>
        </>
      )}
      {list.length === 0 && <p className="hint">No custom behaviours yet.</p>}
    </div>
  );
}

// ---------- events ----------

function EventsTab() {
  const events = store.eventDefs;
  return (
    <div className="story-body" data-testid="events-tab">
      <p className="hint">Name the things that can happen in your game (wave-cleared, building-finished). The Emit action and the &ldquo;An event happened&rdquo; condition offer these names, so the same word is used everywhere.</p>
      <NewName
        testId="event-new"
        placeholder="New event name (for example wave-cleared)"
        problem={(n) => (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(n) ? 'Event names use letters, numbers, - and _.' : events.some((e) => e.name === n) ? `There is already an event called "${n}".` : null)}
        onCreate={(n) => store.setEventDefs([...events, { name: n, label: n, description: '', fields: [] }])}
      />
      {events.map((e, i) => (
        <fieldset className="story-card" key={e.name} data-testid={`event-${e.name}`}>
          <legend>{e.name}</legend>
          <TextField label="What it means" testId={`event-desc-${e.name}`} value={e.description} onCommit={(v) => store.setEventDefs(events.map((x, j) => (j === i ? { ...x, description: v } : x)))} />
          <button className="small" data-testid={`event-delete-${e.name}`} onClick={() => store.setEventDefs(events.filter((_, j) => j !== i))}>
            Delete
          </button>
        </fieldset>
      ))}
      {events.length === 0 && <p className="hint">No custom events yet.</p>}
    </div>
  );
}
