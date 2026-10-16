import { FACING_NAMES, type EntityData, type RegionData } from '@tilewright/runtime';
import { useApp, store } from '../app/store';
import { copySelection, deleteSelection, pasteClipboard, rotateSelection } from '../app/commands';
import { CheckField, NumberField, SelectField, TextField, hexToNumber, numberToHex } from './fields';

type Rec = Record<string, unknown>;

const FACING_OPTIONS = FACING_NAMES.map((n, i) => ({ value: i, label: n }));
const SHAPES = [
  { value: 'box', label: 'Box' },
  { value: 'diamond', label: 'Flat diamond' },
];
const KNOWN = new Set(['transform', 'sprite', 'collider', 'playerController', 'body']);

function comp<T extends Rec>(e: EntityData, name: string): T | undefined {
  return e.components[name] as T | undefined;
}

function EntityInspector({ ids }: { ids: string[] }) {
  const doc = store.doc!;
  const ents = ids.map((id) => doc.getEntity(id)).filter((e): e is EntityData => !!e);
  if (ents.length === 0) return <p className="hint">Nothing selected.</p>;

  if (ents.length > 1) {
    return (
      <div data-testid="inspector-multi">
        <h3>{ents.length} objects selected</h3>
        <div className="row">
          <button onClick={rotateSelection}>Rotate</button>
          <button onClick={() => { copySelection(); pasteClipboard(); }}>Duplicate</button>
          <button onClick={deleteSelection}>Delete</button>
        </div>
        <ul className="plain">
          {ents.map((e) => (
            <li key={e.id}>{e.name}</li>
          ))}
        </ul>
      </div>
    );
  }

  const e = ents[0]!;
  const t = comp<{ x: number; y: number; h: number; facing: number }>(e, 'transform');
  const s = comp<{ shape: string; color: number; w: number; d: number; height: number; visible: boolean }>(e, 'sprite');
  const c = comp<{ w: number; d: number; height: number; solid: boolean; trigger: boolean }>(e, 'collider');
  const pc = comp<{ speed: number; runMultiplier: number; jumpSpeed: number }>(e, 'playerController');
  const edit = (label: string, fn: (x: EntityData) => void): void => doc.updateEntities([e.id], label, fn);
  const setC = (name: string, key: string, value: unknown, label: string): void =>
    edit(label, (x) => {
      (x.components[name] as Rec)[key] = value;
    });

  return (
    <div data-testid="inspector-entity">
      <h3>{e.name}</h3>
      <TextField testId="insp-name" label="Name" value={e.name} onCommit={(v) => edit('Rename object', (x) => (x.name = v.trim() || x.name))} />
      <TextField label="Tags (comma separated)" value={e.tags.join(', ')} onCommit={(v) => edit('Change tags', (x) => (x.tags = v.split(',').map((q) => q.trim()).filter(Boolean)))} />
      {t && (
        <fieldset>
          <legend>Position</legend>
          <NumberField testId="insp-x" label="X" step={0.5} value={t.x} onCommit={(v) => setC('transform', 'x', v, 'Move object')} />
          <NumberField testId="insp-y" label="Y" step={0.5} value={t.y} onCommit={(v) => setC('transform', 'y', v, 'Move object')} />
          <NumberField testId="insp-h" label="Height" step={0.5} value={t.h} onCommit={(v) => setC('transform', 'h', v, 'Change height')} />
          <SelectField label="Facing" value={t.facing} options={FACING_OPTIONS} onChange={(v) => setC('transform', 'facing', v, 'Turn object')} />
        </fieldset>
      )}
      {s && (
        <fieldset>
          <legend>Look</legend>
          <SelectField label="Shape" value={s.shape} options={SHAPES} onChange={(v) => setC('sprite', 'shape', v, 'Change shape')} />
          <label className="field">
            <span>Colour</span>
            <input type="color" data-testid="insp-color" value={numberToHex(s.color)} onChange={(ev) => setC('sprite', 'color', hexToNumber(ev.target.value), 'Change colour')} />
          </label>
          <NumberField label="Width" step={0.1} min={0.1} value={s.w} onCommit={(v) => setC('sprite', 'w', v, 'Resize object')} />
          <NumberField label="Depth" step={0.1} min={0.1} value={s.d} onCommit={(v) => setC('sprite', 'd', v, 'Resize object')} />
          <NumberField label="Height" step={0.1} min={0.05} value={s.height} onCommit={(v) => setC('sprite', 'height', v, 'Resize object')} />
          <CheckField label="Visible" value={s.visible} onChange={(v) => setC('sprite', 'visible', v, 'Toggle visible')} />
        </fieldset>
      )}
      {c && (
        <fieldset>
          <legend>Collision</legend>
          <CheckField label="Solid (blocks walking)" value={c.solid} onChange={(v) => setC('collider', 'solid', v, 'Toggle solid')} />
          <CheckField label="Trigger area" value={c.trigger} onChange={(v) => setC('collider', 'trigger', v, 'Toggle trigger')} />
          <NumberField label="Width" step={0.1} min={0.1} value={c.w} onCommit={(v) => setC('collider', 'w', v, 'Resize collider')} />
          <NumberField label="Depth" step={0.1} min={0.1} value={c.d} onCommit={(v) => setC('collider', 'd', v, 'Resize collider')} />
          <NumberField label="Height" step={0.1} min={0.1} value={c.height} onCommit={(v) => setC('collider', 'height', v, 'Resize collider')} />
        </fieldset>
      )}
      {pc && (
        <fieldset>
          <legend>Player controller</legend>
          <NumberField testId="insp-speed" label="Walk speed" step={0.5} min={0.5} max={20} value={pc.speed} onCommit={(v) => setC('playerController', 'speed', v, 'Change speed')} />
          <NumberField label="Run multiplier" step={0.1} min={1} max={4} value={pc.runMultiplier} onCommit={(v) => setC('playerController', 'runMultiplier', v, 'Change run speed')} />
          <NumberField label="Jump speed (0 = no jump)" step={0.5} min={0} max={30} value={pc.jumpSpeed} onCommit={(v) => setC('playerController', 'jumpSpeed', v, 'Change jump')} />
        </fieldset>
      )}
      {Object.keys(e.components).some((k) => !KNOWN.has(k)) && (
        <fieldset>
          <legend>Other components</legend>
          <ul className="plain">
            {Object.keys(e.components)
              .filter((k) => !KNOWN.has(k))
              .map((k) => (
                <li key={k}>{k}</li>
              ))}
          </ul>
        </fieldset>
      )}
      <div className="row">
        <button onClick={rotateSelection}>Rotate</button>
        <button onClick={() => { copySelection(); pasteClipboard(); }}>Duplicate</button>
        <button data-testid="insp-delete" onClick={deleteSelection}>Delete</button>
      </div>
    </div>
  );
}

function RegionInspector({ id }: { id: string }) {
  const doc = store.doc!;
  const r = doc.regions.find((x) => x.id === id);
  if (!r) return <p className="hint">Region not found.</p>;
  const edit = (label: string, fn: (x: RegionData) => void): void => doc.updateRegion(id, label, fn);
  return (
    <div data-testid="inspector-region">
      <h3>Region: {r.name}</h3>
      <TextField label="Name" value={r.name} onCommit={(v) => edit('Rename region', (x) => (x.name = v.trim() || x.name))} />
      <fieldset>
        <legend>Area (cells)</legend>
        <NumberField label="X" value={r.x} onCommit={(v) => edit('Move region', (x) => (x.x = Math.round(v)))} />
        <NumberField label="Y" value={r.y} onCommit={(v) => edit('Move region', (x) => (x.y = Math.round(v)))} />
        <NumberField label="Width" min={1} value={r.w} onCommit={(v) => edit('Resize region', (x) => (x.w = Math.max(1, Math.round(v))))} />
        <NumberField label="Height" min={1} value={r.h} onCommit={(v) => edit('Resize region', (x) => (x.h = Math.max(1, Math.round(v))))} />
      </fieldset>
      <CheckField testId="reg-camera" label="Keep the camera inside this room" value={r.cameraBounds} onChange={(v) => edit('Toggle camera bounds', (x) => (x.cameraBounds = v))} />
      <TextField label="Music (file name, optional)" value={r.music} onCommit={(v) => edit('Set music', (x) => (x.music = v.trim()))} />
      <label className="field">
        <span>Darkness {Math.round(r.darkness * 100)}%</span>
        <input type="range" min={0} max={1} step={0.05} value={r.darkness} onChange={(e) => edit('Set darkness', (x) => (x.darkness = Number(e.target.value)))} />
      </label>
      <CheckField label="Bosses here only act while the player is inside" value={r.bossActive} onChange={(v) => edit('Toggle boss area', (x) => (x.bossActive = v))} />
      <div className="row">
        <button onClick={deleteSelection}>Delete region</button>
      </div>
    </div>
  );
}

function SceneInspector() {
  const doc = store.doc!;
  const project = store.state.project;
  const resize = (w: number, h: number): void => {
    if (w !== doc.map.width || h !== doc.map.height) doc.resizeMap(w, h);
  };
  return (
    <div data-testid="inspector-scene">
      <h3>Scene</h3>
      <TextField label="Scene name" value={doc.name} onCommit={(v) => doc.rename(v.trim() || doc.name)} />
      <fieldset>
        <legend>Map size (cells)</legend>
        <NumberField testId="scene-w" label="Width" min={4} max={256} value={doc.map.width} onCommit={(v) => resize(Math.round(v), doc.map.height)} />
        <NumberField testId="scene-h" label="Height" min={4} max={256} value={doc.map.height} onCommit={(v) => resize(doc.map.width, Math.round(v))} />
        <p className="hint">Growing the map adds grass; shrinking keeps the top-left part. Undo brings it back.</p>
      </fieldset>
      <p className="hint">
        {doc.entities.length} object{doc.entities.length === 1 ? '' : 's'}, {doc.regions.length} region{doc.regions.length === 1 ? '' : 's'}. Project: {project?.project.name}
      </p>
    </div>
  );
}

export function InspectorPanel() {
  const selection = useApp((s) => s.selection);
  const region = useApp((s) => s.selectedRegion);
  useApp((s) => s.docVersion);
  if (!store.doc) return null;
  return (
    <div className="panel inspector" data-testid="inspector">
      {selection.length > 0 ? <EntityInspector ids={selection} /> : region ? <RegionInspector id={region} /> : <SceneInspector />}
    </div>
  );
}
