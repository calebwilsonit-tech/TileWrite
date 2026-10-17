import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { FACING_NAMES, bakeShapes, findClip, framesForFacing, sampleClip, type ClipData, type FacingKey, type ShapeData } from '@tilewright/runtime';
import { NumberField, SelectField, TextField, CheckField } from '../panels/fields';
import { store } from '../app/store';
import { findReferences, spriteNameProblem } from './assets';
import { formatFrameList, parseFrameList } from './paint';
import { VECTOR_TOOLS, assetFs, studio, useStudio, type StudioTool } from './store';
import { frameCanvas } from './render';

const TOOLS: { id: StudioTool; label: string; key: string; hint: string }[] = [
  { id: 'pencil', label: 'Pencil', key: 'B', hint: 'Draw pixels. Drag to draw lines.' },
  { id: 'eraser', label: 'Eraser', key: 'E', hint: 'Erase pixels.' },
  { id: 'line', label: 'Line', key: 'L', hint: 'Drag a straight line.' },
  { id: 'rect', label: 'Rectangle', key: 'U', hint: 'Drag a rectangle (filled or outline).' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', hint: 'Drag an ellipse (filled or outline).' },
  { id: 'fill', label: 'Fill', key: 'G', hint: 'Fill a connected area with the chosen colour.' },
  { id: 'picker', label: 'Picker', key: 'I', hint: 'Click a pixel to pick its colour.' },
  { id: 'select', label: 'Select', key: 'M', hint: 'Drag a box to select; drag inside it to move (hold Alt to copy). Flip and rotate act on the selection.' },
  { id: 'isobox', label: 'Iso box', key: 'X', hint: 'Click to stamp an isometric block (top and two sides) at the right angles, using the chosen colour. Set its size below.' },
  { id: 'origin', label: 'Feet point', key: 'F', hint: 'Click where the character stands on its cell.' },
  { id: 'hitbox', label: 'Hitbox', key: 'H', hint: 'Drag a box where this frame hurts things (for example a sword swing).' },
  { id: 'hurtbox', label: 'Hurtbox', key: 'J', hint: 'Drag a box where this frame can be hurt.' },
  { id: 'vselect', label: 'Shape select', key: 'V', hint: 'On a vector layer: click a shape to select it; drag it to move it, drag a handle to resize it or move a path point. Delete removes it and the arrow keys nudge it.' },
  { id: 'vrect', label: 'Shape rect', key: 'R', hint: 'On a vector layer: drag a rectangle that stays editable. Round its corners or turn it in the shape settings.' },
  { id: 'vellipse', label: 'Shape ellipse', key: 'N', hint: 'On a vector layer: drag an ellipse that stays editable.' },
  { id: 'vpath', label: 'Shape path', key: 'P', hint: 'On a vector layer: click to place points; double-click or Enter finishes, clicking the first point closes the shape, Esc cancels. Tick Smooth for curves.' },
];

export const STUDIO_TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id])) as Record<string, StudioTool>;

export function ToolBox() {
  const s = useStudio((x) => x);
  const doc = studio.doc;
  const tool = TOOLS.find((t) => t.id === s.tool)!;
  return (
    <div className="studio-section" data-testid="studio-tools">
      <h3>Tools</h3>
      <div className="tool-grid">
        {TOOLS.map((t) => (
          <button key={t.id} data-testid={`stool-${t.id}`} className={`tool${s.tool === t.id ? ' on' : ''}`} title={`${t.hint} (${t.key})`} aria-pressed={s.tool === t.id} onClick={() => studio.set({ tool: t.id })}>
            <span>{t.label}</span>
            <kbd>{t.key}</kbd>
          </button>
        ))}
      </div>
      <p className="hint">{tool.hint}</p>
      {VECTOR_TOOLS.includes(s.tool) && <VectorOptions />}
      <label className="opt">
        <span>Brush size</span>
        <input data-testid="studio-size" type="range" min={1} max={8} value={s.size} onChange={(e) => studio.set({ size: Number(e.target.value) })} />
        <output>{s.size}</output>
      </label>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={s.filled} onChange={(e) => studio.set({ filled: e.target.checked })} /> Filled shapes
        </label>
      </div>
      <div className="row">
        <label className="check" title="Mirror everything you draw left-to-right">
          <input data-testid="sym-x" type="checkbox" checked={s.symX} onChange={(e) => studio.set({ symX: e.target.checked })} /> Mirror left/right
        </label>
        <label className="check">
          <input type="checkbox" checked={s.symY} onChange={(e) => studio.set({ symY: e.target.checked })} /> Mirror up/down
        </label>
      </div>
      {s.tool === 'isobox' && (
        <fieldset>
          <legend>Iso box</legend>
          <NumberField label="Width (cells)" step={0.5} min={0.5} max={6} value={s.isoBox.w} onCommit={(v) => studio.set({ isoBox: { ...s.isoBox, w: v } })} />
          <NumberField label="Depth (cells)" step={0.5} min={0.5} max={6} value={s.isoBox.d} onCommit={(v) => studio.set({ isoBox: { ...s.isoBox, d: v } })} />
          <NumberField label="Height (pixels)" min={1} max={200} value={s.isoBox.h} onCommit={(v) => studio.set({ isoBox: { ...s.isoBox, h: v } })} />
          <NumberField label="Cell half-width (px)" min={2} max={64} value={s.isoBox.s} onCommit={(v) => studio.set({ isoBox: { ...s.isoBox, s: v } })} />
          <p className="hint">16 gives a 32 x 16 tile; 32 matches the game&apos;s 64 x 32 tiles.</p>
        </fieldset>
      )}
      <h3>View</h3>
      <label className="opt">
        <span>Zoom</span>
        <input type="range" min={1} max={32} value={s.zoom} onChange={(e) => studio.set({ zoom: Number(e.target.value) })} />
        <output>{s.zoom}x</output>
      </label>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={s.pixelGrid} onChange={(e) => studio.set({ pixelGrid: e.target.checked })} /> Pixel grid
        </label>
        <label className="check" title="Lines at the isometric angle (2:1) through the feet point">
          <input data-testid="iso-grid" type="checkbox" checked={s.isoGrid} onChange={(e) => studio.set({ isoGrid: e.target.checked })} /> Iso guide
        </label>
        <label className="check">
          <input type="checkbox" checked={s.showBoxes} onChange={(e) => studio.set({ showBoxes: e.target.checked })} /> Boxes
        </label>
      </div>
      <div className="row">
        <label className="check" title="Show the previous frame faintly in red">
          <input data-testid="onion-prev" type="checkbox" checked={s.onionPrev} onChange={(e) => studio.set({ onionPrev: e.target.checked })} /> Onion: before
        </label>
        <label className="check" title="Show the next frame faintly in green">
          <input data-testid="onion-next" type="checkbox" checked={s.onionNext} onChange={(e) => studio.set({ onionNext: e.target.checked })} /> after
        </label>
      </div>
      <h3>Transform {doc?.selection ? '(selection)' : '(whole layer)'}</h3>
      <div className="row">
        <button disabled={!doc} onClick={() => doc?.transform('flipH')}>Flip ↔</button>
        <button disabled={!doc} onClick={() => doc?.transform('flipV')}>Flip ↕</button>
        <button disabled={!doc || doc.width !== doc.height} title="Needs a square canvas" onClick={() => doc?.transform('rotate')}>Rotate ↻</button>
      </div>
      <div className="row">
        <NumberField label="Turn by (degrees)" testId="turn-degrees" value={s.turnDegrees} min={-360} max={360} step={5} onCommit={(v) => studio.set({ turnDegrees: v })} />
        <button data-testid="turn-apply" disabled={!doc || doc.currentIsVector} title="Turn the selection (or the whole layer) clockwise by this angle, around its middle" onClick={() => doc?.rotateFree(s.turnDegrees)}>
          Turn
        </button>
      </div>
      <div className="row">
        <NumberField label="Scale to (percent)" testId="scale-percent" value={s.scalePercent} min={10} max={800} step={10} onCommit={(v) => studio.set({ scalePercent: v })} />
        <button data-testid="scale-apply" disabled={!doc || doc.currentIsVector} title="Make the selection (or the whole layer) bigger or smaller, around its middle" onClick={() => doc?.scaleFree(s.scalePercent / 100)}>
          Scale
        </button>
      </div>
      <div className="row">
        {(['left', 'up', 'down', 'right'] as const).map((d) => (
          <button key={d} disabled={!doc} aria-label={`Nudge ${d}`} onClick={() => doc?.transform(d)}>
            {{ left: '←', up: '↑', down: '↓', right: '→' }[d]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Settings for the shapes the vector tools make, and for the shape that is selected. */
function VectorOptions() {
  const s = useStudio((x) => x);
  useStudio((x) => x.docVersion);
  const doc = studio.doc;
  const shape = doc && doc.currentIsVector && doc.shape !== null ? doc.shapes()[doc.shape] : undefined;
  const at = doc?.shape ?? 0;
  return (
    <fieldset data-testid="vector-options">
      <legend>Shapes</legend>
      {doc && !doc.currentIsVector && <p className="hint">The current layer is a pixel layer. Add a shape layer (the + Shape layer button in Layers) to draw shapes.</p>}
      <div className="row">
        <label className="check">
          <input data-testid="vfill" type="checkbox" checked={s.vFill} onChange={(e) => studio.set({ vFill: e.target.checked })} /> Fill with the chosen colour
        </label>
      </div>
      <div className="row">
        <span>Outline:</span>
        <button data-testid="vstroke-color" title="Outline new shapes with the chosen colour" onClick={() => studio.set({ vStroke: s.color })}>
          Chosen colour
        </button>
        <button data-testid="vstroke-none" title="No outline on new shapes" onClick={() => studio.set({ vStroke: 0 })}>
          None
        </button>
        <output data-testid="vstroke-value">{s.vStroke === 0 ? 'none' : `colour ${s.vStroke}`}</output>
      </div>
      <NumberField label="Outline width (px)" min={0.5} max={32} step={0.5} value={s.vStrokeWidth} onCommit={(v) => studio.set({ vStrokeWidth: v })} />
      {s.tool === 'vpath' && (
        <div className="row">
          <label className="check">
            <input data-testid="vclosed" type="checkbox" checked={s.vClosed} onChange={(e) => studio.set({ vClosed: e.target.checked })} /> Closed
          </label>
          <label className="check">
            <input data-testid="vsmooth" type="checkbox" checked={s.vSmooth} onChange={(e) => studio.set({ vSmooth: e.target.checked })} /> Smooth
          </label>
        </div>
      )}
      {doc && shape && (
        <div data-testid="shape-inspector">
          <h4>Selected shape ({shape.type})</h4>
          <div className="row">
            <button data-testid="shape-fill-color" onClick={() => doc.updateShape(at, { fill: s.color })}>
              Fill: chosen colour
            </button>
            <button data-testid="shape-fill-none" onClick={() => doc.updateShape(at, { fill: 0 })}>
              No fill
            </button>
          </div>
          <div className="row">
            <button data-testid="shape-stroke-color" onClick={() => doc.updateShape(at, { stroke: s.color })}>
              Outline: chosen colour
            </button>
            <button data-testid="shape-stroke-none" onClick={() => doc.updateShape(at, { stroke: 0 })}>
              No outline
            </button>
          </div>
          <NumberField label="Outline width (px)" testId="shape-stroke-width" min={0.5} max={64} step={0.5} value={shape.strokeWidth} onCommit={(v) => doc.updateShape(at, { strokeWidth: v })} />
          {shape.type === 'rect' && <NumberField label="Rounded corners (px)" testId="shape-radius" min={0} max={256} step={1} value={shape.radius} onCommit={(v) => doc.updateShape(at, { radius: v })} />}
          {(shape.type === 'rect' || shape.type === 'ellipse') && <NumberField label="Turn (degrees)" testId="shape-rotation" min={-360} max={360} step={5} value={shape.rotation} onCommit={(v) => doc.updateShape(at, { rotation: v })} />}
          {shape.type === 'path' && (
            <div className="row">
              <label className="check">
                <input data-testid="shape-closed" type="checkbox" checked={shape.closed} onChange={(e) => doc.updateShape(at, { closed: e.target.checked })} /> Closed
              </label>
              <label className="check">
                <input data-testid="shape-smooth" type="checkbox" checked={shape.smooth} onChange={(e) => doc.updateShape(at, { smooth: e.target.checked })} /> Smooth
              </label>
            </div>
          )}
          <div className="row">
            <button data-testid="shape-forward" onClick={() => doc.reorderShape(at, 1)}>
              Bring forward
            </button>
            <button data-testid="shape-back" onClick={() => doc.reorderShape(at, -1)}>
              Send back
            </button>
            <button data-testid="shape-dup" onClick={() => doc.duplicateShape(at)}>
              Duplicate
            </button>
            <button data-testid="shape-delete" onClick={() => doc.removeShape(at)}>
              Delete
            </button>
          </div>
        </div>
      )}
    </fieldset>
  );
}

export function PalettePanel() {
  useStudio((x) => x.docVersion);
  const color = useStudio((x) => x.color);
  const doc = studio.doc;
  const [newColor, setNewColor] = useState('#ff8800');
  if (!doc) return null;
  const hex6 = (c: string): string => c.slice(0, 7);
  const alpha = (c: string): number => parseInt(c.slice(7, 9), 16);
  return (
    <div className="studio-section" data-testid="studio-palette">
      <div className="swatches">
        {doc.palette.map((c, i) => (
          <button
            key={i}
            data-testid={`swatch-${i}`}
            className={`swatch${color === i ? ' on' : ''}${i === 0 ? ' clear' : ''}`}
            title={i === 0 ? 'Transparent' : `Colour ${i}: ${c}`}
            aria-label={i === 0 ? 'Transparent' : `Colour ${i}`}
            style={i === 0 ? undefined : { background: hex6(c), opacity: alpha(c) / 255 }}
            onClick={() => i > 0 && studio.set({ color: i })}
          />
        ))}
      </div>
      {color > 0 && color < doc.palette.length && (
        <div className="row">
          <label className="check" title="Change this colour everywhere it is used">
            Edit colour {color}:
            <input
              data-testid="palette-edit"
              type="color"
              value={hex6(doc.palette[color]!)}
              onChange={(e) => doc.setColor(color, `${e.target.value}${doc.palette[color]!.slice(7, 9)}`)}
            />
          </label>
          <button disabled={doc.palette.length <= 2} title="Delete this colour (pixels using it become transparent)" onClick={() => doc.removeColor(color)}>
            Delete
          </button>
        </div>
      )}
      <div className="row">
        <input data-testid="palette-new" type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} aria-label="New colour" />
        <button
          data-testid="palette-add"
          onClick={() => {
            const i = doc.addColor(`${newColor}ff`);
            if (i > 0) studio.set({ color: i });
            else store.notify('warn', 'The palette is full (256 colours).');
          }}
        >
          Add colour
        </button>
      </div>
    </div>
  );
}

export function LayersSection() {
  useStudio((x) => x.docVersion);
  const doc = studio.doc;
  if (!doc) return null;
  return (
    <div className="studio-section" data-testid="studio-layers">
      <ul className="layer-rows">
        {[...doc.layers].reverse().map((l) => (
          <li key={l.id} className={doc.layer === l.id ? 'on' : ''} onClick={() => doc.selectLayer(l.id)}>
            <button
              data-testid={`layer-vis-${l.id}`}
              aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`}
              title={l.visible ? 'Hide' : 'Show'}
              onClick={(e) => {
                e.stopPropagation();
                doc.setLayerVisible(l.id, !l.visible);
              }}
            >
              {l.visible ? '👁' : '—'}
            </button>
            <TextField label="" value={l.name} onCommit={(v) => doc.renameLayer(l.id, v)} testId={`layer-name-${l.id}`} />
            {l.kind === 'vector' && (
              <small className="hint" title="A vector layer: its shapes stay editable">
                shapes
              </small>
            )}
          </li>
        ))}
      </ul>
      <div className="row">
        <button data-testid="layer-add" onClick={() => doc.addLayer()}>
          + Layer
        </button>
        <button data-testid="layer-add-vector" title="A layer of shapes (rectangles, ellipses, paths) that stay editable" onClick={() => doc.addVectorLayer()}>
          + Shape layer
        </button>
        <button data-testid="layer-rasterize" disabled={!doc.currentIsVector} title="Turn the shapes of this layer into ordinary pixels" onClick={() => doc.rasterizeLayer()}>
          Turn into pixels
        </button>
        <button disabled={doc.layers.length <= 1} onClick={() => doc.removeLayer()}>
          Delete
        </button>
        <button disabled={doc.layers[0]!.id === doc.layer} onClick={() => doc.mergeDown()}>
          Merge down
        </button>
        <button aria-label="Move layer up" onClick={() => doc.moveLayer(doc.layer, 1)}>
          ↑
        </button>
        <button aria-label="Move layer down" onClick={() => doc.moveLayer(doc.layer, -1)}>
          ↓
        </button>
      </div>
      {doc.currentIsVector && (
        <ul className="layer-rows" data-testid="shape-list">
          {doc.shapes().map((sh, i) => (
            <li key={i} className={doc.shape === i ? 'on' : ''} data-testid={`shape-row-${i}`} onClick={() => doc.selectShape(i)}>
              {sh.type === 'rect' ? 'Rectangle' : sh.type === 'ellipse' ? 'Ellipse' : sh.points.length + '-point path'} {i + 1}
            </li>
          ))}
          {doc.shapes().length === 0 && <li className="hint">No shapes yet. Use the Shape tools.</li>}
        </ul>
      )}
    </div>
  );
}

/** Frame thumbnails with time, add / duplicate / delete / reorder. */
export function Timeline() {
  useStudio((x) => x.docVersion);
  const doc = studio.doc;
  if (!doc) return null;
  const i = doc.frame;
  return (
    <div className="timeline" data-testid="timeline">
      <div className="row">
        <button data-testid="frame-add" onClick={() => doc.addFrame(false)} title="Add a blank frame after this one">
          + Frame
        </button>
        <button data-testid="frame-dup" onClick={() => doc.addFrame(true)} title="Copy this frame">
          Duplicate
        </button>
        <button data-testid="frame-del" disabled={doc.frames.length <= 1} onClick={() => doc.removeFrame()}>
          Delete
        </button>
        <button disabled={i === 0} aria-label="Move frame left" onClick={() => doc.moveFrame(i, i - 1)}>
          ←
        </button>
        <button disabled={i === doc.frames.length - 1} aria-label="Move frame right" onClick={() => doc.moveFrame(i, i + 1)}>
          →
        </button>
        <NumberField testId="frame-ms" label="Time (ms)" min={10} max={60000} step={10} value={doc.frames[i]!.duration} onCommit={(v) => doc.setDuration(i, v)} />
      </div>
      <div className="frames">
        {doc.frames.map((_, n) => (
          <FrameThumb key={n} index={n} selected={n === i} />
        ))}
      </div>
    </div>
  );
}

function FrameThumb({ index, selected }: { index: number; selected: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = useStudio((x) => x.docVersion);
  const doc = studio.doc!;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const src = frameCanvas(doc, index);
    const scale = Math.max(1, Math.floor(48 / Math.max(doc.width, doc.height)));
    c.width = doc.width * scale;
    c.height = doc.height * scale;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, c.width, c.height);
  }, [version, index, doc]);
  return (
    <button data-testid={`frame-${index}`} className={`frame${selected ? ' on' : ''}`} aria-label={`Frame ${index + 1}`} aria-pressed={selected} onClick={() => doc.selectFrame(index)}>
      <canvas ref={ref} />
      <span>
        {index + 1} · {doc.frames[index]!.duration}ms
      </span>
    </button>
  );
}

const DIR_LABEL: Record<FacingKey, string> = { E: 'East →', SE: 'South-east ↘', S: 'South ↓', SW: 'South-west ↙', W: 'West ←', NW: 'North-west ↖', N: 'North ↑', NE: 'North-east ↗' };

/** Animations: which frames play, per direction, with mirroring and events. */
export function ClipsSection() {
  useStudio((x) => x.docVersion);
  const doc = studio.doc;
  const [sel, setSel] = useState<string | null>(null);
  const [name, setName] = useState('walk');
  const [error, setError] = useState('');
  if (!doc) return null;
  const clip = doc.clips.find((c) => c.name === sel) ?? doc.clips[0] ?? null;
  const n = doc.frames.length;

  const setList = (c: ClipData, key: FacingKey | 'all', text: string): void => {
    try {
      const list = parseFrameList(text, n);
      setError('');
      doc.updateClip(c.name, 'Set animation frames', (x) => {
        if (key === 'all') x.all = list;
        else if (list.length === 0) delete x.dirs[key];
        else x.dirs[key] = list;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="studio-section" data-testid="studio-clips">
      <div className="row">
        <input data-testid="clip-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New animation name" />
        <button
          data-testid="clip-add"
          onClick={() => {
            const c = doc.addClip(name);
            if (c) setSel(c.name);
            else store.notify('warn', 'Give the animation a new, unused name.');
          }}
        >
          + Animation
        </button>
      </div>
      {doc.clips.length === 0 && <p className="hint">An animation is a named list of frames, like “idle” or “walk”. Add one, then say which frames each direction uses.</p>}
      <div className="row">
        {doc.clips.map((c) => (
          <button key={c.name} data-testid={`clip-${c.name}`} className={clip?.name === c.name ? 'on' : ''} onClick={() => setSel(c.name)}>
            {c.name}
          </button>
        ))}
      </div>
      {clip && (
        <>
          <div className="row">
            <TextField label="Name" value={clip.name} onCommit={(v) => { doc.renameClip(clip.name, v); setSel(v.trim()); }} />
            <button onClick={() => doc.removeClip(clip.name)}>Delete</button>
          </div>
          <CheckField label="Loops" value={clip.loop} onChange={(v) => doc.updateClip(clip.name, 'Toggle loop', (c) => (c.loop = v))} />
          <CheckField
            testId="clip-mirror"
            label="Mirror left/right: West, South-west and North-west reuse East, South-east and North-east flipped"
            value={clip.mirror}
            onChange={(v) => doc.updateClip(clip.name, 'Toggle mirroring', (c) => (c.mirror = v))}
          />
          <p className="hint">Frames are numbers like 1, 2, 3 or 2-5. “Every direction” is used for any direction left empty below.</p>
          <TextField testId="clip-all" label="Every direction" value={formatFrameList(clip.all)} onCommit={(v) => setList(clip, 'all', v)} />
          {FACING_NAMES.map((d) => (
            <TextField key={d} testId={`clip-dir-${d}`} label={DIR_LABEL[d]} value={formatFrameList(clip.dirs[d] ?? [])} onCommit={(v) => setList(clip, d, v)} placeholder={clip.mirror && (d === 'W' || d === 'SW' || d === 'NW') ? 'mirrors the other side' : ''} />
          ))}
          {error && (
            <p className="warn-text" role="alert" data-testid="clip-error">
              {error}
            </p>
          )}
          <h3>Events</h3>
          <p className="hint">Fire a named event when the animation reaches a frame (position in the list), e.g. “footstep” or “swing”.</p>
          {clip.events.map((ev, i) => (
            <div className="row" key={i}>
              <span>
                at {ev.at + 1}: {ev.name}
              </span>
              <button onClick={() => doc.updateClip(clip.name, 'Delete event', (c) => c.events.splice(i, 1))}>✕</button>
            </div>
          ))}
          <EventAdder onAdd={(at, evName) => doc.updateClip(clip.name, 'Add event', (c) => c.events.push({ at: at - 1, name: evName }))} />
        </>
      )}
    </div>
  );
}

function EventAdder({ onAdd }: { onAdd(at: number, name: string): void }) {
  const [at, setAt] = useState(1);
  const [name, setName] = useState('');
  return (
    <div className="row">
      <input type="number" min={1} value={at} onChange={(e) => setAt(Math.max(1, Number(e.target.value)))} aria-label="Frame position" style={{ width: 60 }} />
      <input value={name} placeholder="event name" onChange={(e) => setName(e.target.value)} aria-label="Event name" />
      <button
        disabled={!name.trim()}
        onClick={() => {
          onAdd(at, name.trim());
          setName('');
        }}
      >
        Add
      </button>
    </div>
  );
}

/** Animated preview of an animation facing a direction, exactly as the game would show it. */
export function PreviewSection() {
  const version = useStudio((x) => x.docVersion);
  const doc = studio.doc;
  const ref = useRef<HTMLCanvasElement>(null);
  const [clipName, setClipName] = useState('');
  const [dir, setDir] = useState(2);
  const [playing, setPlaying] = useState(true);
  const [scale, setScale] = useState(3);
  const clipList = doc?.clips ?? [];
  const sprite = useMemo(() => (doc ? doc.toSprite() : null), [version, doc]);

  useEffect(() => {
    const c = ref.current;
    if (!c || !doc || !sprite) return;
    let raf = 0;
    const t0 = performance.now();
    const clip = clipName ? findClip(sprite, clipName) : (clipList[0] ? findClip(sprite, clipList[0].name) : undefined);
    const frameCache = new Map<number, HTMLCanvasElement>();
    const draw = (): void => {
      const ctx = c.getContext('2d')!;
      c.width = doc.width * scale;
      c.height = doc.height * scale;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      let frame = doc.frame;
      let flip = false;
      if (clip && playing) {
        const s = sampleClip(sprite, clip, dir, performance.now() - t0);
        frame = s.frame;
        flip = s.flip;
      } else if (clip) {
        const f = framesForFacing(clip, dir);
        flip = f.flip;
        frame = f.frames[0] ?? 0;
      }
      let src = frameCache.get(frame);
      if (!src) {
        src = frameCanvas(doc, frame);
        frameCache.set(frame, src);
      }
      ctx.save();
      if (flip) {
        ctx.translate(c.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(src, 0, 0, c.width, c.height);
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [doc, sprite, clipName, dir, playing, scale, clipList]);

  if (!doc) return null;
  return (
    <div className="studio-section" data-testid="studio-preview">
      <div className="preview-box">
        <canvas ref={ref} data-testid="preview-canvas" />
      </div>
      <div className="row">
        <SelectField<string> label="Animation" value={clipName} options={[{ value: '', label: clipList.length ? clipList[0]!.name : '(none yet)' }, ...clipList.slice(1).map((c) => ({ value: c.name, label: c.name }))]} onChange={setClipName} />
        <SelectField<number> label="Facing" value={dir} options={FACING_NAMES.map((n, i) => ({ value: i, label: n }))} onChange={setDir} testId="preview-dir" />
      </div>
      <div className="row">
        <button onClick={() => setPlaying(!playing)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
        <label className="check">
          Size
          <input type="range" min={1} max={8} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
        </label>
      </div>
    </div>
  );
}

export function PropertiesSection() {
  useStudio((x) => x.docVersion);
  const names = useStudio((x) => x.names);
  const doc = studio.doc;
  const [w, setW] = useState('');
  const [h, setH] = useState('');
  if (!doc) return null;
  const boxes = doc.frames[doc.frame]!.boxes;
  return (
    <div className="studio-section" data-testid="studio-props">
      <TextField
        label="Name"
        value={doc.name}
        onCommit={(v) => {
          const problem = spriteNameProblem(v, names.filter((n) => n !== doc.name));
          if (problem) store.notify('warn', problem);
          else if (v.trim() !== doc.name) store.notify('info', 'Rename by saving a copy: use Save as under the sprite list. (Renaming in place would break objects that use it.)');
        }}
      />
      <fieldset>
        <legend>Canvas</legend>
        <NumberField testId="prop-w" label="Width" min={1} max={512} value={doc.width} onCommit={(v) => setW(String(v))} />
        <NumberField testId="prop-h" label="Height" min={1} max={512} value={doc.height} onCommit={(v) => setH(String(v))} />
        <div className="row">
          <button
            data-testid="prop-resize"
            disabled={!(w || h)}
            onClick={() => {
              doc.resize(Number(w || doc.width), Number(h || doc.height), true);
              setW('');
              setH('');
            }}
          >
            Resize (keep centred)
          </button>
        </div>
      </fieldset>
      <fieldset>
        <legend>Feet point (where it stands)</legend>
        <NumberField testId="prop-ox" label="X" value={doc.origin.x} onCommit={(v) => doc.setOrigin(v, doc.origin.y)} />
        <NumberField testId="prop-oy" label="Y" value={doc.origin.y} onCommit={(v) => doc.setOrigin(doc.origin.x, v)} />
      </fieldset>
      <fieldset>
        <legend>Boxes on frame {doc.frame + 1}</legend>
        {boxes.length === 0 && <p className="hint">Use the Hitbox / Hurtbox tools to drag boxes on the canvas.</p>}
        {boxes.map((b, i) => (
          <div className="row" key={i}>
            <span>
              {b.kind === 'hit' ? 'Hit' : 'Hurt'} {b.x},{b.y} {b.w}x{b.h}
            </span>
            <button onClick={() => doc.removeBox(i)}>✕</button>
          </div>
        ))}
        <button disabled={boxes.length === 0} onClick={() => doc.copyBoxesToAll()}>
          Copy to all frames
        </button>
      </fieldset>
    </div>
  );
}

const SHAPE_TYPES = [
  { value: 'box', label: 'Box' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'ellipse', label: 'Ball / ellipse' },
  { value: 'diamond', label: 'Flat diamond' },
] as const;

/** Build a sprite from parametric shapes with sliders, then bake it into pixels. */
export function ShapesSection() {
  useStudio((x) => x.docVersion);
  const doc = studio.doc;
  if (!doc) return null;
  const shapes = doc.procedural?.shapes ?? [];
  const edit = (label: string, fn: (s: ShapeData[]) => void): void => doc.updateShapes(label, fn);
  const slider = (i: number, key: 'w' | 'd' | 'h' | 'x' | 'y', label: string, min: number, max: number, step: number): ReactElement => (
    <label className="opt">
      <span>{label}</span>
      <input data-testid={`shape-${i}-${key}`} type="range" min={min} max={max} step={step} value={shapes[i]![key]} onChange={(e) => edit('Change shape', (s) => (s[i]![key] = Number(e.target.value)))} />
      <output>{shapes[i]![key]}</output>
    </label>
  );
  return (
    <div className="studio-section" data-testid="studio-shapes">
      <CheckField testId="shapes-on" label="Build this sprite from shapes" value={doc.procedural !== null} onChange={(v) => doc.enableProcedural(v)} />
      {doc.procedural && (
        <>
          <p className="hint">Shapes stand on the feet point. Move the sliders, then “Draw shapes as pixels” to put them on the canvas (it replaces layer 1 of frame 1) and polish by hand.</p>
          {shapes.map((s, i) => (
            <fieldset key={i}>
              <legend>Shape {i + 1}</legend>
              <SelectField label="Kind" value={s.type} options={SHAPE_TYPES.map((t) => ({ ...t }))} onChange={(v) => edit('Change shape', (arr) => (arr[i]!.type = v))} />
              <label className="field">
                <span>Colour</span>
                <input type="color" value={`#${s.color.toString(16).padStart(6, '0')}`} onChange={(e) => edit('Change shape colour', (arr) => (arr[i]!.color = parseInt(e.target.value.slice(1), 16)))} />
              </label>
              {slider(i, 'w', 'Width (cells)', 0.1, 3, 0.1)}
              {slider(i, 'd', 'Depth (cells)', 0.1, 3, 0.1)}
              {slider(i, 'h', 'Height (px)', 0, 160, 1)}
              {slider(i, 'x', 'Offset left/right (px)', -64, 64, 1)}
              {slider(i, 'y', 'Offset up/down (px)', -128, 64, 1)}
              <button disabled={shapes.length <= 1} onClick={() => edit('Delete shape', (arr) => void arr.splice(i, 1))}>
                Delete shape
              </button>
            </fieldset>
          ))}
          <div className="row">
            <button data-testid="shape-add" onClick={() => edit('Add shape', (arr) => void arr.push({ type: 'ellipse', color: 0xf4a259, x: 0, y: -40, w: 0.5, d: 0.5, h: 14 }))}>
              + Shape
            </button>
            <button data-testid="shapes-bake" className="primary" onClick={() => doc.replaceWith(bakeShapes(doc.toSprite()), 'Draw shapes as pixels')}>
              Draw shapes as pixels
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ExportSection() {
  const last = useStudio((x) => x.lastExport);
  const doc = studio.doc;
  const [maxWidth, setMaxWidth] = useState(512);
  const [padding, setPadding] = useState(1);
  const [trim, setTrim] = useState(true);
  const [pot, setPot] = useState(true);
  const [uses, setUses] = useState<string[] | null>(null);
  if (!doc) return null;
  return (
    <div className="studio-section" data-testid="studio-export">
      <NumberField label="Max sheet width" min={32} max={4096} step={32} value={maxWidth} onCommit={setMaxWidth} />
      <NumberField label="Padding (px)" min={0} max={8} value={padding} onCommit={setPadding} />
      <CheckField label="Trim empty borders" value={trim} onChange={setTrim} />
      <CheckField label="Power-of-two size" value={pot} onChange={setPot} />
      <div className="row">
        <button data-testid="export-sheet" className="primary" onClick={() => void studio.exportSheet({ maxWidth, padding, trim, powerOfTwo: pot })}>
          Export sprite sheet
        </button>
        <button
          data-testid="find-uses"
          onClick={async () => {
            const p = store.state.project;
            if (!p) return;
            const refs = await findReferences(assetFs, p.dir, p.project, doc.name);
            setUses(refs.map((r) => `${r.entityName} in ${r.scene.replace(/^scenes\//, '').replace(/\.scene\.json$/, '')}`));
          }}
        >
          Find uses
        </button>
      </div>
      {last && <p className="hint" data-testid="export-result">{last}</p>}
      {uses && (
        <p className="hint" data-testid="uses-result">
          {uses.length === 0 ? 'No object uses this sprite yet. Select an object in the world editor and choose it under Look → Sprite.' : `Used by: ${uses.join(', ')}.`}
        </p>
      )}
    </div>
  );
}
