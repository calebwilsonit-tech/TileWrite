import { useState } from 'react';
import { behaviorList } from '@tilewright/behaviors';
import type { EntityData } from '@tilewright/runtime';
import { store, useApp } from '../app/store';

/** A short description of an object's name for wire lists. */
const label = (e: EntityData | undefined, id: string): string => e?.name ?? id;

/** Wires going into and out of the selected object, with a way to remove each. */
export function WiresSection({ entityId }: { entityId: string }) {
  useApp((s) => s.docVersion);
  const doc = store.doc;
  if (!doc) return null;
  const outgoing = doc.wires.filter((w) => w.from.entity === entityId);
  const incoming = doc.wires.filter((w) => w.to.entity === entityId);
  const hasSignals = behaviorList().some((b) => doc.getEntity(entityId)?.components[b.id] !== undefined && (b.inputs.length > 0 || b.outputs.length > 0));
  if (outgoing.length === 0 && incoming.length === 0 && !hasSignals) return null;
  return (
    <fieldset data-testid="insp-wires">
      <legend>Wires</legend>
      {outgoing.length === 0 && incoming.length === 0 && <p className="hint">No wires yet. Pick the Wire tool and drag from this object to another.</p>}
      {outgoing.map((w) => (
        <div className="row" key={w.id} data-testid="wire-out">
          <span>
            “{w.from.output}” → {label(doc.getEntity(w.to.entity), w.to.entity)} “{w.to.input}”
          </span>
          <button aria-label="Remove wire" onClick={() => doc.removeWire(w.id)}>
            ✕
          </button>
        </div>
      ))}
      {incoming.map((w) => (
        <div className="row" key={w.id} data-testid="wire-in">
          <span>
            {label(doc.getEntity(w.from.entity), w.from.entity)} “{w.from.output}” → “{w.to.input}”
          </span>
          <button aria-label="Remove wire" onClick={() => doc.removeWire(w.id)}>
            ✕
          </button>
        </div>
      ))}
    </fieldset>
  );
}

/** Shows whether an object is an instance of a prefab (with the ways to change that), or offers to make a prefab from it. */
export function PrefabBanner({ entity }: { entity: EntityData }) {
  useApp((s) => s.prefabNames);
  const [name, setName] = useState('');
  const isInstance = entity.prefab !== undefined;
  const exists = isInstance && store.prefabs.has(entity.prefab!);
  if (isInstance) {
    return (
      <div className="prefab-banner" data-testid="prefab-banner">
        <p className="hint">
          {exists ? (
            <>
              An instance of the prefab <strong>{entity.prefab}</strong>. Changing a setting here overrides it for this object only.
            </>
          ) : (
            <>The prefab “{entity.prefab}” no longer exists, so this object keeps its current settings.</>
          )}
        </p>
        {exists && (
          <div className="row">
            <button data-testid="prefab-apply" onClick={() => void store.applyToPrefab(entity.id)} title="Copy this object's settings into the prefab so all instances follow">
              Update the prefab from this
            </button>
            <button data-testid="prefab-revert" onClick={() => store.revertInstance(entity.id)} title="Throw away this object's overrides">
              Revert overrides
            </button>
            <button data-testid="prefab-unlink" onClick={() => store.unlinkInstance(entity.id)} title="Make this a plain object that no longer follows the prefab">
              Unlink
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <details className="prefab-make">
      <summary>Make a prefab from this object…</summary>
      <div className="row">
        <input data-testid="prefab-name" value={name} placeholder="Prefab name" aria-label="Prefab name" onChange={(e) => setName(e.target.value)} />
        <button
          data-testid="prefab-make"
          disabled={!name.trim()}
          onClick={() =>
            void store.createPrefab(entity.id, name).then((ok) => {
              if (ok) setName('');
            })
          }
        >
          Make prefab
        </button>
      </div>
      <p className="hint">A prefab is a reusable object. Place copies of it anywhere; change the prefab once and every copy follows (except for settings you changed on a copy).</p>
    </details>
  );
}