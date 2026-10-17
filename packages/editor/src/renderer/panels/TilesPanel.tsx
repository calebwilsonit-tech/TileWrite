import { useMemo, useState } from 'react';
import { DEFAULT_TILESET } from '@tilewright/runtime';
import { useApp, store } from '../app/store';

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

export function TilesPanel() {
  const selected = useApp((s) => s.options.tile);
  const projectTiles = useApp((s) => s.project?.project.tileset);
  const [query, setQuery] = useState('');
  const tiles = useMemo(() => {
    const list = (projectTiles && projectTiles.length > 0 ? projectTiles : Object.entries(DEFAULT_TILESET).map(([id, t]) => ({ id: Number(id), ...t }))).filter((t) => t.group === undefined); // variants are chosen by the autotile rules, not painted
    const q = query.trim().toLowerCase();
    return q ? list.filter((t) => t.name.toLowerCase().includes(q)) : list;
  }, [projectTiles, query]);

  return (
    <div className="panel tiles-panel" data-testid="tiles-panel">
      <button data-testid="btn-autotile" onClick={() => document.dispatchEvent(new CustomEvent('tw:autotile'))} title="Edges, shores and cliff faces that appear by themselves">
        Autotiling…
      </button>
      <input data-testid="tile-search" className="search" type="search" placeholder="Search tiles…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search tiles" />
      <div className="tile-grid">
        {tiles.map((t) => (
          <button
            key={t.id}
            data-testid={`tile-${t.name}`}
            className={`tile-swatch${selected === t.id ? ' on' : ''}`}
            title={`${t.name} (tile ${t.id})`}
            aria-pressed={selected === t.id}
            onClick={() => store.setOptions({ tile: t.id })}
          >
            <svg viewBox="0 0 64 56" width="48" height="42" aria-hidden="true">
              <polygon points="32,0 64,16 32,32 0,16" fill={hex(t.top)} />
              <polygon points="0,16 32,32 32,56 0,40" fill={hex(t.left)} />
              <polygon points="32,32 64,16 64,40 32,56" fill={hex(t.right)} />
            </svg>
            <span>{t.name}</span>
          </button>
        ))}
        {tiles.length === 0 && <p className="hint">No tile matches “{query}”.</p>}
      </div>
    </div>
  );
}
