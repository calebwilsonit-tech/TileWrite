import { useMemo } from 'react';
import {
  ACTIONS,
  CONDITIONS,
  actionDef,
  behaviorList,
  checkSheet,
  conditionDef,
  describeRow,
  newAction,
  newCondition,
  newRow,
  type ParamSpec,
} from '@tilewright/behaviors';
import { DEFAULT_INPUT_MAP, type EventRow } from '@tilewright/runtime';
import { store, useApp } from '../app/store';
import { storyVariables } from '../model/story-vars';
import { assistant } from '../assistant/store';
import { CheckField, NumberField, SelectField, TextField } from './fields';
import { SoundField } from './SoundField';
import { studio } from '../studio/store';

type Rows = EventRow[];

function listAt(rows: Rows, path: number[]): Rows {
  let list = rows;
  for (const i of path) list = list[i]!.children;
  return list;
}

/** Everything the pickers need to know about the scene. */
export function useFacts(): {
  entities: { id: string; name: string }[];
  tags: string[];
  variables: string[];
  signals: string[];
  prefabs: string[];
  tables: string[];
  events: string[];
} {
  useApp((s) => s.docVersion);
  const prefabs = useApp((s) => s.prefabNames);
  const doc = store.doc;
  return useMemo(() => {
    const entities = (doc?.entities ?? []).map((e) => ({ id: e.id, name: e.name }));
    const tags = [...new Set((doc?.entities ?? []).flatMap((e) => e.tags))].sort();
    const vars = new Set<string>((doc?.variables ?? []).map((v) => v.name));
    const walk = (rows: EventRow[]): void => {
      for (const r of rows) {
        for (const a of r.actions) if (a.type === 'setVariable' && typeof a.params.name === 'string' && a.params.name) vars.add(a.params.name);
        walk(r.children);
      }
    };
    walk(doc?.events ?? []);
    for (const e of doc?.entities ?? []) {
      const p = e.components.pickup as { variable?: string } | undefined;
      if (p?.variable) vars.add(p.variable);
    }
    const signals = [...new Set(behaviorList().flatMap((b) => [...b.inputs, ...b.outputs].map((s) => s.name)))].sort();
    return { entities, tags, variables: [...vars].sort(), signals, prefabs, tables: store.tables.map((t) => t.name), events: store.eventDefs.map((e) => e.name) };
  }, [doc, doc?.entities.length, doc?.events, doc?.variables, prefabs, store.tables]);
}

export function ParamEditor({ spec, value, onChange, testId, facts, inLoop }: { spec: ParamSpec; value: unknown; onChange(v: unknown): void; testId: string; facts: ReturnType<typeof useFacts>; inLoop: boolean }) {
  switch (spec.type) {
    case 'number':
      return <NumberField testId={testId} label={spec.label} value={Number(value ?? 0)} min={spec.min} max={spec.max} step={spec.step ?? 1} onCommit={onChange} />;
    case 'boolean':
      return <CheckField testId={testId} label={spec.label} value={value === true} onChange={onChange} />;
    case 'select': {
      const options = [...(spec.options ?? [])];
      // the project's own events are offered next to the engine's
      if (spec.extra === 'events') for (const ev of facts.events) if (!options.some((o) => o.value === ev)) options.push({ value: ev, label: `${ev} (your event)` });
      const v = String(value ?? '');
      if (v && !options.some((o) => o.value === v)) options.push({ value: v, label: v });
      return <SelectField<string> testId={testId} label={spec.label} value={v} options={options} onChange={onChange} />;
    }
    case 'entity': {
      const options = [
        { value: '', label: '(choose an object)' },
        { value: 'player', label: 'The player' },
        ...(inLoop ? [{ value: 'picked', label: 'The picked object (from "for each")' }] : []),
        { value: 'self', label: 'This object (inside a custom behaviour)' },
        { value: 'turn', label: 'The unit whose turn it is' },
        ...facts.tags.map((t) => ({ value: `tag:${t}`, label: `Anything tagged “${t}”` })),
        ...facts.entities.map((e) => ({ value: `id:${e.id}`, label: e.name })),
      ];
      const v = String(value ?? '');
      if (v && !options.some((o) => o.value === v)) options.push({ value: v, label: `${v} (missing)` });
      return <SelectField<string> testId={testId} label={spec.label} value={v} options={options} onChange={onChange} />;
    }
    case 'prefab':
      return <SelectField<string> testId={testId} label={spec.label} value={String(value ?? '')} options={[{ value: '', label: facts.prefabs.length ? '(choose a prefab)' : '(no prefabs yet)' }, ...facts.prefabs.map((p) => ({ value: p, label: p }))]} onChange={onChange} />;
    case 'sound':
      return <SoundField testId={testId} label={spec.label} value={String(value ?? '')} onCommit={onChange} />;
    case 'action':
      return <SelectField<string> testId={testId} label={spec.label} value={String(value ?? '')} options={Object.keys(DEFAULT_INPUT_MAP).map((a) => ({ value: a, label: a }))} onChange={onChange} />;
    case 'variable':
      return (
        <label className="field">
          <span>{spec.label}</span>
          <input data-testid={testId} list={`vars-${testId}`} defaultValue={String(value ?? '')} key={String(value ?? '')} onBlur={(e) => e.target.value !== value && onChange(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <datalist id={`vars-${testId}`}>
            {facts.variables.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
      );
    case 'signal':
      return (
        <label className="field">
          <span>{spec.label}</span>
          <input data-testid={testId} list={`sig-${testId}`} defaultValue={String(value ?? '')} key={String(value ?? '')} onBlur={(e) => e.target.value !== value && onChange(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <datalist id={`sig-${testId}`}>
            {facts.signals.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
      );
    default:
      return <TextField testId={testId} label={spec.label} value={String(value ?? '')} onCommit={onChange} suggestions={spec.extra === 'events' ? facts.events : undefined} />;
  }
}

export function CategorySelect({ items, testId, onPick, placeholder }: { items: { id: string; label: string; category: string }[]; testId: string; onPick(id: string): void; placeholder: string }) {
  const categories = [...new Set(items.map((i) => i.category))];
  return (
    <select
      data-testid={testId}
      aria-label={placeholder}
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
      }}
    >
      <option value="">{placeholder}</option>
      {categories.map((c) => (
        <optgroup key={c} label={c}>
          {items
            .filter((i) => i.category === c)
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

function RowCard({ row, path, update, facts, inLoop, names, newId }: { row: EventRow; path: number[]; update(label: string, fn: (rows: Rows) => void): void; facts: ReturnType<typeof useFacts>; inLoop: boolean; names: { entity(id: string): string | undefined }; newId(): string }) {
  const mutate = (label: string, fn: (r: EventRow) => void): void =>
    update(label, (rows) => {
      const list = listAt(rows, path.slice(0, -1));
      fn(list[path[path.length - 1]!]!);
    });
  const loop = inLoop || row.forEach !== '';
  const index = path[path.length - 1]!;
  const sibling = (delta: -1 | 1): void =>
    update('Move event row', (rows) => {
      const list = listAt(rows, path.slice(0, -1));
      const j = index + delta;
      if (j < 0 || j >= list.length) return;
      const [r] = list.splice(index, 1);
      list.splice(j, 0, r!);
    });
  const forEachOptions = [
    { value: '', label: '(no loop)' },
    ...facts.tags.map((t) => ({ value: `tag:${t}`, label: `each thing tagged “${t}”` })),
    ...facts.entities.map((e) => ({ value: `id:${e.id}`, label: `${e.name}` })),
    ...facts.tables.map((t) => ({ value: `table:${t}`, label: `each row of the table “${t}”` })),
  ];

  return (
    <div className={`event-row${row.enabled ? '' : ' off'}`} data-testid={`row-${row.id}`} style={{ marginLeft: path.length > 1 ? 18 : 0 }}>
      <div className="event-head">
        <input type="checkbox" aria-label="Row is active" checked={row.enabled} onChange={(e) => mutate('Toggle event row', (r) => (r.enabled = e.target.checked))} />
        <p className="sentence" data-testid={`sentence-${row.id}`}>
          {describeRow(row, names)}
        </p>
        <span className="row-tools">
          <button aria-label="Move up" onClick={() => sibling(-1)}>↑</button>
          <button aria-label="Move down" onClick={() => sibling(1)}>↓</button>
          <button
            aria-label="Delete row"
            data-testid={`delete-${row.id}`}
            onClick={() =>
              update('Delete event row', (rows) => {
                listAt(rows, path.slice(0, -1)).splice(index, 1);
              })
            }
          >
            ✕
          </button>
        </span>
      </div>
      <div className="event-body">
        <div className="event-col">
          <h4>When</h4>
          {row.conditions.map((c, i) => {
            const def = conditionDef(c.type);
            return (
              <div className="event-item" key={i}>
                <div className="row">
                  <select
                    data-testid={`cond-type-${row.id}-${i}`}
                    aria-label="Condition"
                    value={c.type}
                    onChange={(e) => mutate('Change condition', (r) => (r.conditions[i] = { ...newCondition(e.target.value), negate: c.negate }))}
                  >
                    {CONDITIONS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                    {!def && <option value={c.type}>{c.type} (unknown)</option>}
                  </select>
                  <label className="check">
                    <input type="checkbox" checked={c.negate} onChange={(e) => mutate('Toggle NOT', (r) => (r.conditions[i]!.negate = e.target.checked))} /> not
                  </label>
                  <button aria-label="Remove condition" onClick={() => mutate('Remove condition', (r) => void r.conditions.splice(i, 1))}>✕</button>
                </div>
                {def?.params.map((p) => (
                  <ParamEditor key={p.key} spec={p} value={c.params[p.key]} facts={facts} inLoop={loop} testId={`param-${row.id}-c${i}-${p.key}`} onChange={(v) => mutate('Change condition', (r) => (r.conditions[i]!.params[p.key] = v))} />
                ))}
              </div>
            );
          })}
          <CategorySelect testId={`add-condition-${row.id}`} placeholder="+ Condition…" items={CONDITIONS} onPick={(id) => mutate('Add condition', (r) => void r.conditions.push(newCondition(id)))} />
        </div>
        <div className="event-col">
          <h4>Do</h4>
          {row.actions.map((a, i) => {
            const def = actionDef(a.type);
            return (
              <div className="event-item" key={i}>
                <div className="row">
                  <select
                    data-testid={`action-type-${row.id}-${i}`}
                    aria-label="Action"
                    value={a.type}
                    onChange={(e) => mutate('Change action', (r) => (r.actions[i] = newAction(e.target.value)))}
                  >
                    {ACTIONS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                    {!def && <option value={a.type}>{a.type} (unknown)</option>}
                  </select>
                  <button aria-label="Remove action" onClick={() => mutate('Remove action', (r) => void r.actions.splice(i, 1))}>✕</button>
                </div>
                {def?.params.map((p) => (
                  <ParamEditor key={p.key} spec={p} value={a.params[p.key]} facts={facts} inLoop={loop} testId={`param-${row.id}-a${i}-${p.key}`} onChange={(v) => mutate('Change action', (r) => (r.actions[i]!.params[p.key] = v))} />
                ))}
              </div>
            );
          })}
          <CategorySelect testId={`add-action-${row.id}`} placeholder="+ Action…" items={ACTIONS} onPick={(id) => mutate('Add action', (r) => void r.actions.push(newAction(id)))} />
        </div>
      </div>
      <div className="event-options">
        {row.conditions.length > 1 && (
          <SelectField<string> label="Conditions" value={row.mode} options={[{ value: 'all', label: 'all must hold (AND)' }, { value: 'any', label: 'any one is enough (OR)' }]} onChange={(v) => mutate('Change AND/OR', (r) => (r.mode = v as 'all' | 'any'))} />
        )}
        <CheckField testId={`breakpoint-${row.id}`} label="Stop the game here when this row runs (debugging)" value={row.breakpoint} onChange={(v) => mutate('Toggle breakpoint', (r) => (r.breakpoint = v))} />
        <CheckField testId={`once-${row.id}`} label="Only the moment it becomes true" value={row.once} onChange={(v) => mutate('Toggle once', (r) => (r.once = v))} />
        <SelectField<string> testId={`foreach-${row.id}`} label="Repeat for" value={row.forEach} options={forEachOptions} onChange={(v) => mutate('Change loop', (r) => (r.forEach = v))} />
        <NumberField label="Run actions this many times" min={1} max={100} value={row.repeat} onCommit={(v) => mutate('Change repeat', (r) => (r.repeat = Math.max(1, Math.round(v))))} />
        <TextField label="Note" value={row.comment} onCommit={(v) => mutate('Edit note', (r) => (r.comment = v))} />
        <button data-testid={`add-child-${row.id}`} onClick={() => update('Add sub-event', (rows) => void listAt(rows, path)[index]!.children.push(newRow(newId())))}>
          + Sub-event
        </button>
      </div>
      {row.children.map((child, i) => (
        <RowCard key={child.id} row={child} path={[...path, i]} update={update} facts={facts} inLoop={loop} names={names} newId={newId} />
      ))}
    </div>
  );
}

/** Event rows with their own list (a custom behaviour's rows): the same cards as the scene's event sheet. */
export function RowsEditor({ rows, onChange, newId }: { rows: EventRow[]; onChange(label: string, rows: EventRow[]): void; newId(): string }) {
  const facts = useFacts();
  const names = useMemo(() => ({ entity: (id: string): string | undefined => store.doc?.getEntity(id)?.name }), []);
  const update = (label: string, fn: (rows: Rows) => void): void => {
    const next = structuredClone(rows);
    fn(next);
    onChange(label, next);
  };
  return (
    <div data-testid="rows-editor">
      <button data-testid="rows-add" className="primary" onClick={() => update('Add event row', (r) => void r.push(newRow(newId())))}>
        + Event row
      </button>
      {rows.map((row, i) => (
        <RowCard key={row.id} row={row} path={[i]} update={update} facts={facts} inLoop={false} names={names} newId={newId} />
      ))}
    </div>
  );
}

/** The scene's event sheet: rows that read like sentences, plus the scene's variables. */
export function EventsPanel() {
  useApp((s) => s.docVersion);
  const doc = store.doc;
  const facts = useFacts();
  const names = useMemo(() => ({ entity: (id: string): string | undefined => doc?.getEntity(id)?.name }), [doc]);
  if (!doc) return null;
  const update = (label: string, fn: (rows: Rows) => void): void => {
    const rows = structuredClone(doc.events);
    fn(rows);
    doc.setEvents(label, rows);
  };
  const problems = checkSheet(doc.events, { entityIds: new Set(doc.entities.map((e) => e.id)), tags: new Set(facts.tags), variables: new Set(doc.variables.map((v) => v.name)), prefabs: new Set(facts.prefabs), storyVariables: storyVariables(store.story.dialogues, store.story.cutscenes), sounds: new Set(studio.sounds.map((s) => s.name)) }, names);

  return (
    <div className="panel events-panel" data-testid="events-panel">
      <details open={doc.variables.length > 0}>
        <summary>Variables ({doc.variables.length})</summary>
        <p className="hint">Counters and flags the scene starts with. Rows read and change them; pickups add to them.</p>
        {doc.variables.map((v, i) => (
          <div className="row" key={`${v.name}-${i}`}>
            <TextField label="" value={v.name} testId={`var-name-${i}`} onCommit={(name) => doc.setVariables('Rename variable', doc.variables.map((x, j) => (j === i ? { ...x, name: name.trim() || x.name } : x)))} />
            <TextField label="" value={String(v.value)} testId={`var-value-${i}`} onCommit={(raw) => doc.setVariables('Change variable', doc.variables.map((x, j) => (j === i ? { ...x, value: raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw } : x)))} />
            <button aria-label="Delete variable" onClick={() => doc.setVariables('Delete variable', doc.variables.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button data-testid="add-variable" onClick={() => doc.setVariables('Add variable', [...doc.variables, { name: `variable${doc.variables.length + 1}`, value: 0 }])}>
          + Variable
        </button>
      </details>
      <div className="row">
        <button data-testid="add-row" className="primary" onClick={() => update('Add event row', (rows) => void rows.push(newRow(doc.newId('ev'))))}>
          + Event row
        </button>
        <button data-testid="events-to-code" disabled={doc.events.length === 0} onClick={() => void store.convertEventsToScript().then((n) => n && store.set({ workspace: 'code' }))} title="See the event sheet written as code, to learn from or carry on in code">
          Convert to code
        </button>
      </div>
      {doc.events.length === 0 && <p className="hint">An event row reads like a sentence: “When the player is inside the door area, show a message.” Add a row, then pick what it waits for and what it does.</p>}
      {doc.events.map((row, i) => (
        <RowCard key={row.id} row={row} path={[i]} update={update} facts={facts} inLoop={false} names={names} newId={() => doc.newId('ev')} />
      ))}
      {problems.length > 0 && (
        <div className="event-problems" data-testid="event-problems">
          <h4>Things to fix</h4>
          <ul className="plain">
            {problems.map((p, i) => (
              <li key={i} className="warn-text">
                {p.text}
              </li>
            ))}
          </ul>
          <div className="row">
            <button data-testid="events-explain" onClick={() => assistant.ask('explain', `The event sheet checker reports these problems in the open scene:\n${problems.map((p) => `- ${p.text}`).join('\n')}`)}>
              Explain
            </button>
            <button data-testid="events-fix" onClick={() => assistant.ask('fix', `The event sheet checker reports these problems in the open scene:\n${problems.map((p) => `- ${p.text}`).join('\n')}`)}>
              Fix with Claude
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
