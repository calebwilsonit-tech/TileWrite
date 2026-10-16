import { useApp, store } from '../app/store';

interface Row {
  key: 'ground' | 'objects' | 'regions';
  label: string;
  note: string;
}

const ROWS: Row[] = [
  { key: 'ground', label: 'Ground', note: 'tiles, heights, stairs, pits, water, bridges, blockers' },
  { key: 'objects', label: 'Objects', note: 'player, crates, props' },
  { key: 'regions', label: 'Regions', note: 'rooms: camera, music, darkness' },
];

const SOON = [
  { label: 'Decoration', note: 'arrives with the sprite studio (M4)' },
  { label: 'Walls', note: 'arrives with autotiling (M4)' },
  { label: 'Lights', note: 'arrives with lighting (M6)' },
];

export function LayersPanel() {
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
        {SOON.map((r) => (
          <li key={r.label} className="disabled">
            <label>
              <input type="checkbox" disabled checked={false} readOnly />
              <span>{r.label}</span>
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
          <small>green walk, red blocked, blue water, yellow stairs, orange bridge</small>
        </li>
        <li>
          <label>
            <input data-testid="view-heights" type="checkbox" checked={view.heightLabels} onChange={(e) => store.setView({ heightLabels: e.target.checked })} />
            <span>Height numbers</span>
          </label>
        </li>
      </ul>
    </div>
  );
}
