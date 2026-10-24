import { useEffect, useRef, useState } from 'react';
import type { EntityData } from '@tilewright/runtime';
import { host } from '@tilewright/behaviors';
import { usePlugins } from '../plugins/hooks';
import { CheckField, NumberField, TextField } from './fields';

type Edit = (label: string, fn: (x: EntityData) => void) => void;

/** The settings of a component a plugin added, drawn by the plugin when it brought an inspector, and as plain fields when it did not. */
function Settings({ id, value, change }: { id: string; value: Record<string, unknown>; change(next: Record<string, unknown>): void }) {
  const inspector = host.ext.inspectors.get(id);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || !inspector) return;
    el.replaceChildren();
    const stop = inspector.render(el, value, change);
    return () => {
      if (typeof stop === 'function') stop();
    };
  }, [inspector, JSON.stringify(value)]);
  if (inspector) return <div data-testid={`plugin-inspector-${id}`} ref={box} />;
  return (
    <>
      {Object.entries(value).map(([key, v]) =>
        typeof v === 'number' ? (
          <NumberField key={key} label={key} testId={`pc-${id}-${key}`} value={v} step={1} onCommit={(n) => change({ ...value, [key]: n })} />
        ) : typeof v === 'boolean' ? (
          <CheckField key={key} label={key} testId={`pc-${id}-${key}`} value={v} onChange={(b) => change({ ...value, [key]: b })} />
        ) : (
          <TextField key={key} label={key} testId={`pc-${id}-${key}`} value={typeof v === 'string' ? v : JSON.stringify(v)} onCommit={(s) => change({ ...value, [key]: typeof v === 'string' ? s : safeJson(s, v) })} />
        ),
      )}
    </>
  );
}

const safeJson = (text: string, fallback: unknown): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

/** Components plugins added: what the object carries, and a picker to give it more. */
export function PluginComponentsSection({ entity, edit }: { entity: EntityData; edit: Edit }) {
  usePlugins();
  const [choice, setChoice] = useState('');
  const defs = [...host.ext.components.values()];
  if (defs.length === 0) return null;
  const attached = defs.filter((d) => entity.components[d.id] !== undefined);
  const available = defs.filter((d) => entity.components[d.id] === undefined);
  return (
    <fieldset data-testid="insp-plugin-components">
      <legend>Plugin components</legend>
      {attached.map((d) => (
        <details key={d.id} open data-testid={`component-${d.id}`}>
          <summary>
            {d.name}
            <button
              className="small"
              data-testid={`remove-component-${d.id}`}
              onClick={(e) => {
                e.preventDefault();
                edit(`Remove ${d.name}`, (x) => void delete x.components[d.id]);
              }}
            >
              Remove
            </button>
          </summary>
          {d.description && <p className="hint">{d.description}</p>}
          <Settings id={d.id} value={entity.components[d.id] as Record<string, unknown>} change={(next) => edit(`Change ${d.name}`, (x) => void (x.components[d.id] = structuredClone(next)))} />
        </details>
      ))}
      <div className="row">
        <select data-testid="add-component" aria-label="Add a component" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Add a component…</option>
          {available.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          data-testid="add-component-ok"
          disabled={!choice}
          onClick={() => {
            const d = host.ext.components.get(choice);
            if (!d) return;
            edit(`Add ${d.name}`, (x) => void (x.components[d.id] = structuredClone(d.defaults)));
            setChoice('');
          }}
        >
          Add
        </button>
      </div>
    </fieldset>
  );
}
