import { useEffect, useMemo, useRef, useState } from 'react';
import { compositeFrame, type SpriteData, type SpriteMeta, type TileDefData } from '@tilewright/runtime';
import { store, useApp } from '../app/store';
import { ownTiles } from '../project/tiles';
import { CheckField, NumberField, SelectField, TextField } from '../panels/fields';
import { blankSprite } from '../studio/assets';
import { studio, useStudio } from '../studio/store';
import {
  RECOLOUR_PRESETS,
  blankRgba,
  blobSlots,
  clipTo,
  drawEdges,
  isEmpty,
  mirror,
  recolourSprite,
  shadeFaces,
  splitBlock,
  spriteFromFrames,
  spriteFromRgba,
  type Recolour,
  type Rgba,
} from './pixels';
import { presetOf, presetsFor, propCanvas, spriteGuides, type IsoSize, type Preset } from './presets';
import { addEdgeSet, emptyTileForm, formOfTile, missingSlots, slotSpriteName, tileOfSprite, upsertTile, type TileForm } from './tiles';

const useIso = (): IsoSize => useApp((s) => s.project?.project.iso) ?? { tileW: 64, tileH: 32, heightPx: 16 };

const KINDS: { value: SpriteMeta['kind']; label: string }[] = [
  { value: 'sprite', label: 'A plain sprite' },
  { value: 'tile', label: 'Floor tile or block' },
  { value: 'wall', label: 'Wall face' },
  { value: 'cliff', label: 'Cliff face' },
  { value: 'stairs', label: 'Stairs' },
  { value: 'prop', label: 'Tall prop or building' },
  { value: 'attachment', label: 'Wall or floor attachment' },
  { value: 'decal', label: 'Decal (cracks, moss, flowers)' },
];

const imageOf = (img: Rgba): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
};

const rgbaOfCanvas = (c: HTMLCanvasElement): Rgba => {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
  return { width: c.width, height: c.height, data: d.data };
};

/** A sprite as it is open in the studio right now (unsaved drawing included). */
function currentSprite(): SpriteData | null {
  return studio.doc ? studio.doc.toSprite() : null;
}

// ---------- making a picture from a preset ----------

export function TileStudioLeft() {
  const iso = useIso();
  const presets = useMemo(() => presetsFor(iso), [iso]);
  const [presetId, setPresetId] = useState('flat');
  const [name, setName] = useState('meadow');
  const names = useStudio((s) => s.names);
  const preset = presets.find((p) => p.id === presetId) ?? presets[0]!;
  const groups = [...new Set(presets.map((p) => p.group))];
  const taken = names.some((n) => n.toLowerCase() === name.trim().toLowerCase());
  const create = async (): Promise<void> => {
    const base = blankSprite(name.trim(), preset.width, preset.height);
    const layer = base.layers[0]!.id;
    const frames = Array.from({ length: preset.frames ?? 1 }, () => ({ duration: 200, cels: { ...base.frames[0]!.cels }, boxes: [] }));
    const meta: SpriteMeta = {
      kind: 'sprite',
      preset: preset.id,
      footprint: { w: 1, d: 1 },
      heightCells: 1,
      collision: null,
      fade: null,
      sortOffset: 0,
      sway: false,
      variants: [],
      face: 'wall',
      otherSide: '',
      light: 0,
      tags: [],
      ...preset.meta,
    } as SpriteMeta;
    void layer;
    const data: SpriteData = { ...base, frames, origin: { x: Math.round(preset.origin[0]), y: Math.round(preset.origin[1]) }, meta };
    await studio.putSprite(data, true);
  };
  return (
    <fieldset className="studio-section" data-testid="ts-new">
      <legend>New picture for the world</legend>
      <label className="field">
        <span>Canvas</span>
        <select data-testid="ts-preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {presets
                .filter((p) => p.group === g)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="hint" data-testid="ts-preset-hint">
        {preset.hint}
      </p>
      <label className="field">
        <span>Name</span>
        <input data-testid="ts-name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {taken && <p className="warn-text">A sprite called “{name.trim()}” already exists.</p>}
      <button className="primary" data-testid="ts-create" disabled={!name.trim() || taken} onClick={() => void create()}>
        Create ({preset.width} x {preset.height})
      </button>
    </fieldset>
  );
}

// ---------- the kind of thing, guides, faces ----------

function KindSection() {
  const iso = useIso();
  useStudio((s) => s.docVersion);
  const showGuides = useStudio((s) => s.showGuides);
  const doc = studio.doc;
  if (!doc) return <p className="hint">Open or make a sprite first.</p>;
  const meta = doc.meta;
  const preset = presetOf(iso, meta);
  const set = (fn: (m: SpriteMeta) => void): void => doc.setMeta('Change what it is', fn);

  const flatten = (): Rgba => ({ width: doc.width, height: doc.height, data: doc.composite(doc.frame) });
  /** Every frame of the picture, flattened; an operation is applied to each one so an animation keeps all its frames. */
  const rebuild = (fn: (img: Rgba) => Rgba, label: string): void => {
    const imgs = doc.frames.map((_, i) => fn({ width: doc.width, height: doc.height, data: doc.composite(i) }));
    const made = imgs.length === 1 ? spriteFromRgba(doc.name, imgs[0]!, [doc.origin.x, doc.origin.y]) : spriteFromFrames(doc.name, imgs, [doc.origin.x, doc.origin.y]);
    made.frames.forEach((f, i) => void (f.duration = doc.frames[i]?.duration ?? f.duration));
    doc.replaceWith({ ...made, ...(doc.meta ? { meta: doc.meta } : {}) } as SpriteData, label);
  };
  const levels = preset ? preset.meta.heightCells ?? 1 : 1;
  const isBlock = preset && (preset.id === 'block' || preset.id === 'half');
  return (
    <div data-testid="ts-kind-section">
      <SelectField<string> testId="ts-kind" label="This picture is" value={meta?.kind ?? 'sprite'} options={KINDS} onChange={(v) => set((m) => (m.kind = v as SpriteMeta['kind']))} />
      <p className="hint">{preset ? `Made from “${preset.label}”.` : 'Pick a canvas under “New picture for the world” to get guides, or choose what this is here.'}</p>
      <CheckField testId="ts-guides" label="Show the guides over the picture" value={showGuides} onChange={(v) => studio.set({ showGuides: v })} />
      {preset && preset.guides.some((g) => g.clip) && (
        <div className="row wrap">
          <button
            data-testid="ts-clip"
            title="Cut away everything outside the guides (so the picture is exactly the diamond or the wall face)"
            onClick={() => rebuild((img) => clipTo(img, preset.guides.filter((g) => g.clip).map((g) => g.points)), 'Clip to the guides')}
          >
            Clip art to the guides
          </button>
          {isBlock && (
            <>
              <button
                data-testid="ts-shade"
                title="Make the left face a little darker than the top and the right face darker still"
                onClick={() => rebuild((img) => shadeFaces(img, iso, levels), 'Shade the faces')}
              >
                Shade the three faces
              </button>
              <button
                data-testid="ts-split"
                title="Cut the block into the top, left and right pictures a tile uses"
                onClick={async () => {
                  const faces = splitBlock(flatten(), iso, levels);
                  const base = doc.name;
                  const mk = (suffix: string, img: Rgba, kind: SpriteMeta['kind'], presetId: string): SpriteData => ({
                    ...spriteFromRgba(`${base}_${suffix}`, img, [img.width / 2, kind === 'tile' ? img.height / 2 : img.height]),
                    meta: { kind, preset: presetId, footprint: { w: 1, d: 1 }, heightCells: levels, collision: null, fade: null, sortOffset: 0, sway: false, variants: [], face: 'wall', otherSide: '', light: 0, tags: [] },
                  });
                  await studio.putSprite(mk('top', faces.top, 'tile', 'flat'));
                  await studio.putSprite(mk('left', faces.left, 'wall', `wall-left-${levels >= 1 ? 1 : 1}`));
                  await studio.putSprite(mk('right', faces.right, 'wall', `wall-right-${levels >= 1 ? 1 : 1}`));
                  store.notify('info', `Made “${base}_top”, “${base}_left” and “${base}_right”. Use them as a tile's top and side pictures.`);
                }}
              >
                Split into faces
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- live tiling preview ----------

/** The picture of a tile repeated across a patch, the way the world will draw it. */
export function drawTiling(canvas: HTMLCanvasElement, img: Rgba, meta: SpriteMeta | null, iso: IsoSize, opts: { n: number; seams: boolean; wrap: boolean; levels: number }): void {
  const src = imageOf(img);
  const { tileW: tw, tileH: th, heightPx: hp } = iso;
  const kind = meta?.kind ?? 'sprite';
  const ctx = canvas.getContext('2d')!;
  const n = opts.n;
  ctx.imageSmoothingEnabled = false;
  if (opts.wrap || !['tile', 'wall', 'cliff'].includes(kind)) {
    // plain repeat: do the edges line up?
    canvas.width = img.width * 3;
    canvas.height = img.height * 3;
    ctx.fillStyle = '#20222b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) ctx.drawImage(src, x * img.width, y * img.height);
    if (opts.seams) {
      ctx.strokeStyle = 'rgba(255,60,60,0.8)';
      for (let k = 1; k < 3; k++) {
        ctx.beginPath();
        ctx.moveTo(k * img.width + 0.5, 0);
        ctx.lineTo(k * img.width + 0.5, canvas.height);
        ctx.moveTo(0, k * img.height + 0.5);
        ctx.lineTo(canvas.width, k * img.height + 0.5);
        ctx.stroke();
      }
    }
    return;
  }
  if (kind === 'tile') {
    canvas.width = (n * 2) * (tw / 2) + tw;
    canvas.height = n * th + img.height + 8;
    ctx.fillStyle = '#20222b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const ox = canvas.width / 2 - tw / 2;
    for (let sum = 0; sum <= (n - 1) * 2; sum++) {
      for (let x = 0; x < n; x++) {
        const y = sum - x;
        if (y < 0 || y >= n) continue;
        const sx = ox + (x - y) * (tw / 2);
        const sy = 4 + (x + y) * (th / 2);
        ctx.drawImage(src, sx, sy);
        if (opts.seams) {
          ctx.strokeStyle = 'rgba(255,60,60,0.7)';
          ctx.beginPath();
          ctx.moveTo(sx + tw / 2, sy);
          ctx.lineTo(sx + tw, sy + th / 2);
          ctx.lineTo(sx + tw / 2, sy + th);
          ctx.lineTo(sx, sy + th / 2);
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
    return;
  }
  // wall and cliff faces: a run of faces along a wall, stacked upwards
  const left = meta?.preset.includes('left') ?? true;
  const lv = Math.max(1, opts.levels);
  const stepY = left ? th / 2 : -th / 2;
  canvas.width = img.width * n + 8;
  canvas.height = img.height * lv + (th / 2) * n + 8;
  ctx.fillStyle = '#20222b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < n; i++) {
    for (let l = 0; l < lv; l++) {
      const sx = 4 + i * img.width;
      const sy = 4 + (left ? i * (th / 2) : (n - 1 - i) * (th / 2)) + l * (img.height - (th / 2));
      ctx.drawImage(src, sx, sy);
      if (opts.seams) {
        ctx.strokeStyle = 'rgba(255,60,60,0.7)';
        ctx.strokeRect(sx + 0.5, sy + 0.5, img.width, img.height);
      }
    }
  }
  void stepY;
  void hp;
}

function TilingSection() {
  const iso = useIso();
  useStudio((s) => s.docVersion);
  const doc = studio.doc;
  const ref = useRef<HTMLCanvasElement>(null);
  const [seams, setSeams] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [n, setN] = useState(5);
  const [levels, setLevels] = useState(2);
  useEffect(() => {
    if (!doc || !ref.current) return;
    drawTiling(ref.current, { width: doc.width, height: doc.height, data: doc.composite(doc.frame) }, doc.meta, iso, { n, seams, wrap, levels });
  });
  if (!doc) return null;
  return (
    <div data-testid="ts-tiling">
      <div className="studio-tiling-scroll">
        <canvas ref={ref} data-testid="ts-tiling-canvas" style={{ imageRendering: 'pixelated', maxWidth: '100%' }} />
      </div>
      <CheckField testId="ts-seams" label="Mark the seams" value={seams} onChange={setSeams} />
      <CheckField testId="ts-wrap" label="Wrap-around: repeat the picture itself (edges must line up)" value={wrap} onChange={setWrap} />
      <NumberField testId="ts-patch" label="Patch size" min={2} max={10} value={n} onCommit={setN} />
      {(doc.meta?.kind === 'wall' || doc.meta?.kind === 'cliff') && <NumberField testId="ts-levels" label="Levels stacked" min={1} max={4} value={levels} onCommit={setLevels} />}
    </div>
  );
}

// ---------- tile properties and the palette ----------

function TileSection() {
  const project = useApp((s) => s.project?.project);
  useStudio((s) => s.docVersion);
  useStudio((s) => s.assetsVersion);
  const doc = studio.doc;
  const tiles = project ? ownTiles(project) : [];
  const spriteName = doc?.name ?? '';
  const existing = tileOfSprite(tiles, spriteName);
  const [form, setForm] = useState<TileForm>(emptyTileForm(spriteName));
  const [customKey, setCustomKey] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [variantTile, setVariantTile] = useState(0);
  const [variantWeight, setVariantWeight] = useState(1);
  const loadedFor = useRef('');
  // load the tile that already uses this sprite when another sprite is opened
  useEffect(() => {
    if (loadedFor.current === spriteName) return;
    loadedFor.current = spriteName;
    setForm(existing ? formOfTile(existing) : emptyTileForm(spriteName));
  }, [spriteName, existing]);
  if (!doc || !project) return <p className="hint">Open a sprite first.</p>;
  const sprites = [...studio.assets.keys()].sort((a, b) => a.localeCompare(b));
  const patchProps = (p: Partial<NonNullable<TileDefData['props']>>): void => setForm((f) => ({ ...f, props: { ...f.props, ...p } }));
  const others = tiles.filter((t) => t.group === undefined && t.id !== existing?.id);
  const send = (): void => {
    const sprite = currentSprite()!;
    const made = upsertTile(tiles, studio.assets.get(spriteName) ?? sprite, form);
    void store.updateTiles(made.tiles, project.autotile).then((ok) => {
      if (ok) {
        store.setOptions({ tile: made.id });
        store.notify('info', existing ? `Updated the tile “${form.name}”. Every copy placed in the world follows.` : `Added the tile “${form.name}” to the palette.`);
      }
    });
  };
  const saved = studio.assets.has(spriteName);
  return (
    <div data-testid="ts-tile-section">
      {!saved && <p className="hint">Save the sprite first (Save sprite), then send it to the palette.</p>}
      <TextField testId="ts-tile-name" label="Tile name" value={form.name} onCommit={(v) => setForm((f) => ({ ...f, name: v }))} />
      <CheckField testId="ts-walkable" label="Walkable" value={form.props.walkable !== false} onChange={(v) => patchProps({ walkable: v ? undefined : false })} />
      <CheckField testId="ts-stair" label="Is a stair" value={form.props.stair === true} onChange={(v) => patchProps({ stair: v || undefined })} />
      <CheckField testId="ts-pit" label="Is a pit (no floor)" value={form.props.pit === true} onChange={(v) => patchProps({ pit: v || undefined })} />
      <CheckField testId="ts-water" label="Is water" value={form.props.water === true} onChange={(v) => patchProps({ water: v || undefined })} />
      <CheckField testId="ts-blocks-light" label="Blocks light (casts shadows)" value={form.props.blocksLight === true} onChange={(v) => patchProps({ blocksLight: v || undefined })} />
      <SelectField<string> testId="ts-footstep" label="Footstep sound" value={form.props.footstep ?? ''} options={[{ value: '', label: '(none)' }, ...studio.sounds.map((s) => ({ value: s.name, label: s.name }))]} onChange={(v) => patchProps({ footstep: v || undefined })} />
      <NumberField testId="ts-sort" label="Draw order nudge" step={0.1} value={form.props.sortOffset ?? 0} onCommit={(v) => patchProps({ sortOffset: v || undefined })} />
      <TextField testId="ts-tags" label="Tags (commas)" value={(form.props.tags ?? []).join(', ')} onCommit={(v) => patchProps({ tags: v.split(',').map((t) => t.trim()).filter(Boolean) })} />
      <fieldset>
        <legend>Your own settings</legend>
        {Object.entries(form.props.custom ?? {}).map(([k, v]) => (
          <div className="row" key={k}>
            <span>
              {k} = {String(v)}
            </span>
            <button
              aria-label={`Remove ${k}`}
              onClick={() =>
                patchProps({
                  custom: Object.fromEntries(Object.entries(form.props.custom ?? {}).filter(([x]) => x !== k)),
                })
              }
            >
              ✕
            </button>
          </div>
        ))}
        <div className="row">
          <input data-testid="ts-custom-key" aria-label="Setting name" placeholder="name" value={customKey} onChange={(e) => setCustomKey(e.target.value)} />
          <input data-testid="ts-custom-value" aria-label="Setting value" placeholder="value" value={customValue} onChange={(e) => setCustomValue(e.target.value)} />
          <button
            data-testid="ts-custom-add"
            disabled={!customKey.trim()}
            onClick={() => {
              const v = customValue === 'true' ? true : customValue === 'false' ? false : customValue !== '' && !Number.isNaN(Number(customValue)) ? Number(customValue) : customValue;
              patchProps({ custom: { ...form.props.custom, [customKey.trim()]: v } });
              setCustomKey('');
              setCustomValue('');
            }}
          >
            Add
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Moving top</legend>
        <CheckField testId="ts-animate" label={`Use all ${doc.frames.length} frames of this sprite as the animation`} value={form.animate} onChange={(v) => setForm((f) => ({ ...f, animate: v }))} />
        {form.animate && <NumberField testId="ts-fps" label="Frames per second" min={0.1} max={30} step={0.5} value={form.fps} onCommit={(v) => setForm((f) => ({ ...f, fps: v }))} />}
        {form.animate && doc.frames.length < 2 && <p className="warn-text">This sprite has one frame. Add frames in the timeline below.</p>}
      </fieldset>
      <fieldset>
        <legend>Pictures on the sides (walls and cliffs)</legend>
        <SelectField<string> testId="ts-left-art" label="Left face" value={form.leftArt} options={[{ value: '', label: '(flat colour)' }, ...sprites.map((s) => ({ value: s, label: s }))]} onChange={(v) => setForm((f) => ({ ...f, leftArt: v }))} />
        <SelectField<string> testId="ts-right-art" label="Right face" value={form.rightArt} options={[{ value: '', label: '(flat colour)' }, ...sprites.map((s) => ({ value: s, label: s }))]} onChange={(v) => setForm((f) => ({ ...f, rightArt: v }))} />
        <NumberField testId="ts-face-levels" label="Each picture is this many levels tall" min={0.5} max={8} step={0.5} value={form.faceLevels} onCommit={(v) => setForm((f) => ({ ...f, faceLevels: v }))} />
      </fieldset>
      <fieldset>
        <legend>Variants (chosen at random when painting)</legend>
        {form.variants.map((v, i) => (
          <div className="row" key={i}>
            <span>
              {tiles.find((t) => t.id === v.tile)?.name ?? `tile ${v.tile}`} x{v.weight}
            </span>
            <button aria-label="Remove variant" onClick={() => setForm((f) => ({ ...f, variants: f.variants.filter((_, j) => j !== i) }))}>
              ✕
            </button>
          </div>
        ))}
        <div className="row">
          <select data-testid="ts-variant-tile" aria-label="Other tile" value={variantTile} onChange={(e) => setVariantTile(Number(e.target.value))}>
            <option value={0}>(choose a tile)</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input data-testid="ts-variant-weight" aria-label="Weight" type="number" min={0.1} step={0.5} value={variantWeight} onChange={(e) => setVariantWeight(Number(e.target.value))} style={{ width: 60 }} />
          <button
            data-testid="ts-variant-add"
            disabled={variantTile === 0}
            onClick={() => {
              setForm((f) => ({ ...f, variants: [...f.variants.filter((x) => x.tile !== variantTile), { tile: variantTile, weight: variantWeight }] }));
              setVariantTile(0);
            }}
          >
            Add
          </button>
        </div>
        <p className="hint">The Paint tool uses a variant instead of this tile now and then, by weight.</p>
      </fieldset>
      <button className="primary" data-testid="ts-send" disabled={!saved} onClick={send}>
        {existing ? 'Update the tile in the palette' : 'Send to the palette'}
      </button>
      {existing && <p className="hint">This sprite is the tile “{existing.name}” (id {existing.id}). Editing it updates every placed copy.</p>}
    </div>
  );
}

// ---------- tall props ----------

function PropSection() {
  const iso = useIso();
  useStudio((s) => s.docVersion);
  const doc = studio.doc;
  const names = useStudio((s) => s.names);
  const [vSprite, setVSprite] = useState('');
  const [vWeight, setVWeight] = useState(1);
  if (!doc) return null;
  const meta = doc.meta;
  if (!meta || meta.kind !== 'prop') return <p className="hint">Make this picture a “Tall prop or building” in “What it is” above, or start from a Tall props canvas.</p>;
  const set = (label: string, fn: (m: SpriteMeta) => void): void => doc.setMeta(label, fn);
  const c = propCanvas(iso, meta.footprint.w, meta.footprint.d, meta.heightCells);
  const col = meta.collision;
  return (
    <div data-testid="ts-prop">
      <div className="row">
        <NumberField testId="ts-fp-w" label="Footprint across (cells)" min={0.5} max={12} step={0.5} value={meta.footprint.w} onCommit={(v) => set('Footprint', (m) => (m.footprint.w = v))} />
        <NumberField testId="ts-fp-d" label="Footprint deep" min={0.5} max={12} step={0.5} value={meta.footprint.d} onCommit={(v) => set('Footprint', (m) => (m.footprint.d = v))} />
      </div>
      <NumberField testId="ts-height" label="Height (levels)" min={0} max={40} step={0.5} value={meta.heightCells} onCommit={(v) => set('Height', (m) => (m.heightCells = v))} />
      <p className="hint">The yellow outline marks the ground it stands on. The feet point (the cross) is the middle of it: {Math.round(c.origin[0])}, {Math.round(c.origin[1])}.</p>
      <button data-testid="ts-feet" onClick={() => doc.setOrigin(Math.round(c.origin[0]), Math.round(c.origin[1]))}>
        Put the feet in the middle of the footprint
      </button>
      <h4>What blocks</h4>
      <div className="row wrap">
        <button data-testid="ts-col-whole" onClick={() => set('What blocks', (m) => (m.collision = { x: 0, y: 0, w: m.footprint.w, d: m.footprint.d }))}>
          The whole footprint
        </button>
        <button data-testid="ts-col-trunk" onClick={() => set('What blocks', (m) => (m.collision = { x: m.footprint.w * 0.35, y: m.footprint.d * 0.35, w: m.footprint.w * 0.3, d: m.footprint.d * 0.3 }))}>
          Only a trunk in the middle
        </button>
        <button data-testid="ts-col-none" onClick={() => set('What blocks', (m) => (m.collision = null))}>
          Nothing
        </button>
      </div>
      {col && (
        <div className="row wrap">
          {(['x', 'y', 'w', 'd'] as const).map((k) => (
            <NumberField key={k} testId={`ts-col-${k}`} label={k === 'x' ? 'From left' : k === 'y' ? 'From top' : k === 'w' ? 'Width' : 'Depth'} step={0.05} min={0} value={Math.round(col[k] * 100) / 100} onCommit={(v) => set('What blocks', (m) => m.collision && (m.collision[k] = v))} />
          ))}
        </div>
      )}
      <h4>What fades when the player is behind it</h4>
      <div className="row wrap">
        <button data-testid="ts-fade-canopy" onClick={() => set('Fade', (m) => (m.fade = { fromY: 0, toY: Math.round(doc.height * 0.6) }))}>
          The top 60% (a canopy)
        </button>
        <button data-testid="ts-fade-none" onClick={() => set('Fade', (m) => (m.fade = null))}>
          Nothing fades
        </button>
      </div>
      {meta.fade && <NumberField testId="ts-fade-to" label="Fades down to row" min={1} max={doc.height} value={meta.fade.toY} onCommit={(v) => set('Fade', (m) => m.fade && (m.fade.toY = Math.round(v)))} />}
      <CheckField testId="ts-sway" label="Sways gently" value={meta.sway} onChange={(v) => set('Sway', (m) => (m.sway = v))} />
      <NumberField testId="ts-prop-sort" label="Draw order nudge (cells)" step={0.1} value={meta.sortOffset} onCommit={(v) => set('Draw order', (m) => (m.sortOffset = v))} />
      <fieldset>
        <legend>Other looks (chosen at random, by weight)</legend>
        {meta.variants.map((v, i) => (
          <div className="row" key={i}>
            <span>
              {v.sprite} x{v.weight}
            </span>
            <button aria-label="Remove look" onClick={() => set('Looks', (m) => void m.variants.splice(i, 1))}>
              ✕
            </button>
          </div>
        ))}
        <div className="row">
          <select data-testid="ts-pvar-sprite" aria-label="Sprite" value={vSprite} onChange={(e) => setVSprite(e.target.value)}>
            <option value="">(choose a sprite)</option>
            {names.filter((n) => n !== doc.name).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <input data-testid="ts-pvar-weight" aria-label="Weight" type="number" min={0.1} step={0.5} value={vWeight} onChange={(e) => setVWeight(Number(e.target.value))} style={{ width: 60 }} />
          <button
            data-testid="ts-pvar-add"
            disabled={!vSprite}
            onClick={() => {
              set('Looks', (m) => void m.variants.push({ sprite: vSprite, weight: vWeight }));
              setVSprite('');
            }}
          >
            Add
          </button>
        </div>
        <p className="hint">Seasonal looks work the same way: add the winter picture here, or switch pictures with an event row.</p>
      </fieldset>
    </div>
  );
}

// ---------- attachments ----------

function AttachSection() {
  useStudio((s) => s.docVersion);
  const doc = studio.doc;
  if (!doc) return null;
  const meta = doc.meta;
  if (!meta || meta.kind !== 'attachment') return <p className="hint">Make this picture a “Wall or floor attachment” to use these.</p>;
  const set = (label: string, fn: (m: SpriteMeta) => void): void => doc.setMeta(label, fn);
  const other = meta.otherSide ? studio.assets.get(meta.otherSide) : undefined;
  return (
    <div data-testid="ts-attach">
      <SelectField<string> testId="ts-face" label="It goes on" value={meta.face} options={[{ value: 'wall', label: 'a wall face (window, door, torch, poster)' }, { value: 'floor', label: 'a floor or the top of a block (rug, puddle)' }]} onChange={(v) => set('Face', (m) => (m.face = v as SpriteMeta['face']))} />
      {meta.face === 'wall' && (
        <>
          <button
            data-testid="ts-other-side"
            onClick={async () => {
              const flipped = mirror(rgbaOfSprite(doc));
              const name = `${doc.name.replace(/_(left|right)$/, '')}_${doc.meta?.preset.includes('right') ? 'left' : 'right'}`;
              const sprite: SpriteData = {
                ...spriteFromRgba(name, flipped, [doc.width - doc.origin.x, doc.origin.y]),
                meta: { ...structuredClone(meta), preset: meta.preset.includes('right') ? 'attach-left' : 'attach-right', otherSide: doc.name },
              };
              await studio.putSprite(sprite);
              set('The other side', (m) => (m.otherSide = name));
              store.notify('info', `Made “${name}”, the other side, mirrored. Open it to touch it up.`);
            }}
          >
            Make the other side (mirrored)
          </button>
          <p className="hint" data-testid="ts-other-hint">
            {meta.otherSide ? (other ? `The other side is “${meta.otherSide}”.` : `The other side “${meta.otherSide}” is not saved yet.`) : 'No other side yet: it is drawn mirrored automatically on walls that face the other way.'}
          </p>
        </>
      )}
      <NumberField testId="ts-light" label="Gives light (cells, 0 = none)" min={0} max={12} step={0.5} value={meta.light} onCommit={(v) => set('Light', (m) => (m.light = v))} />
      <TextField testId="ts-attach-tags" label="Tags (commas)" value={meta.tags.join(', ')} onCommit={(v) => set('Tags', (m) => (m.tags = v.split(',').map((t) => t.trim()).filter(Boolean)))} />
      <p className="hint">Place it with the Attach tool: it snaps onto any wall face at any height. A window can let light through, a torch can be a light, and a door can be a portal: add those behaviours to the placed attachment.</p>
    </div>
  );
}

const rgbaOfSprite = (doc: NonNullable<typeof studio.doc>): Rgba => ({ width: doc.width, height: doc.height, data: doc.composite(doc.frame) });

// ---------- autotile sets ----------

function AutotileSetSection() {
  const iso = useIso();
  const project = useApp((s) => s.project?.project);
  useStudio((s) => s.assetsVersion);
  const [set, setSet] = useState('grass');
  const [baseId, setBaseId] = useState(0);
  const [colour, setColour] = useState('#e8e0a0');
  const [width, setWidth] = useState(6);
  const [soften, setSoften] = useState(0.5);
  const ref = useRef<HTMLCanvasElement>(null);
  const slots = useMemo(() => blobSlots(), []);
  const tiles = project ? ownTiles(project) : [];
  const baseTiles = tiles.filter((t) => t.group === undefined);
  const base = baseTiles.find((t) => t.id === baseId) ?? baseTiles[0];
  const blank = (s: SpriteData): boolean => isEmpty(rgbaOf(s));
  const missing = missingSlots(slots, set, studio.assets, blank);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // a small map of two blobs of the set's terrain, drawn with the pieces the rules would pick
    const N = 8;
    const on = (x: number, y: number): boolean => (x >= 1 && x <= 3 && y >= 1 && y <= 4) || (x >= 4 && x <= 6 && y >= 3 && y <= 6) || (x === 6 && y === 1);
    c.width = N * iso.tileW;
    c.height = N * iso.tileH + 24;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#20222b';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    const ox = c.width / 2 - iso.tileW / 2;
    for (let sum = 0; sum <= (N - 1) * 2; sum++) {
      for (let x = 0; x < N; x++) {
        const y = sum - x;
        if (y < 0 || y >= N || !on(x, y)) continue;
        const same = (dx: number, dy: number): number => (on(x + dx, y + dy) ? 1 : 0);
        const ns = { N: same(0, -1), NE: same(1, -1), E: same(1, 0), SE: same(1, 1), S: same(0, 1), SW: same(-1, 1), W: same(-1, 0), NW: same(-1, -1) };
        const slot = slots.find((s) => {
          const chars = [ns.N, ns.NE, ns.E, ns.SE, ns.S, ns.SW, ns.W, ns.NW].map(String);
          return s.pattern.split('').every((p, i) => p === '*' || p === chars[i]);
        });
        const sp = slot && slot.id !== 'centre' ? studio.assets.get(slotSpriteName(set, slot.id)) : base?.art ? studio.assets.get(base.art) : undefined;
        const sx = ox + (x - y) * (iso.tileW / 2);
        const sy = 4 + (x + y) * (iso.tileH / 2);
        if (sp) ctx.drawImage(imageOf(rgbaOf(sp)), sx, sy);
        else {
          ctx.fillStyle = '#3d5a3d';
          ctx.fillRect(sx + iso.tileW / 4, sy + iso.tileH / 4, iso.tileW / 2, iso.tileH / 2);
        }
      }
    }
  });
  if (!project) return null;
  const createBlank = async (): Promise<void> => {
    for (const s of slots) {
      const name = slotSpriteName(set, s.id);
      if (studio.assets.has(name)) continue;
      const sp = blankSprite(name, iso.tileW, iso.tileH);
      await studio.putSprite({ ...sp, origin: { x: iso.tileW / 2, y: iso.tileH / 2 }, meta: { kind: 'tile', preset: 'flat', footprint: { w: 1, d: 1 }, heightCells: 0, collision: null, fade: null, sortOffset: 0, sway: false, variants: [], face: 'wall', otherSide: '', light: 0, tags: [`autotile:${set}`] } });
    }
    store.notify('info', `Made ${slots.length} empty pictures named “${set}_…” for the pieces of the set. Fill them in any order.`);
  };
  const starter = async (): Promise<void> => {
    // an animated tile has no single picture: its first frame is the one to draw edges on
    const artName = base?.art ?? base?.anim?.frames[0];
    const baseSprite = artName ? studio.assets.get(artName.split('#')[0]!) : undefined;
    if (!baseSprite) {
      store.notify('warn', 'Pick a base tile that has a picture (send a sprite to the palette first).');
      return;
    }
    const img = rgbaOf(baseSprite);
    for (const s of slots) {
      const edged = s.id === 'centre' ? img : drawEdges(img, s.sides, s.corners, { colour, width, soften });
      const name = slotSpriteName(set, s.id);
      const sp = spriteFromRgba(name, edged, [iso.tileW / 2, iso.tileH / 2]);
      await studio.putSprite({ ...sp, meta: { kind: 'tile', preset: 'flat', footprint: { w: 1, d: 1 }, heightCells: 0, collision: null, fade: null, sortOffset: 0, sway: false, variants: [], face: 'wall', otherSide: '', light: 0, tags: [`autotile:${set}`] } });
    }
    store.notify('info', `Drew a starter for every piece of “${set}” from “${base?.name}” and an edge brush. Open any piece to touch it up.`);
  };
  const apply = (): void => {
    if (!base) return;
    const made = addEdgeSet(tiles, project.autotile, base.id, set, slots);
    void store.updateTiles(made.tiles, made.rules, { reapply: true }).then((ok) => ok && store.notify('info', `The set “${set}” is in the palette: the Paint tool now picks the right edge piece for “${base.name}` + '” by itself.'));
  };
  return (
    <div data-testid="ts-autotile">
      <p className="hint">An edge set is the 47 pieces a ground tile needs so its edges, corners and ends line up: pick a base tile, make the empty pieces, fill them (or start from one tile plus an edge brush), and apply.</p>
      <TextField testId="ts-set-name" label="Set name" value={set} onCommit={(v) => setSet(v.trim().replace(/[^A-Za-z0-9_-]/g, '') || 'set')} />
      <SelectField<number> testId="ts-set-base" label="Base tile" value={base?.id ?? 0} options={baseTiles.map((t) => ({ value: t.id, label: t.name }))} onChange={setBaseId} />
      <div className="row wrap">
        <button data-testid="ts-set-create" onClick={() => void createBlank()}>
          Make the empty pieces
        </button>
        <button data-testid="ts-set-starter" onClick={() => void starter()}>
          Draw a starter from the base tile
        </button>
      </div>
      <div className="row wrap">
        <label className="field">
          <span>Edge colour</span>
          <input data-testid="ts-edge-colour" type="color" value={colour} onChange={(e) => setColour(e.target.value)} />
        </label>
        <NumberField testId="ts-edge-width" label="Edge width" min={1} max={16} value={width} onCommit={setWidth} />
        <NumberField testId="ts-edge-soften" label="Softness (0-1)" min={0} max={1} step={0.1} value={soften} onCommit={setSoften} />
      </div>
      <div className="ts-slots" data-testid="ts-slots">
        {slots.map((s) => {
          const sp = studio.assets.get(slotSpriteName(set, s.id));
          const empty = !sp || blank(sp);
          return (
            <button key={s.id} className={`ts-slot${empty ? ' missing' : ''}`} data-testid={`ts-slot-${s.id}`} title={`${s.label}${empty ? ' (empty)' : ''}`} disabled={!sp} onClick={() => sp && studio.openSprite(sp.name)}>
              {sp ? <SlotThumb sprite={sp} /> : <span className="ts-slot-none" />}
              <small>{s.id}</small>
            </button>
          );
        })}
      </div>
      <p className="hint" data-testid="ts-set-missing">
        {missing.length === 0 ? 'Every piece is drawn.' : `${missing.length} of ${slots.length} pieces are still empty${missing.length <= 6 ? `: ${missing.map((m) => m.id).join(', ')}` : ''}.`}
      </p>
      <canvas ref={ref} data-testid="ts-set-preview" style={{ imageRendering: 'pixelated', maxWidth: '100%' }} />
      <button className="primary" data-testid="ts-set-apply" disabled={!base} onClick={apply}>
        Put the set in the palette and apply it to the map
      </button>
    </div>
  );
}

function rgbaOf(s: SpriteData): Rgba {
  return { width: s.width, height: s.height, data: compositeFrame(s, 0) };
}

function SlotThumb({ sprite }: { sprite: SpriteData }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = sprite.width;
    c.height = sprite.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(compositeFrame(sprite, 0)), sprite.width, sprite.height), 0, 0);
  }, [sprite]);
  return <canvas ref={ref} style={{ width: 48, height: 24, imageRendering: 'pixelated' }} />;
}

// ---------- palette tools ----------

function PaletteToolsSection() {
  useStudio((s) => s.docVersion);
  const project = useApp((s) => s.project?.project);
  const doc = studio.doc;
  const [preset, setPreset] = useState('snow');
  const [hue, setHue] = useState(0);
  const [sat, setSat] = useState(1);
  const [light, setLight] = useState(1);
  const [suffix, setSuffix] = useState('snow');
  const op: Recolour = preset === 'custom' ? { hue, saturation: sat, lightness: light } : RECOLOUR_PRESETS[preset]!;
  if (!doc || !project) return null;
  const tiles = ownTiles(project);
  return (
    <div data-testid="ts-palette">
      <SelectField<string> testId="ts-recolour-preset" label="Recolour like" value={preset} options={[...Object.keys(RECOLOUR_PRESETS).map((k) => ({ value: k, label: k })), { value: 'custom', label: 'my own settings' }]} onChange={setPreset} />
      {preset === 'custom' && (
        <>
          <NumberField testId="ts-hue" label="Turn colours (degrees)" min={-180} max={180} step={5} value={hue} onCommit={setHue} />
          <NumberField testId="ts-sat" label="Colourfulness (1 = as is)" min={0} max={3} step={0.1} value={sat} onCommit={setSat} />
          <NumberField testId="ts-light-amount" label="Lightness (1 = as is)" min={0} max={2} step={0.1} value={light} onCommit={setLight} />
        </>
      )}
      <div className="row wrap">
        <button data-testid="ts-recolour-apply" onClick={() => doc.replaceWith({ ...recolourSprite(doc.toSprite(), op, doc.name) }, 'Recolour')}>
          Recolour this sprite
        </button>
        <button
          data-testid="ts-recolour-copy"
          onClick={async () => {
            const name = `${doc.name}_${suffix}`;
            await studio.putSprite(recolourSprite(doc.toSprite(), op, name));
            store.notify('info', `Saved “${name}” as a copy in the new colours.`);
          }}
        >
          Save as a copy
        </button>
      </div>
      <TextField testId="ts-recolour-suffix" label="Copy ending" value={suffix} onCommit={(v) => setSuffix(v.trim().replace(/[^A-Za-z0-9_-]/g, '') || 'copy')} />
      <button
        data-testid="ts-recolour-set"
        title="Make a recoloured copy of every picture the tiles use, and new tiles that use them (a forest set becomes a snow set)"
        onClick={async () => {
          const next = [...tiles];
          let id = tiles.reduce((m, t) => Math.max(m, t.id), 0) + 1;
          let made = 0;
          const copyOf = async (spriteName: string): Promise<string> => {
            const src = studio.assets.get(spriteName.split('#')[0]!);
            if (!src) return spriteName;
            const name = `${src.name}_${suffix}`;
            if (!studio.assets.has(name)) await studio.putSprite(recolourSprite(src, op, name));
            return spriteName.includes('#') ? `${name}#${spriteName.split('#')[1]}` : name;
          };
          for (const t of tiles.filter((x) => x.group === undefined && (x.art || x.anim))) {
            if (next.some((n) => n.name === `${t.name} ${suffix}`)) continue;
            const copy: TileDefData = { ...structuredClone(t), id: id++, name: `${t.name} ${suffix}` };
            if (t.art) copy.art = await copyOf(t.art);
            if (t.leftArt) copy.leftArt = await copyOf(t.leftArt);
            if (t.rightArt) copy.rightArt = await copyOf(t.rightArt);
            if (t.anim) copy.anim = { ...t.anim, frames: await Promise.all(t.anim.frames.map(copyOf)) };
            delete copy.variants;
            next.push(copy);
            made++;
          }
          if (made === 0) {
            store.notify('warn', 'No tile has a picture to recolour yet.');
            return;
          }
          await store.updateTiles(next, project.autotile);
          store.notify('info', `Made ${made} new tile${made === 1 ? '' : 's'} named “… ${suffix}” in the palette, with recoloured pictures.`);
        }}
      >
        Recolour every tile (as new tiles)
      </button>
    </div>
  );
}

// ---------- import and export ----------

function ImportExportSection() {
  const iso = useIso();
  const project = useApp((s) => s.project?.project);
  const [w, setW] = useState(iso.tileW);
  const [h, setH] = useState(iso.tileH);
  const [gapX, setGapX] = useState(0);
  const [gapY, setGapY] = useState(0);
  const [offX, setOffX] = useState(0);
  const [offY, setOffY] = useState(0);
  const [base, setBase] = useState('sheet');
  const [pending, setPending] = useState<Rgba | null>(null);
  const [count, setCount] = useState(0);
  if (!project) return null;
  const grid = { tileW: w, tileH: h, offsetX: offX, offsetY: offY, gapX, gapY };
  return (
    <div data-testid="ts-io">
      <p className="hint">Slice a tile sheet (one PNG with many tiles) into separate tiles, or export every tile picture as one sheet.</p>
      <button
        data-testid="ts-slice-open"
        onClick={async () => {
          const { api } = await import('../project/api');
          const file = await api().importFile('Pick a tile sheet (PNG)', ['png']);
          if (!file) return;
          const { decodePng } = await import('@tilewright/runtime');
          const png = decodePng(file.bytes);
          setBase(file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '') || 'sheet');
          setPending({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.rgba) });
        }}
      >
        Open a tile sheet…
      </button>
      {pending && (
        <>
          <div className="row wrap">
            <NumberField testId="ts-slice-w" label="Tile width" min={1} value={w} onCommit={setW} />
            <NumberField testId="ts-slice-h" label="Tile height" min={1} value={h} onCommit={setH} />
            <NumberField testId="ts-slice-gx" label="Gap across" min={0} value={gapX} onCommit={setGapX} />
            <NumberField testId="ts-slice-gy" label="Gap down" min={0} value={gapY} onCommit={setGapY} />
            <NumberField testId="ts-slice-ox" label="Start across" min={0} value={offX} onCommit={setOffX} />
            <NumberField testId="ts-slice-oy" label="Start down" min={0} value={offY} onCommit={setOffY} />
          </div>
          <TextField testId="ts-slice-name" label="Name the tiles" value={base} onCommit={setBase} />
          <button
            data-testid="ts-slice-go"
            onClick={async () => {
              const { sliceSheet } = await import('./pixels');
              const tiles = sliceSheet(pending, grid);
              setCount(tiles.length);
              for (const t of tiles) {
                const sp = spriteFromRgba(`${base}_${t.y + 1}_${t.x + 1}`, t.img, [w / 2, h / 2]);
                await studio.putSprite({ ...sp, meta: { kind: h > w ? 'prop' : 'tile', preset: '', footprint: { w: 1, d: 1 }, heightCells: 0, collision: null, fade: null, sortOffset: 0, sway: false, variants: [], face: 'wall', otherSide: '', light: 0, tags: [`sheet:${base}`] } });
              }
              store.notify('info', `Cut the sheet into ${tiles.length} tile pictures named “${base}_row_column”.`);
              setPending(null);
            }}
          >
            Cut it into tiles
          </button>
        </>
      )}
      {count > 0 && <p className="hint">Made {count} sprites.</p>}
      <button
        data-testid="ts-export-sheet"
        onClick={async () => {
          const { packSheet } = await import('./pixels');
          const { encodePng } = await import('@tilewright/runtime');
          const { assetFs } = await import('../project/assetFs');
          const { joinPath } = await import('../project/api');
          const tiles = [...studio.assets.values()].filter((s) => s.meta && ['tile', 'wall', 'cliff'].includes(s.meta.kind)).map(rgbaOf);
          if (tiles.length === 0) {
            store.notify('warn', 'No sprite is marked as a floor tile, wall or cliff yet.');
            return;
          }
          const sheet = packSheet(tiles, 8, 1);
          const png = encodePng(sheet.width, sheet.height, sheet.data);
          const dir = store.state.project!.dir;
          await assetFs.writeBinary(joinPath(dir, 'assets/exports/tileset.sheet.png'), png);
          store.notify('info', `Wrote ${tiles.length} tiles as one ${sheet.width} x ${sheet.height} sheet to assets/exports/tileset.sheet.png.`);
        }}
      >
        Export every tile picture as one sheet
      </button>
    </div>
  );
}

// ---------- the whole set of panels ----------

function Section({ title, id, open, children }: { title: string; id: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="studio-details" data-testid={`ts-sec-${id}`}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

export function TileStudioRight() {
  useStudio((s) => s.docVersion);
  const iso = useIso();
  const doc = studio.doc;
  const guides = doc ? spriteGuides(iso, doc.meta) : { guides: [] };
  return (
    <div data-testid="tile-studio-panels">
      <Section id="kind" title="What it is" open>
        <KindSection />
        {guides.guides.length === 0 && doc && <p className="hint">No guides for this picture.</p>}
      </Section>
      <Section id="tiling" title="How it tiles" open>
        <TilingSection />
      </Section>
      <Section id="tile" title="Tile properties and the palette" open>
        <TileSection />
      </Section>
      <Section id="prop" title="Tall prop settings">
        <PropSection />
      </Section>
      <Section id="attach" title="Wall and floor attachments">
        <AttachSection />
      </Section>
      <Section id="autotile" title="Edge sets (autotile)">
        <AutotileSetSection />
      </Section>
      <Section id="palette" title="Recolour">
        <PaletteToolsSection />
      </Section>
      <Section id="io" title="Import and export tile sheets">
        <ImportExportSection />
      </Section>
    </div>
  );
}

export type { Preset };
export { blankRgba, rgbaOfCanvas };
