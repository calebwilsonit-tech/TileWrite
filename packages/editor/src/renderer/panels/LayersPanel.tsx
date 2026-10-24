import { useEffect, useState } from 'react';
import { useApp, store } from '../app/store';
import { collisionLegend } from '../viewport/palette';

interface Row {
  key: 'ground' | 'walls' | 'objects' | 'decoration' | 'lightsLayer' | 'regions';
  label: string;
  note: string;
}

const ROWS: Row[] = [
  { key: 'ground', label: 'Ground', note: 'tiles, heights, stairs, pits, water, bridges, blockers' },
  { key: 'walls', label: 'Walls', note: 'tiles marked as walls (brick by default; change it in Autotiling)' },
  { key: 'objects', label: 'Objects', note: 'player, crates, props; hiding or locking this hides or locks decoration and lights too' },
  { key: 'decoration', label: 'Decoration', note: 'flowers, rugs, rocks, bushes: things with the decoration tag' },
  { key: 'lightsLayer', label: 'Lights', note: 'lanterns and anything else that shines' },
  { key: 'regions', label: 'Regions', note: 'rooms: camera, music, darkness' },
];


export function LayersPanel() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const on = (): void => setTick((n) => n + 1);
    document.addEventListener('tw:palette', on); // the colour-blind-safe setting changed
    return () => document.removeEventListener('tw:palette', on);
  }, []);
  const view = useApp((s) => s.view);
  const locks = useApp((s) => s.locks);
  return (
    <div className="panel layers" data-testid="layers-panel">
      <h3>Layers</h3>
      <ul className="layer-list">
        {ROWS.map((r) => (
          <li key={r.key}>
            <label title={`Show or hide the ${r.label.toLowerCase()} layer`}>
              <input data-testid={`vis-${r.key}`} type="checkbox" checked={view[r.key]} onChange={(e) => store.setView({ [r.key]: e.target.checked })} />
              <span>{r.label}</span>
            </label>
            <label className="lock" title={`Lock the ${r.label.toLowerCase()} layer so tools cannot change it`}>
              <input data-testid={`lock-${r.key}`} type="checkbox" checked={locks[r.key]} onChange={(e) => store.set({ locks: { ...locks, [r.key]: e.target.checked } })} />
              <span>Lock</span>
            </label>
            <small>{r.note}</small>
          </li>
        ))}
      </ul>
      <h3>Overlays</h3>
      <ul className="layer-list">
        <li>
          <label>
            <input data-testid="view-grid" type="checkbox" checked={view.grid} onChange={(e) => store.setView({ grid: e.target.checked })} />
            <span>Grid</span>
          </label>
        </li>
        <li>
          <label>
            <input data-testid="view-collision" type="checkbox" checked={view.collision} onChange={(e) => store.setView({ collision: e.target.checked })} />
            <span>Collision colours</span>
          </label>
          <small data-testid="collision-legend">{collisionLegend()}</small>
          <label className="opt">
            <span>Seen by a walker at</span>
            <select data-testid="view-collision-level" value={view.collisionLevel === null ? 'auto' : String(view.collisionLevel)} onChange={(e) => store.setView({ collisionLevel: e.target.value === 'auto' ? null : Number(e.target.value) })}>
              <option value="auto">the floor of each cell</option>
              {Array.from({ length: 13 }, (_, i) => (
                <option key={i} value={i}>
                  height {i}
                </option>
              ))}
            </select>
          </label>
        </li>
        <li>
          <label>
            <input data-testid="view-xray" type="checkbox" checked={view.xray} onChange={(e) => store.setView({ xray: e.target.checked })} />
            <span>See through the world (x-ray)</span>
          </label>
        </li>
        <li>
          <label>
            <span>Show only blocks below level </span>
            <input data-testid="view-slice" type="number" min={0} max={12} value={view.slice} style={{ width: 54 }} onChange={(e) => store.setView({ slice: Math.max(0, Math.min(255, Math.round(Number(e.target.value) || 0))) })} />
            <span> (0 shows all)</span>
          </label>
        </li>
        <li>
          <label>
            <input data-testid="view-heights" type="checkbox" checked={view.heightLabels} onChange={(e) => store.setView({ heightLabels: e.target.checked })} />
            <span>Height numbers</span>
          </label>
        </li>
        <li>
          <label>
            <input data-testid="view-triggers" type="checkbox" checked={view.triggers} onChange={(e) => store.setView({ triggers: e.target.checked })} />
            <span>Trigger areas and solid objects</span>
          </label>
          <small>purple walk-through areas, red solid things</small>
        </li>
        <li>
          <label>
            <input data-testid="view-ai" type="checkbox" checked={view.ai} onChange={(e) => store.setView({ ai: e.target.checked })} />
            <span>Guard routes and view cones</span>
          </label>
          <small>orange cone = what it sees, yellow ring = what it hears, teal line = its route</small>
        </li>
        <li>
          <label>
            <input data-testid="view-lights" type="checkbox" checked={view.lights} onChange={(e) => store.setView({ lights: e.target.checked })} />
            <span>How far lights reach</span>
          </label>
        </li>
        <li>
          <label>
            <input data-testid="view-depth" type="checkbox" checked={view.depth} onChange={(e) => store.setView({ depth: e.target.checked })} />
            <span>Draw order numbers</span>
          </label>
          <small>higher numbers are drawn in front</small>
        </li>
        <li>
          <label>
            <input data-testid="view-wires" type="checkbox" checked={view.wires} onChange={(e) => store.setView({ wires: e.target.checked })} />
            <span>Wires (lit while playing)</span>
          </label>
          <small>the lines between buttons, plates, gates and nodes; they glow while a signal runs through them</small>
        </li>
        <li>
          <label>
            <input data-testid="view-profiler" type="checkbox" checked={view.profiler} onChange={(e) => store.setView({ profiler: e.target.checked })} />
            <span>Speed meter (while playing)</span>
          </label>
          <small>frames per second, time per step, what is slowest</small>
        </li>
        <li>
          <label>
            <input data-testid="view-screens" type="checkbox" checked={view.screens} onChange={(e) => store.setView({ screens: e.target.checked })} />
            <span>Screens (while playing)</span>
          </label>
          <small>which interface screens are open, what each does with Back, and which one handled the last press</small>
        </li>
      </ul>
    </div>
  );
}
