import { useState } from 'react';
import { store, useApp } from '../app/store';
import { SpriteThumb } from '../studio/StudioView';
import { studio, useStudio } from '../studio/store';
import { applySprite } from '../studio/apply';

/** Every sprite in the project: search by name or tag, edit, tag, and use on the selected object. */
export function AssetsPanel() {
  useStudio((s) => s.assetsVersion);
  const names = useStudio((s) => s.names);
  const query = useStudio((s) => s.query);
  const selection = useApp((s) => s.selection);
  const [picked, setPicked] = useState<string | null>(null);
  const [tagText, setTagText] = useState('');
  const q = query.trim().toLowerCase();
  const shown = names.filter((n) => !q || n.toLowerCase().includes(q) || (studio.meta.tags[n] ?? []).some((t) => t.includes(q)));
  const data = picked ? studio.assets.get(picked) : undefined;

  return (
    <div className="panel assets" data-testid="assets-panel">
      <input className="search" type="search" placeholder="Search sprites or tags…" aria-label="Search assets" value={query} onChange={(e) => studio.set({ query: e.target.value })} />
      <div className="asset-grid">
        {shown.map((n) => (
          <button
            key={n}
            data-testid={`asset-${n}`}
            className={`asset${picked === n ? ' tile-swatch on' : ''}`}
            title={n}
            onClick={() => {
              setPicked(n);
              setTagText((studio.meta.tags[n] ?? []).join(', '));
            }}
            onDoubleClick={() => {
              store.set({ workspace: 'sprites' });
              studio.openSprite(n);
            }}
          >
            <SpriteThumb data={studio.assets.get(n)!} size={48} />
            <span>{n}</span>
          </button>
        ))}
      </div>
      {names.length === 0 && <p className="hint">No sprites yet. Open the Sprites tab to draw one or import a PNG.</p>}
      {data && (
        <div className="asset-detail">
          <h3>{data.name}</h3>
          <p className="hint">
            {data.width} x {data.height} px, {data.frames.length} frame{data.frames.length === 1 ? '' : 's'}, {data.clips.length} animation{data.clips.length === 1 ? '' : 's'}
          </p>
          <label className="field">
            <span>Tags</span>
            <input
              value={tagText}
              placeholder="character, enemy…"
              onChange={(e) => setTagText(e.target.value)}
              onBlur={() => void studio.setTags(data.name, tagText.split(','))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
          <div className="row">
            <button
              onClick={() => {
                store.set({ workspace: 'sprites' });
                studio.openSprite(data.name);
              }}
            >
              Edit in Sprite studio
            </button>
            <button
              data-testid="asset-use"
              disabled={selection.length === 0}
              title={selection.length === 0 ? 'Select an object in the world first' : 'Draw the selected object with this sprite'}
              onClick={() => store.doc?.updateEntities(selection, 'Use sprite', (x) => applySprite(x, data))}
            >
              Use on selected object
            </button>
          </div>
        </div>
      )}
    </div>
  );
}