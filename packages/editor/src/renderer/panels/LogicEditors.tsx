import { useState } from 'react';
import {
  ACTIONS,
  CONDITIONS,
  actionDef,
  actionPinsOf,
  attachBehavior,
  conditionDef,
  eventPinsOf,
  newAction,
  newCondition,
  quickActions,
  type ActionNode,
} from '@tilewright/behaviors';
import type { EntityData, EventAction, EventCondition } from '@tilewright/runtime';
import { store, useApp } from '../app/store';
import { openAsGraph } from '../model/graph-edit';
import { addQuickAction, connectToTarget, ownedNodes, removeQuickAction, setQuickActions, usedPins } from '../model/logic-edit';
import { CategorySelect, ParamEditor, useFacts } from './EventsPanel';
import { CheckField, SelectField } from './fields';

/** A list of actions with their settings: the same blocks the event sheet uses, for event nodes, action nodes and quick actions. */
export function ActionListEditor({ actions, onChange, testId, inLoop = false, single = false }: { actions: EventAction[]; onChange(next: EventAction[]): void; testId: string; inLoop?: boolean; single?: boolean }) {
  const facts = useFacts();
  const set = (i: number, fn: (a: EventAction) => void): void => {
    const next = structuredClone(actions);
    fn(next[i]!);
    onChange(next);
  };
  return (
    <div className="action-list" data-testid={testId}>
      {actions.map((a, i) => {
        const def = actionDef(a.type);
        return (
          <div className="event-item" key={i} data-testid={`${testId}-item-${i}`}>
            <div className="row">
              <select data-testid={`${testId}-type-${i}`} aria-label="Action" value={a.type} onChange={(e) => onChange(actions.map((x, j) => (j === i ? newAction(e.target.value) : x)))}>
                {ACTIONS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
                {!def && <option value={a.type}>{a.type} (not available)</option>}
              </select>
              <button
                aria-label="Move up"
                disabled={i === 0}
                onClick={() => {
                  const next = [...actions];
                  [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                  onChange(next);
                }}
              >
                ↑
              </button>
              {!single && (
                <button aria-label="Remove action" data-testid={`${testId}-remove-${i}`} onClick={() => onChange(actions.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
            {def?.params.map((p) => (
              <ParamEditor key={p.key} spec={p} value={a.params[p.key]} facts={facts} inLoop={inLoop} testId={`${testId}-p${i}-${p.key}`} onChange={(v) => set(i, (x) => (x.params[p.key] = v))} />
            ))}
          </div>
        );
      })}
      {(!single || actions.length === 0) && <CategorySelect testId={`${testId}-add`} placeholder="+ Action…" items={ACTIONS} onPick={(id) => onChange([...actions, newAction(id)])} />}
    </div>
  );
}

/** A list of conditions with an AND/OR choice. */
export function ConditionListEditor({ conditions, mode, onChange, testId }: { conditions: EventCondition[]; mode: 'all' | 'any'; onChange(next: EventCondition[], mode: 'all' | 'any'): void; testId: string }) {
  const facts = useFacts();
  const set = (i: number, fn: (c: EventCondition) => void): void => {
    const next = structuredClone(conditions);
    fn(next[i]!);
    onChange(next, mode);
  };
  return (
    <div className="condition-list" data-testid={testId}>
      {conditions.map((c, i) => {
        const def = conditionDef(c.type);
        return (
          <div className="event-item" key={i}>
            <div className="row">
              <select data-testid={`${testId}-type-${i}`} aria-label="Condition" value={c.type} onChange={(e) => onChange(conditions.map((x, j) => (j === i ? { ...newCondition(e.target.value), negate: x.negate } : x)), mode)}>
                {CONDITIONS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
                {!def && <option value={c.type}>{c.type} (not available)</option>}
              </select>
              <label className="check">
                <input type="checkbox" checked={c.negate} onChange={(e) => set(i, (x) => (x.negate = e.target.checked))} /> not
              </label>
              <button aria-label="Remove condition" onClick={() => onChange(conditions.filter((_, j) => j !== i), mode)}>
                ✕
              </button>
            </div>
            {def?.params.map((p) => (
              <ParamEditor key={p.key} spec={p} value={c.params[p.key]} facts={facts} inLoop={false} testId={`${testId}-p${i}-${p.key}`} onChange={(v) => set(i, (x) => (x.params[p.key] = v))} />
            ))}
          </div>
        );
      })}
      <CategorySelect testId={`${testId}-add`} placeholder="+ Condition…" items={CONDITIONS} onPick={(id) => onChange([...conditions, newCondition(id)], mode)} />
    </div>
  );
}

/** What the Inspector shows inside an Action node. */
export function ActionNodeEditor({ entity, edit }: { entity: EntityData; edit(label: string, fn: (x: EntityData) => void): void }) {
  const s = entity.components.actionNode as ActionNode;
  return (
    <ActionListEditor
      testId="actionnode"
      actions={s.actions ?? []}
      onChange={(next) =>
        edit('Change actions', (x) => {
          (x.components.actionNode as ActionNode).actions = structuredClone(next);
        })
      }
    />
  );
}

/** What the Inspector shows inside an Event node. */
export function EventNodeEditor({ entity, edit }: { entity: EntityData; edit(label: string, fn: (x: EntityData) => void): void }) {
  const s = entity.components.eventNode as { conditions: EventCondition[]; mode: 'all' | 'any' };
  return (
    <ConditionListEditor
      testId="eventnode"
      conditions={s.conditions ?? []}
      mode={s.mode ?? 'all'}
      onChange={(next, mode) =>
        edit('Change what it watches', (x) => {
          const c = x.components.eventNode as { conditions: EventCondition[]; mode: string };
          c.conditions = structuredClone(next);
          c.mode = mode;
        })
      }
    />
  );
}

/**
 * Level one of the logic system: under each thing an object announces ("On click", "While pressed", "Is defeated"), a short
 * list of what happens, picked from menus. The nodes and wires it makes are the same ones the Wire tool and the graph use.
 */
export function QuickActionsSection({ entity }: { entity: EntityData }) {
  useApp((s) => s.docVersion);
  const doc = store.doc;
  const [pinId, setPinId] = useState('');
  const [targetId, setTargetId] = useState('');
  if (!doc || entity.tags.includes('logic-node')) return null;
  const pins = eventPinsOf(entity.components);
  const used = usedPins(doc, entity.id);
  const clickable = entity.components.clickable !== undefined;
  const pin = pins.find((p) => p.id === pinId) ?? pins[0];
  const quick = quickActions();
  const targets = doc.entities.filter((t) => t.id !== entity.id && !t.tags.includes('logic-node') && actionPinsOf(t.components).length > 0);
  const targetPins = targetId ? actionPinsOf(doc.getEntity(targetId)?.components ?? {}) : [];
  const groups = [...new Set(quick.map((q) => q.group))];
  const shown = ownedNodes(doc, entity.id).length;
  if (pins.length === 0 && shown === 0 && clickable) return null;

  return (
    <fieldset data-testid="insp-quick">
      <legend>Quick actions</legend>
      {pins.length === 0 && (
        <p className="hint">
          This object announces nothing yet. Make it clickable to react to the mouse, or add a behaviour such as a plate, lever or timer.
        </p>
      )}
      {!clickable && (
        <button
          data-testid="qa-make-clickable"
          onClick={() =>
            doc.updateEntities([entity.id], 'Make clickable', (x) => {
              attachBehavior(x.components, 'clickable');
            })
          }
        >
          Make it clickable
        </button>
      )}
      {used.map(({ pin: p, node }) => {
        const s = node.components.actionNode as ActionNode;
        return (
          <div className="quick-pin" key={p.id} data-testid={`qa-pin-${p.id}`}>
            <h4>
              {p.label}{' '}
              <button
                className="small"
                data-testid={`qa-open-graph-${p.id}`}
                title="Turn this into a logic graph (boxes and lines) to add branches, repeats and waits"
                onClick={() => {
                  const id = openAsGraph(doc, entity.id, p.id);
                  if (id) {
                    store.set({ graphId: id });
                    document.dispatchEvent(new CustomEvent('tw:show-panel', { detail: 'graphs' }));
                  }
                }}
              >
                Open as a graph
              </button>
            </h4>
            <ActionListEditor
              testId={`qa-list-${p.id}`}
              actions={s.actions ?? []}
              onChange={(next) => {
                if (next.length === 0) removeQuickAction(doc, entity.id, p.id, 0);
                else setQuickActions(doc, node.id, next);
              }}
            />
          </div>
        );
      })}
      {pin && (
        <>
          <SelectField<string> testId="qa-pin" label="When this object" value={pin.id} options={pins.map((p) => ({ value: p.id, label: p.label }))} onChange={setPinId} />
          <select
            data-testid="qa-add"
            aria-label="Add a quick action"
            value=""
            onChange={(e) => {
              const q = quick.find((x) => x.id === e.target.value);
              if (q) addQuickAction(doc, entity.id, pin, q.make());
            }}
          >
            <option value="">+ Then do…</option>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {quick
                  .filter((q) => q.group === g)
                  .map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <SelectField<string> testId="qa-target" label="Or make something happen to" value={targetId} options={[{ value: '', label: '(choose an object)' }, ...targets.map((t) => ({ value: t.id, label: t.name }))]} onChange={setTargetId} />
          {targetId && (
            <select
              data-testid="qa-target-action"
              aria-label="What to do to it"
              value=""
              onChange={(e) => {
                const act = targetPins.find((a) => a.id === e.target.value);
                if (act) {
                  connectToTarget(doc, entity.id, pin, targetId, act);
                  setTargetId('');
                }
              }}
            >
              <option value="">+ Do what to it…</option>
              {targetPins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          )}
          <CheckField label="Show these as wires in the viewport" value={store.state.view.wires} onChange={(v) => store.setView({ wires: v })} />
        </>
      )}
    </fieldset>
  );
}
