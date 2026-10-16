import { useEffect, useRef, useState } from 'react';
import { compositeFrame, type SpriteData } from '@tilewright/runtime';
import { store } from '../app/store';
import { StudioCanvas } from './StudioCanvas';
import { ClipsSection, ExportSection, LayersSection, PalettePanel, PreviewSection, PropertiesSection, ShapesSection, Timeline, ToolBox } from './StudioPanels';
import { spriteNameProblem } from './assets';
import { studio, useStudio } from './store';

/** A small picture of a saved sprite's first frame. */
export function SpriteThumb({ data, size = 40 }: { data: SpriteData; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const src = document.createElement('canvas');
    src.width = data.width;
    src.height = data.height;
    src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(compositeFrame(data, 0)), data.width, data.height), 0, 0);
    const scale = Math.max(1, Math.floor(size / Math.max(data.width, data.height)));
    c.width = Math.min(size, data.width * scale);
    c.height = Math.min(size, data.height * scale);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, c.width, c.height);
  }, [data, size]);
  return <canvas ref={ref} className="thumb" aria-hidden="true" />;
}

export function SpriteList({ onOpen, guard }: { onOpen(name: string): void; guard(then: () => void): void }) {
  const names = useStudio((s) => s.names);
  const open = useStudio((s) => s.openName);
  const query = useStudio((s) => s.query);
  useStudio((s) => s.assetsVersion);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('hero');
  const [w, setW] = useState(32);
  const [h, setH] = useState(48);
  const q = query.trim().toLowerCase();
  const shown = names.filter((n) => !q || n.toLowerCase().includes(q) || (studio.meta.tags[n] ?? []).some((t) => t.includes(q)));
  const problem = creating ? spriteNameProblem(name, names) : null;

  return (
    <div className="studio-section" data-testid="sprite-list">
      <div className="row">
        <button data-testid="sprite-new" onClick={() => setCreating(!creating)}>
          + New sprite
        </button>
        <button data-testid="sprite-import" onClick={() => guard(() => void studio.importFile().then((n) => n && studio.openSprite(n)))} title="Import a PNG (or sprite sheet) or an Aseprite file">
          Import…
        </button>
      </div>
      {creating && (
        <fieldset>
          <legend>New sprite</legend>
          <label className="field">
            <span>Name</span>
            <input data-testid="new-sprite-name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Width (px)</span>
            <input data-testid="new-sprite-w" type="number" min={1} max={512} value={w} onChange={(e) => setW(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Height (px)</span>
            <input data-testid="new-sprite-h" type="number" min={1} max={512} value={h} onChange={(e) => setH(Number(e.target.value))} />
          </label>
          {problem && <p className="warn-text">{problem}</p>}
          <div className="row">
            <button
              className="primary"
              data-testid="new-sprite-ok"
              disabled={!!problem}
              onClick={() =>
                guard(() =>
                  void studio.newSprite(name, w, h).then((ok) => {
                    if (ok) setCreating(false);
                  }),
                )
              }
            >
              Create
            </button>
          </div>
        </fieldset>
      )}
      <input className="search" type="search" placeholder="Search name or tag…" aria-label="Search sprites" value={query} onChange={(e) => studio.set({ query: e.target.value })} />
      <ul className="sprite-rows">
        {shown.map((n) => (
          <li key={n}>
            <button data-testid={`sprite-${n}`} className={`sprite-row${open === n ? ' on' : ''}`} onClick={() => onOpen(n)}>
              {studio.assets.get(n) && <SpriteThumb data={studio.assets.get(n)!} />}
              <span>{n}</span>
              {(studio.meta.tags[n] ?? []).map((t) => (
                <small key={t} className="tag">
                  {t}
                </small>
              ))}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="hint">{names.length === 0 ? 'No sprites yet. Make one or import a PNG.' : `No sprite matches “${query}”.`}</li>}
      </ul>
      {studio.state.problems.map((p, i) => (
        <p key={i} className="warn-text" role="alert">
          {p}
        </p>
      ))}
    </div>
  );
}

/** Asks what to do with unsaved drawing changes before leaving a sprite. */
function UnsavedDialog({ name, onSave, onDiscard, onCancel }: { name: string; onSave(): void; onDiscard(): void; onCancel(): void }) {
  return (
    <div className="modal-backdrop">
      <div className="dialog" role="alertdialog" aria-label="Unsaved sprite" data-testid="sprite-unsaved">
        <h2>Save changes to “{name}”?</h2>
        <p>You drew on this sprite since the last save.</p>
        <div className="row end">
          <button onClick={onCancel}>Cancel</button>
          <button data-testid="sprite-discard" onClick={onDiscard}>
            Discard
          </button>
          <button className="primary" data-testid="sprite-save-first" onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function StudioView() {
  useStudio((s) => s.docVersion);
  const open = useStudio((s) => s.openName);
  const doc = studio.doc;
  const [pending, setPending] = useState<{ then: () => void } | null>(null);

  /** Run 	hen now, or after asking what to do with unsaved drawing changes. */
  const guard = (then: () => void): void => {
    if (studio.isDirty()) setPending({ then });
    else then();
  };
  const switchTo = (name: string): void => {
    if (name === open) return;
    guard(() => studio.openSprite(name));
  };

  // tool hotkeys while the studio is showing (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (store.state.workspace !== 'sprites' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const tool = STUDIO_KEYS[e.key.toLowerCase()];
      if (tool) {
        studio.set({ tool });
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="studio" data-testid="studio">
      <aside className="studio-left">
        <SpriteList onOpen={switchTo} guard={guard} />
        <ToolBox />
      </aside>
      <main className="studio-center">
        <div className="studio-bar">
          <strong data-testid="studio-title">{open ? `${open}${doc?.dirty ? ' •' : ''}` : 'No sprite open'}</strong>
          <button data-testid="studio-undo" disabled={!doc?.history.canUndo} onClick={() => doc?.history.undo() && doc.markChanged()} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button data-testid="studio-redo" disabled={!doc?.history.canRedo} onClick={() => doc?.history.redo() && doc.markChanged()} title="Redo (Ctrl+Y)">
            Redo
          </button>
          <button data-testid="studio-save" className={doc?.dirty ? 'primary' : ''} disabled={!doc} onClick={() => void studio.save()} title="Save the sprite (Ctrl+S)">
            Save sprite
          </button>
          <button disabled={!open} onClick={() => open && void studio.remove(open)} title="Delete this sprite from the project">
            Delete
          </button>
          <span className="grow" />
          <span className="hint">Space + drag or right-drag pans, wheel zooms.</span>
        </div>
        <StudioCanvas />
        <Timeline />
      </main>
      <aside className="studio-right">
        <Section title="Preview" open>
          <PreviewSection />
        </Section>
        <Section title="Palette" open>
          <PalettePanel />
        </Section>
        <Section title="Layers" open>
          <LayersSection />
        </Section>
        <Section title="Animations" testId="sec-anims">
          <ClipsSection />
        </Section>
        <Section title="Properties" testId="sec-props">
          <PropertiesSection />
        </Section>
        <Section title="Shapes (sliders)" testId="sec-shapes">
          <ShapesSection />
        </Section>
        <Section title="Export" testId="sec-export">
          <ExportSection />
        </Section>
      </aside>
      {pending && (
        <UnsavedDialog
          name={open ?? ''}
          onCancel={() => setPending(null)}
          onDiscard={() => {
            const next = pending;
            setPending(null);
            next.then();
          }}
          onSave={() =>
            void studio.save().then((ok) => {
              if (ok) {
                const next = pending;
                setPending(null);
                next.then();
              }
            })
          }
        />
      )}
    </div>
  );
}

const STUDIO_KEYS: Record<string, import('./store').StudioTool> = { b: 'pencil', e: 'eraser', l: 'line', u: 'rect', o: 'ellipse', g: 'fill', i: 'picker', m: 'select', x: 'isobox', f: 'origin', h: 'hitbox', j: 'hurtbox' };

function Section({ title, open, children, testId }: { title: string; open?: boolean; children: React.ReactNode; testId?: string }) {
  return (
    <details open={open} className="studio-details" data-testid={testId}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}
