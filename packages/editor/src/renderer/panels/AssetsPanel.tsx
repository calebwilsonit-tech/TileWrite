import { useState } from 'react';
import { store, useApp } from '../app/store';
import { SpriteThumb } from '../studio/StudioView';
import { studio, useStudio } from '../studio/store';
import { applySprite } from '../studio/apply';

/** Every sprite in the project: search by name or tag, edit, tag, and use on the selected object. */
export function AssetsPanel() {
  useStudio((s) => s.assetsVersion);
  const prefabNames = useApp((s) => s.prefabNames);
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
      <h3>Prefabs</h3>
      {prefabNames.length === 0 && <p className="hint">No prefabs yet. Select an object, then “Make a prefab from this object” in the Inspector.</p>}
      <ul className="plain prefab-list" data-testid="prefab-list">
        {prefabNames.map((n) => (
          <li key={n} className="row">
            <span>{n}</span>
            <button
              data-testid={`prefab-place-${n}`}
              onClick={() => {
                store.setOptions({ prefab: `prefab:${n}` });
                store.set({ tool: 'place' });
              }}
              title="Choose the Place tool with this prefab"
            >
              Place
            </button>
            <button aria-label={`Delete prefab ${n}`} onClick={() => void store.removePrefab(n)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <h3>Sounds and music</h3>
      <p className="hint">
        Add WAV, OGG or MP3 files. A file's name is how the game asks for it: "hit", "hurt" and "defeat" play on their own when a fight happens; any other name is used by a Play a sound action, a cutscene or a region's music.
      </p>
      <div className="row">
        <button data-testid="sound-add" onClick={() => void studio.importSoundFile()}>
          Add a sound file…
        </button>
      </div>
      {studio.sounds.length === 0 && <p className="hint">No sounds yet.</p>}
      <ul className="plain sound-list" data-testid="sound-list">
        {studio.sounds.map((s) => (
          <li key={s.file} className="row" data-testid={`sound-${s.name}`}>
            <span>{s.name}</span>
            <button aria-label={`Play ${s.name}`} title="Listen to it" onClick={() => void studio.previewSound(s)}>
              ▶
            </button>
            <button aria-label={`Delete sound ${s.name}`} onClick={() => void studio.removeSound(s.file)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
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