import { useMemo, useState } from 'react';
import {
  DEFAULT_TILESET,
  GENERATOR_HELP,
  GENERATOR_KINDS,
  GENERATOR_NAMES,
  SCATTER_NAMES,
  SCATTER_PLACES,
  generate,
  newGeneratorSpec,
  startReachesEnd,
  tilesetFromList,
  type GeneratorKind,
  type GeneratorSpec,
  type ScatterPlace,
  type ScatterRule,
} from '@tilewright/runtime';
import { store, useApp } from '../app/store';
import { CheckField, NumberField, SelectField } from './fields';

/**
 * Procedural maps: pick a kind (rooms and corridors, caves, islands, a town), set a few rules, press Generate. The same seed
 * gives the same map, so a locked seed is a level you made; unlocked, each new run of the game makes its own.
 */
export function GeneratePanel() {
  useApp((s) => s.docVersion);
  const project = useApp((s) => s.project);
  const prefabNames = useApp((s) => s.prefabNames);
  const doc = store.doc;
  const [spec, setSpec] = useState<GeneratorSpec>(() => doc?.generator ?? newGeneratorSpec('dungeon'));
  const [report, setReport] = useState<string[]>([]);
  const tiles = useMemo(() => {
    const list = project?.project.tileset ?? [];
    const set = tilesetFromList(list) ?? DEFAULT_TILESET;
    return Object.entries(set).map(([id, t]) => ({ value: Number(id), label: t.name }));
  }, [project]);
  const set = (patch: Partial<GeneratorSpec>): void => setSpec((s) => ({ ...s, ...patch }));
  const made = useMemo(() => generate(spec), [spec]);
  if (!doc) return null;
  const preview = { rooms: made.rooms.length, ok: startReachesEnd(made), notes: made.notes };
  const tile = (key: 'floorTile' | 'wallTile' | 'waterTile' | 'sandTile' | 'grassTile' | 'roadTile', label: string) => <SelectField<number> label={label} testId={`gen-${key}`} value={spec[key]} options={tiles} onChange={(v) => set({ [key]: v } as Partial<GeneratorSpec>)} />;
  const rule = (i: number, patch: Partial<ScatterRule>): void => set({ scatter: spec.scatter.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <div className="panel generate-panel story-body" data-testid="generate-panel">
      <p className="hint">{GENERATOR_HELP[spec.kind]}</p>
      <SelectField<GeneratorKind> label="Kind of map" testId="gen-kind" value={spec.kind} options={GENERATOR_KINDS.map((k) => ({ value: k, label: GENERATOR_NAMES[k] }))} onChange={(kind) => setSpec({ ...newGeneratorSpec(kind), seed: spec.seed, lockSeed: spec.lockSeed, atStart: spec.atStart, scatter: spec.scatter, width: spec.width, height: spec.height })} />
      <div className="row">
        <NumberField label="Wide (cells)" testId="gen-width" value={spec.width} min={8} max={512} onCommit={(v) => set({ width: Math.round(v) })} />
        <NumberField label="Deep (cells)" testId="gen-height" value={spec.height} min={8} max={512} onCommit={(v) => set({ height: Math.round(v) })} />
      </div>
      <div className="row">
        <NumberField label="Seed" testId="gen-seed" value={spec.seed} min={0} onCommit={(v) => set({ seed: Math.round(v) })} />
        <button data-testid="gen-reroll" onClick={() => set({ seed: Math.floor(Math.random() * 1_000_000) })}>
          Roll a new seed
        </button>
      </div>
      <CheckField label="Lock the seed (always make this map; unlocked, each new run makes its own)" testId="gen-lock" value={spec.lockSeed} onChange={(v) => set({ lockSeed: v })} />
      <CheckField label="Make the map when the game starts (instead of keeping it in the scene)" testId="gen-atstart" value={spec.atStart} onChange={(v) => set({ atStart: v })} />

      {spec.kind === 'dungeon' && (
        <>
          <NumberField label="Rooms" testId="gen-rooms" value={spec.rooms} min={1} max={200} onCommit={(v) => set({ rooms: Math.round(v) })} />
          <NumberField label="Smallest room" value={spec.roomMin} min={3} max={30} onCommit={(v) => set({ roomMin: Math.round(v) })} />
          <NumberField label="Largest room" value={spec.roomMax} min={3} max={40} onCommit={(v) => set({ roomMax: Math.round(v) })} />
          <NumberField label="Corridor width" value={spec.corridorWidth} min={1} max={3} onCommit={(v) => set({ corridorWidth: Math.round(v) })} />
        </>
      )}
      {spec.kind === 'cave' && (
        <>
          <NumberField label="Rock (0.2 - 0.7: more rock, tighter caves)" testId="gen-fill" value={spec.fill} min={0.2} max={0.7} step={0.01} onCommit={(v) => set({ fill: v })} />
          <NumberField label="Smoothing steps" value={spec.smoothing} min={0} max={10} onCommit={(v) => set({ smoothing: Math.round(v) })} />
        </>
      )}
      {spec.kind === 'island' && (
        <>
          <NumberField label="Land (0.1 - 0.9 of the map)" value={spec.landRatio} min={0.1} max={0.9} step={0.05} onCommit={(v) => set({ landRatio: v })} />
          <NumberField label="Hill levels" value={spec.hills} min={0} max={4} onCommit={(v) => set({ hills: Math.round(v) })} />
        </>
      )}
      {spec.kind === 'town' && (
        <>
          <NumberField label="Distance between roads" value={spec.roadSpacing} min={5} max={24} onCommit={(v) => set({ roadSpacing: Math.round(v) })} />
          <SelectField<string> label="Building prefab" testId="gen-building" value={spec.buildingPrefab} options={[{ value: '', label: '(choose a prefab)' }, ...prefabNames.map((n) => ({ value: n, label: n }))]} onChange={(v) => set({ buildingPrefab: v })} />
          <NumberField label="Building size (cells)" value={spec.buildingSize} min={2} max={8} onCommit={(v) => set({ buildingSize: Math.round(v) })} />
        </>
      )}
      <details>
        <summary>Tiles and walls</summary>
        {tile('floorTile', 'Floor')}
        {(spec.kind === 'dungeon' || spec.kind === 'cave') && tile('wallTile', 'Walls')}
        {(spec.kind === 'dungeon' || spec.kind === 'cave') && <NumberField label="Wall height" value={spec.wallHeight} min={1} max={8} onCommit={(v) => set({ wallHeight: Math.round(v) })} />}
        {spec.kind === 'island' && tile('waterTile', 'Water')}
        {spec.kind === 'island' && tile('sandTile', 'Beach')}
        {(spec.kind === 'island' || spec.kind === 'town') && tile('grassTile', 'Grass')}
        {spec.kind === 'town' && tile('roadTile', 'Roads')}
      </details>

      <h4>Things to place</h4>
      <p className="hint">Each rule places a prefab (from Assets, Prefabs) somewhere on the map. Rooms, the start, the exit, shores and corridors are known to every kind.</p>
      {spec.scatter.map((r, i) => (
        <fieldset className="story-card" key={i} data-testid={`gen-rule-${i}`}>
          <legend>{r.prefab || 'a prefab'}</legend>
          <SelectField<string> label="Prefab" testId={`gen-rule-prefab-${i}`} value={r.prefab} options={[{ value: '', label: '(choose)' }, ...prefabNames.map((n) => ({ value: n, label: n }))]} onChange={(v) => rule(i, { prefab: v })} />
          <SelectField<ScatterPlace> label="Where" testId={`gen-rule-where-${i}`} value={r.where} options={SCATTER_PLACES.map((p) => ({ value: p, label: SCATTER_NAMES[p] }))} onChange={(v) => rule(i, { where: v })} />
          <NumberField label="How many (0 = by chance)" testId={`gen-rule-count-${i}`} value={r.count} min={0} max={500} onCommit={(v) => rule(i, { count: Math.round(v) })} />
          {r.count === 0 && <NumberField label="Chance per cell (0 - 1)" value={r.chance} min={0} max={1} step={0.01} onCommit={(v) => rule(i, { chance: v })} />}
          <NumberField label="At least this far apart (cells)" value={r.spacing} min={0} max={32} onCommit={(v) => rule(i, { spacing: v })} />
          <label className="field">
            <span>Tag (so event rows can find them)</span>
            <input value={r.tag} onChange={(e) => rule(i, { tag: e.target.value.trim() })} />
          </label>
          <button className="small" onClick={() => set({ scatter: spec.scatter.filter((_, j) => j !== i) })}>
            Remove this rule
          </button>
        </fieldset>
      ))}
      <button data-testid="gen-add-rule" onClick={() => set({ scatter: [...spec.scatter, { prefab: prefabNames[0] ?? '', where: 'room', count: 0, chance: 0.02, spacing: 2, tag: '' }] })}>
        + A thing to place
      </button>

      <div className="row wrap">
        <button
          data-testid="gen-apply"
          className="primary"
          onClick={() => {
            const result = doc.applyGenerated(`Generate ${GENERATOR_NAMES[spec.kind].toLowerCase()}`, spec, generate(spec));
            setReport(result.problems);
            store.notify('info', result.problems.length > 0 ? 'The map was made, with some remarks (see the Generate panel).' : 'The map was made.');
          }}
        >
          Make the map now
        </button>
        <button
          data-testid="gen-save"
          onClick={() => {
            doc.setGenerator('Change the map rules', spec);
            store.notify('info', spec.atStart ? 'The rules are saved: the map is made when the game starts.' : 'The rules are saved with the scene.');
          }}
        >
          Keep these rules in the scene
        </button>
        {doc.generator && (
          <button data-testid="gen-forget" onClick={() => doc.setGenerator('Forget the map rules', null)}>
            Forget the rules
          </button>
        )}
      </div>
      <p className="hint" data-testid="gen-preview">
        {preview.rooms > 0 ? `${preview.rooms} room${preview.rooms === 1 ? '' : 's'}. ` : ''}
        {preview.ok ? 'You can walk from the start to the exit.' : 'The exit cannot be reached from the start.'} The start is at {made.start.x}, {made.start.y} and the exit at {made.end.x}, {made.end.y}.
      </p>
      {[...preview.notes, ...report.filter((r) => !preview.notes.includes(r))].length > 0 && (
        <ul className="problems" data-testid="gen-notes">
          {[...preview.notes, ...report.filter((r) => !preview.notes.includes(r))].map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
