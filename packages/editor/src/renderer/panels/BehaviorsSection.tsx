import { useState } from 'react';
import { attachBehavior, behaviorList, getBehavior, type BehaviorDef, type BehaviorTree, type FieldSpec, type StateMachine } from '@tilewright/behaviors';
import type { EntityData } from '@tilewright/runtime';
import { store, useApp } from '../app/store';
import { useStudio } from '../studio/store';
import { SoundField } from './SoundField';
import { CheckField, NumberField, SelectField, TextField } from './fields';
import { StateMachineEditor } from './StateMachineEditor';
import { BehaviorTreeEditor } from './BehaviorTreeEditor';
import { ActionNodeEditor, EventNodeEditor } from './LogicEditors';

type Edit = (label: string, fn: (x: EntityData) => void) => void;

function FieldView({ spec, value, onChange, prefabs }: { spec: FieldSpec; value: unknown; onChange(v: unknown): void; prefabs: string[] }) {
  const testId = `bf-${spec.key}`;
  switch (spec.type) {
    case 'number':
      return <NumberField testId={testId} label={spec.label} value={Number(value ?? 0)} min={spec.min} max={spec.max} step={spec.step ?? 1} onCommit={onChange} />;
    case 'boolean':
      return <CheckField testId={testId} label={spec.label} value={value === true} onChange={onChange} />;
    case 'select':
      return <SelectField<string> testId={testId} label={spec.label} value={String(value ?? '')} options={spec.options ?? []} onChange={onChange} />;
    case 'prefab':
      return (
        <SelectField<string>
          testId={testId}
          label={spec.label}
          value={String(value ?? '')}
          options={[{ value: '', label: prefabs.length ? '(choose a prefab)' : '(no prefabs yet)' }, ...prefabs.map((p) => ({ value: p, label: p }))]}
          onChange={onChange}
        />
      );
    case 'color':
      return (
        <label className="field">
          <span>{spec.label}</span>
          <input data-testid={testId} type="color" value={/^#[0-9a-fA-F]{6}$/.test(String(value)) ? String(value) : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case 'sprite':
      return <SpriteChoice testId={testId} label={spec.label} value={String(value ?? '')} onChange={onChange} />;
    case 'sound':
      return <SoundField testId={testId} label={spec.label} value={String(value ?? '')} onCommit={onChange} />;
    case 'tableRow': {
      const table = store.tables.find((t) => t.name === spec.table);
      const options = [{ value: '', label: table ? '(choose a row)' : `(no table called ${spec.table})` }, ...(table?.rows ?? []).map((r) => ({ value: r.id, label: String(r.name ?? r.id) === r.id ? r.id : `${String(r.name)} (${r.id})` }))];
      return <SelectField<string> testId={testId} label={spec.label} value={String(value ?? '')} options={options} onChange={onChange} />;
    }
    default:
      return <TextField testId={testId} label={spec.label} value={String(value ?? '')} onCommit={onChange} />;
  }
}

function SpriteChoice({ testId, label, value, onChange }: { testId: string; label: string; value: string; onChange(v: unknown): void }) {
  const names = useStudio((s) => s.names);
  return <SelectField<string> testId={testId} label={label} value={value} options={[{ value: '', label: '(none)' }, ...names.map((n) => ({ value: n, label: n }))]} onChange={onChange} />;
}

function BehaviorCard({ entity, def, edit, prefabs }: { entity: EntityData; def: BehaviorDef; edit: Edit; prefabs: string[] }) {
  const settings = (entity.components[def.id] ?? {}) as Record<string, unknown>;
  const complete = { ...structuredClone(def.defaults), ...settings } as Record<string, unknown>;
  return (
    <details open className="behavior" data-testid={`behavior-${def.id}`}>
      <summary>
        <strong>{def.name}</strong>
        <button
          className="small"
          title={`Remove ${def.name}`}
          aria-label={`Remove ${def.name}`}
          data-testid={`remove-${def.id}`}
          onClick={(e) => {
            e.preventDefault();
            edit(`Remove ${def.name}`, (x) => {
              delete x.components[def.id];
            });
          }}
        >
          ✕
        </button>
      </summary>
      <p className="hint">{def.description}</p>
      {def.fields.filter((f) => !f.showWhen || f.showWhen.is.includes(String(complete[f.showWhen.key] ?? ''))).map((f) => (
        <FieldView
          key={f.key}
          spec={f}
          value={complete[f.key]}
          prefabs={prefabs}
          onChange={(v) =>
            edit(`Change ${def.name}`, (x) => {
              const cur = (x.components[def.id] ??= {}) as Record<string, unknown>;
              cur[f.key] = v;
            })
          }
        />
      ))}
      {def.editor === 'stateMachine' && (
        <StateMachineEditor
          machine={complete as unknown as StateMachine}
          has={behaviorList().filter((b) => b.id !== def.id && entity.components[b.id] !== undefined).map((b) => b.id)}
          onChange={(next) =>
            edit('Edit the state machine', (x) => {
              x.components[def.id] = structuredClone(next);
            })
          }
        />
      )}
      {def.editor === 'actionNode' && <ActionNodeEditor entity={entity} edit={edit} />}
      {def.editor === 'eventNode' && <EventNodeEditor entity={entity} edit={edit} />}
      {def.editor === 'behaviorTree' && (
        <BehaviorTreeEditor
          tree={complete as unknown as BehaviorTree}
          has={behaviorList().filter((b) => b.id !== def.id && entity.components[b.id] !== undefined).map((b) => b.id)}
          sceneId={entity.id}
          onChange={(next) =>
            edit('Edit the behaviour tree', (x) => {
              x.components[def.id] = structuredClone(next);
            })
          }
        />
      )}
      {def.summary && <p className="hint summary">{def.summary(complete as never)}</p>}
      {(def.inputs.length > 0 || def.outputs.length > 0) && (
        <p className="hint">
          {def.inputs.length > 0 && <>Receives: {def.inputs.map((s) => s.label).join(', ')}. </>}
          {def.outputs.length > 0 && <>Sends: {def.outputs.map((s) => s.label).join(', ')}.</>}
        </p>
      )}
    </details>
  );
}

/** Behaviours attached to an object: their settings, and a picker to add more. */
export function BehaviorsSection({ entity, edit }: { entity: EntityData; edit: Edit }) {
  const prefabNames = useApp((s) => s.prefabNames);
  const [choice, setChoice] = useState('');
  const attached = behaviorList().filter((b) => entity.components[b.id] !== undefined);
  const available = behaviorList().filter((b) => entity.components[b.id] === undefined && !b.hidden);
  const categories = [...new Set(available.map((b) => b.category))];
  return (
    <fieldset data-testid="insp-behaviors">
      <legend>Behaviours</legend>
      {attached.length === 0 && <p className="hint">Behaviours make things do something: plates, gates, levers, pushable crates, moving platforms... Add one below.</p>}
      {attached.map((def) => (
        <BehaviorCard key={def.id} entity={entity} def={def} edit={edit} prefabs={prefabNames} />
      ))}
      <div className="row">
        <select data-testid="add-behavior" aria-label="Add a behaviour" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Add a behaviour…</option>
          {categories.map((cat) => (
            <optgroup key={cat} label={cat}>
              {available
                .filter((b) => b.category === cat)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <button
          data-testid="add-behavior-ok"
          disabled={!choice}
          onClick={() => {
            const def = getBehavior(choice);
            if (!def) return;
            edit(`Add ${def.name}`, (x) => attachBehavior(x.components, choice));
            setChoice('');
          }}
        >
          Add
        </button>
      </div>
      {choice && <p className="hint">{getBehavior(choice)?.description}</p>}
    </fieldset>
  );
}
