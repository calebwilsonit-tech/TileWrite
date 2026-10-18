import { useMemo, useState } from 'react';
import type { UiDoc } from '@tilewright/runtime';
import { store } from '../app/store';
import { bindingChoices, numericFields, type BindingFacts } from './bindings';

/** Everything the open project offers to tie a widget to, gathered for the picker. */
export function useBindingFacts(): BindingFacts {
  const doc = store.doc;
  const vars = new Set<string>((doc?.variables ?? []).map((v) => v.name));
  const walk = (rows: NonNullable<typeof doc>['events']): void => {
    for (const r of rows) {
      for (const a of r.actions) if (a.type === 'setVariable' && typeof a.params.name === 'string' && a.params.name) vars.add(a.params.name);
      walk(r.children);
    }
  };
  if (doc) walk(doc.events);
  for (const e of doc?.entities ?? []) {
    const p = e.components.pickup as { variable?: string } | undefined;
    if (p?.variable) vars.add(p.variable);
  }
  return {
    variables: [...vars],
    tables: store.tables,
    items: store.story.items.map((i) => ({ id: i.id, name: i.name })),
    objects: (doc?.entities ?? []).filter((e) => !e.tags.includes('logic-node')).slice(0, 40).map((e) => ({ name: e.name, fields: numericFields(e.components) })),
  };
}

/**
 * "Bind to..." - pick a variable, a table cell, an object field or a player setting from a tree instead of typing its name.
 * `wrap` puts the name in {braces} (for texts); a plain name is what bars, sliders and ticks need.
 */
export function BindButton({ doc, widgetId, onPick, wrap, label = 'Bind to…', testId }: { doc: UiDoc; widgetId: string | null; onPick(text: string): void; wrap: boolean; label?: string; testId: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const facts = useBindingFacts();
  const choices = useMemo(() => (open ? bindingChoices(doc, widgetId, facts) : []), [open, doc, widgetId, facts]);
  const groups = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const map = new Map<string, typeof choices>();
    for (const c of choices) {
      if (!words.every((w) => `${c.label} ${c.path} ${c.group}`.toLowerCase().includes(w))) continue;
      const list = map.get(c.group) ?? [];
      list.push(c);
      map.set(c.group, list);
    }
    return [...map.entries()];
  }, [choices, q]);
  return (
    <>
      <button type="button" className="small" data-testid={testId} onClick={() => setOpen(true)} title="Pick a variable, table cell, object field or setting from a list">
        {label}
      </button>
      {open && (
        <div className="modal-backdrop" onMouseDown={() => setOpen(false)}>
          <div className="dialog bind-dialog" role="dialog" aria-label="Bind to" data-testid="bind-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <h2>Bind to…</h2>
            <input data-testid="bind-search" autoFocus placeholder="Search: gold, health, Shop, music…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="bind-tree">
              {groups.length === 0 && <p className="hint">Nothing matches. Variables appear here once an event row or the scene uses them.</p>}
              {groups.map(([group, list], i) => (
                <details key={group} open={q !== '' || i < 2}>
                  <summary>
                    {group} <small>({list.length})</small>
                  </summary>
                  {list.slice(0, 80).map((c) => (
                    <button
                      key={c.path}
                      className="bind-item"
                      data-testid={`bind-item-${c.path}`}
                      onClick={() => {
                        onPick(wrap ? `{${c.path}}` : c.path);
                        setOpen(false);
                        setQ('');
                      }}
                    >
                      {c.label} <small>{c.path}</small>
                    </button>
                  ))}
                </details>
              ))}
            </div>
            <div className="row end">
              <button onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
