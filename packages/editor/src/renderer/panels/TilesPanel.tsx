import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_TILESET, compositeFrame, type SpriteData, type TileDefData } from '@tilewright/runtime';
import { useApp, store } from '../app/store';
import { ownTiles, setTileArt, tileFromSprite } from '../project/tiles';
import { studio, useStudio } from '../studio/store';
import { host } from '@tilewright/behaviors';
import { usePlugins } from '../plugins/hooks';

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** The first frame of a sprite, drawn small and clipped to the diamond of a tile's top face. */
function ArtTop({ sprite }: { sprite: SpriteData }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = sprite.width;
    c.height = sprite.height;
    c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(compositeFrame(sprite, 0)), sprite.width, sprite.height), 0, 0);
  }, [sprite]);
  return <canvas ref={ref} data-testid="tile-art-thumb" style={{ position: 'absolute', left: 0, top: 0, width: 48, height: 24, imageRendering: 'pixelated', clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' }} />;
}

/** Cover tiles with drawn art: pick a sprite for the selected tile, or make a new tile from a sprite or a PNG. */
function TileArt({ tiles }: { tiles: TileDefData[] }) {
  const selected = useApp((s) => s.options.tile);
  const project = useApp((s) => s.project?.project);
  useStudio((s) => s.assetsVersion);
  const [fresh, setFresh] = useState('');
  const sprites = [...studio.assets.keys()].sort((a, b) => a.localeCompare(b));
  const own = project ? ownTiles(project) : tiles;
  const tile = own.find((t) => t.id === selected);
  const save = (next: TileDefData[], select?: number): void => {
    if (!project) return;
    void store.updateTiles(next, project.autotile).then((ok) => ok && select !== undefined && store.setOptions({ tile: select }));
  };
  const addFrom = (name: string): void => {
    const data = studio.assets.get(name);
    if (!data) return;
    const t = tileFromSprite(own, data);
    save([...own, t], t.id);
  };
  return (
    <fieldset className="tile-art" data-testid="tile-art">
      <legend>Tile art</legend>
      <p className="hint">Cover the top of a tile with a sprite from the Sprites tab (draw it there, or import a PNG). A 64 x 32 picture of a diamond fits a tile exactly; a square picture is stretched and cut to the diamond.</p>
      {tile && (
        <label className="field">
          <span>Top of "{tile.name}"</span>
          <select data-testid="tile-art-sprite" value={tile.art ?? ''} onChange={(e) => save(setTileArt(own, tile.id, e.target.value || undefined))}>
            <option value="">(a flat colour)</option>
            {sprites.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            {tile.art && !sprites.includes(tile.art) && <option value={tile.art}>{tile.art} (missing)</option>}
          </select>
        </label>
      )}
      <div className="row wrap">
        <select data-testid="tile-from-sprite" value={fresh} onChange={(e) => setFresh(e.target.value)} aria-label="Sprite for a new tile">
          <option value="">New tile from a sprite...</option>
          {sprites.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          data-testid="tile-from-sprite-add"
          disabled={!fresh}
          onClick={() => {
            addFrom(fresh);
            setFresh('');
          }}
        >
          Make a tile
        </button>
        <button
          data-testid="tile-import-png"
          onClick={() =>
            void studio.importFile().then((name) => {
              if (name) addFrom(name);
            })
          }
          title="Pick a PNG file: it becomes a sprite and a tile covered by it"
        >
          Import a PNG as a tile…
        </button>
      </div>
    </fieldset>
  );
}

/** Kinds of block plugins brought (ice, a trampoline...): one click adds each to this project's tiles, with the rules it carries. */
function BlockKinds() {
  usePlugins();
  const tileset = useApp((s) => s.project?.project.tileset) ?? [];
  const kinds = [...host.ext.blockTypes.values()];
  if (kinds.length === 0) return null;
  return (
    <div data-testid="plugin-block-kinds">
      <h4>Kinds of block from plugins</h4>
      {kinds.map((k) => {
        const have = tileset.some((t) => t.props?.custom?.blockType === k.id);
        return (
          <button
            key={k.id}
            className="small"
            data-testid={`blocktype-add-${k.id}`}
            disabled={have}
            title={have ? 'Already one of this project\'s tiles' : `Add ${k.name} to this project's tiles`}
            onClick={() => {
              const p = store.state.project;
              if (!p) return;
              const id = Math.max(0, ...p.project.tileset.map((t) => t.id)) + 1;
              const tile: TileDefData = { id, name: k.name, top: k.top, left: k.left, right: k.right, props: { ...(k.solid === undefined ? {} : { solid: k.solid }), ...(k.tags ? { tags: k.tags } : {}), custom: { ...(k.custom ?? {}), blockType: k.id } } };
              void store.updateTiles([...p.project.tileset, tile], p.project.autotile);
            }}
          >
            {have ? `${k.name} (added)` : `Add ${k.name}`}
          </button>
        );
      })}
    </div>
  );
}

export function TilesPanel() {
  const selected = useApp((s) => s.options.tile);
  const projectTiles = useApp((s) => s.project?.project.tileset);
  useStudio((s) => s.assetsVersion);
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
      <BlockKinds />
      <input data-testid="tile-search" className="search" type="search" placeholder="Search tiles…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search tiles" />
      <div className="tile-grid">
        {tiles.map((t) => {
          const art = t.art ? studio.assets.get(t.art) : undefined;
          return (
            <button
              key={t.id}
              data-testid={`tile-${t.name}`}
              className={`tile-swatch${selected === t.id ? ' on' : ''}`}
              title={`${t.name} (tile ${t.id})${t.art ? `, covered by ${t.art}` : ''}`}
              aria-pressed={selected === t.id}
              onClick={() => store.setOptions({ tile: t.id })}
              style={{ position: 'relative' }}
            >
              <svg viewBox="0 0 64 56" width="48" height="42" aria-hidden="true">
                <polygon points="32,0 64,16 32,32 0,16" fill={hex(t.top)} />
                <polygon points="0,16 32,32 32,56 0,40" fill={hex(t.left)} />
                <polygon points="32,32 64,16 64,40 32,56" fill={hex(t.right)} />
              </svg>
              {art && <ArtTop sprite={art} />}
              <span>{t.name}</span>
            </button>
          );
        })}
        {tiles.length === 0 && <p className="hint">No tile matches “{query}”.</p>}
      </div>
      <TileArt tiles={tiles} />
    </div>
  );
}
