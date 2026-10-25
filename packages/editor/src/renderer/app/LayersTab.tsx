import { useState } from 'react';
import { freeLayerBit, layerList, projectLayerProblems } from '@tilewright/behaviors';
import { ProjectLayerSchema, type ProjectLayerData } from '@tilewright/runtime';
import { CheckField, TextField } from '../panels/fields';
import { store, useApp } from './store';

/**
 * The collision layers: what colliders belong to and which they meet. The engine and the plugins that are on bring some (shown, not
 * changed); the ones the project names are added here and may be renamed or taken away. A layer keeps its bit for good: objects already
 * placed store the number, so a layer taken away leaves them on a bit nothing is named for.
 */
export function LayersTab() {
  const project = useApp((s) => s.project)!;
  useApp((s) => s.storyVersion);
  const mine = project.project.collisionLayers ?? [];
  const [fresh, setFresh] = useState('');
  const [problem, setProblem] = useState('');
  const save = (next: ProjectLayerData[]): void => void store.updateProjectSettings({ collisionLayers: next });
  const add = (): void => {
    const name = fresh.trim().toLowerCase().replace(/\s+/g, '-');
    const bit = freeLayerBit();
    if (bit === null) return setProblem('All 16 layers are taken.');
    const layer = ProjectLayerSchema.safeParse({ name, bit, label: fresh.trim() });
    if (!layer.success) return setProblem(layer.error.issues[0]?.message ?? 'That is not a layer name.');
    const next = [...mine, layer.data];
    const problems = projectLayerProblems(next);
    if (problems.length > 0) return setProblem(problems[0]!);
    setProblem('');
    setFresh('');
    save(next);
  };
  return (
    <div data-testid="ps-layers">
      <p className="hint">Layers decide what an object collides with. Give a collider a layer, and say which layers it meets, in the Collision part of the Inspector. Scripts reach a layer by its name: <code>layer(&quot;crate&quot;)</code>.</p>
      <ul className="layer-list">
        {layerList().map((l) => {
          const own = l.source === 'project' ? mine.find((m) => m.name === l.name) : undefined;
          return (
            <li key={l.name} data-testid={`layer-${l.name}`}>
              <strong>{l.label}</strong> <small>({l.name}, bit {l.bit}, {l.source === 'engine' ? 'the engine' : l.source === 'plugin' ? 'a plugin' : 'this project'})</small>
              {own && (
                <>
                  <TextField label="Label" value={own.label ?? own.name} onCommit={(v) => save(mine.map((m) => (m.name === own.name ? { ...m, label: v.trim() || m.name } : m)))} />
                  <CheckField label="A layer of ghosts (a gate set to let ghosts pass lets it through)" value={own.ghost === true} onChange={(v) => save(mine.map((m) => (m.name === own.name ? { ...m, ghost: v } : m)))} />
                  <button className="small" data-testid={`layer-remove-${l.name}`} onClick={() => save(mine.filter((m) => m.name !== own.name))}>
                    Take away
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="row">
        <input data-testid="layer-new-name" placeholder="New layer name" value={fresh} onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button data-testid="layer-new" onClick={add}>
          Add a layer
        </button>
      </div>
      {problem && <p className="hint warn">{problem}</p>}
    </div>
  );
}
