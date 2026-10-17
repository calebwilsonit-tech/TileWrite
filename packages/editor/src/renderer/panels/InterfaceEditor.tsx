import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import {
  ANCHORS,
  ANCHOR_NAMES,
  BUILTIN_WIDGETS,
  FONTS,
  WIDGET_NAMES,
  anchorAt,
  checkUiLayout,
  completeLayout,
  defaultUiLayout,
  newCustomWidget,
  offsetsFor,
  widgetCss,
  type Anchor,
  type UiTheme,
  type UiWidget,
} from '@tilewright/runtime';
import { store, useApp } from '../app/store';
import { CheckField, NumberField, SelectField, TextField } from './fields';

const SCREENS = [
  { id: 'hd', label: 'Widescreen 1280 x 720', w: 1280, h: 720 },
  { id: 'old', label: 'Square-ish 960 x 720', w: 960, h: 720 },
  { id: 'ultra', label: 'Ultrawide 1680 x 720', w: 1680, h: 720 },
  { id: 'phone', label: 'Phone, sideways 844 x 390', w: 844, h: 390 },
] as const;


/** A stand-in for what a piece of the screen shows. */
function Mock({ w, theme }: { w: UiWidget; theme: UiTheme }) {
  switch (w.kind) {
    case 'hearts':
      return <div style={{ fontSize: 22, letterSpacing: 3, color: '#ff5d6c' }}>♥♥♥<span style={{ color: '#8a8f9c' }}>♡</span></div>;
    case 'lightbar':
      return (
        <div style={{ width: 160, height: 10, background: '#1b1d24', border: '1px solid #000', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ width: '65%', height: '100%', background: 'linear-gradient(90deg, #d9a21a, #ffe27a)' }} />
        </div>
      );
    case 'slots':
      return (
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 2, 3, 4].map((n) => (
            <div key={n} style={{ width: 44, height: 44, border: '2px solid #ffffff55', borderRadius: Math.min(theme.radius, 14), background: '#14161bcc', fontSize: 11, padding: '1px 4px' }}>
              {n}
            </div>
          ))}
        </div>
      );
    case 'bosses':
      return (
        <div style={{ width: 320, textAlign: 'center', fontSize: 13 }}>
          Boss
          <div style={{ height: 10, background: '#1b1d24', border: '1px solid #000', borderRadius: 6, marginTop: 3, overflow: 'hidden' }}>
            <div style={{ width: '70%', height: '100%', background: 'linear-gradient(90deg, #b3366e, #e0566b)' }} />
          </div>
        </div>
      );
    case 'toasts':
      return <div style={{ background: '#14161bdd', borderLeft: `4px solid ${theme.highlight}`, padding: '7px 12px', borderRadius: Math.min(theme.radius, 8), fontSize: 14 }}>Received Bread</div>;
    case 'counter':
      return (
        <div style={{ fontSize: 15 }}>
          <span style={{ opacity: 0.85, marginRight: 6 }}>{w.label}</span>3
        </div>
      );
    case 'bar':
      return (
        <div style={{ fontSize: 15 }}>
          <span style={{ opacity: 0.85 }}>{w.label}</span>
          <div style={{ width: 160, height: 10, background: '#1b1d24', border: '1px solid #000', borderRadius: 6, overflow: 'hidden', marginTop: 3 }}>
            <div style={{ width: '60%', height: '100%', background: w.color }} />
          </div>
        </div>
      );
    default:
      return <div style={{ fontSize: 15 }}>{w.text.replace(/\{[^}]*\}/g, '7') || '(no words yet)'}</div>;
  }
}

/**
 * The look and arrangement of the game's own screen. The preview uses the same placement rules as the game; drag a
 * piece to pin it to the nearest corner, edge or the middle, and pick another screen shape to see how it holds up.
 */
export function InterfaceEditor() {
  useApp((s) => s.storyVersion);
  const layout = completeLayout(store.uiLayout);
  const theme = layout.theme;
  const [sel, setSel] = useState<string>('hearts');
  const [screenId, setScreenId] = useState<(typeof SCREENS)[number]['id']>('hd');
  const [big, setBig] = useState(false);
  const screen = SCREENS.find((s) => s.id === screenId)!;
  const previewWidth = big ? 820 : 560;
  const k = previewWidth / screen.w;
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; sx: number; sy: number; left: number; top: number; w: number; h: number } | null>(null);
  const problems = useMemo(() => checkUiLayout(layout), [layout]);
  const current = layout.widgets.find((w) => w.id === sel) ?? layout.widgets[0]!;

  const setWidget = (id: string, patch: Partial<UiWidget>): void => store.setUiLayout({ ...layout, widgets: layout.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  const setTheme = (patch: Partial<UiTheme>): void => store.setUiLayout({ ...layout, theme: { ...theme, ...patch } });

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const d = drag.current;
      if (!d) return;
      const left = d.left + (e.clientX - d.sx) / k;
      const top = d.top + (e.clientY - d.sy) / k;
      const anchor = anchorAt((left + d.w / 2) / screen.w, (top + d.h / 2) / screen.h);
      const { x, y } = offsetsFor(anchor, { left, top, w: d.w, h: d.h }, { w: screen.w, h: screen.h });
      const w = store.uiLayout.widgets.find((v) => v.id === d.id);
      if (w && (w.anchor !== anchor || w.x !== x || w.y !== y)) store.setUiLayout({ ...store.uiLayout, widgets: store.uiLayout.widgets.map((v) => (v.id === d.id ? { ...v, anchor, x: Math.max(-2000, Math.min(2000, x)), y: Math.max(-2000, Math.min(2000, y)) } : v)) });
    };
    const up = (): void => {
      drag.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [k, screen.w, screen.h]);

  const startDrag = (e: ReactPointerEvent, w: UiWidget): void => {
    e.preventDefault();
    setSel(w.id);
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const st = stage.current!.getBoundingClientRect();
    drag.current = { id: w.id, sx: e.clientX, sy: e.clientY, left: (box.left - st.left) / k, top: (box.top - st.top) / k, w: box.width / k, h: box.height / k };
  };

  const piece = (w: UiWidget, style: CSSProperties): ReactElement => (
    <div
      key={w.id}
      data-testid={`ui-widget-${w.id}`}
      data-anchor={w.anchor}
      onPointerDown={(e) => startDrag(e, w)}
      style={{ ...style, cursor: 'grab', outline: w.id === current.id ? '2px solid #6aa8ff' : '1px dashed #ffffff44', outlineOffset: 2, opacity: w.visible ? 1 : 0.3, textShadow: '0 1px 3px #000' }}
    >
      <Mock w={w} theme={theme} />
    </div>
  );
  const css = (w: UiWidget): CSSProperties => cssOf(widgetCss(w, theme.scale));
  const flow = layout.widgets.filter((w) => w.anchor === 'default' && w.kind !== 'toasts');
  const pinned = layout.widgets.filter((w) => w.anchor !== 'default' || w.kind === 'toasts');
  const custom = current.kind === 'counter' || current.kind === 'bar' || current.kind === 'text';

  return (
    <div className={big ? 'story-body dg-overlay' : 'story-body'} data-testid="interface-tab">
      <p className="hint">The look of your game&rsquo;s own screen. Drag a piece in the picture to pin it to a corner, an edge or the middle; the picture follows the same rules as the game. Pieces left &ldquo;where the game puts it&rdquo; stay in the column at the top left.</p>
      <div className="row">
        <SelectField<string> label="Preview as" testId="ui-res" value={screenId} options={SCREENS.map((s) => ({ value: s.id, label: s.label }))} onChange={(v) => setScreenId(v as typeof screenId)} />
        <button className="small" data-testid="ui-big" onClick={() => setBig(!big)}>
          {big ? 'Make it smaller' : 'Make it bigger'}
        </button>
      </div>
      <div style={{ width: previewWidth, height: screen.h * k, position: 'relative', overflow: 'hidden', border: '1px solid #4a4f60', borderRadius: 6, background: '#1d2330' }}>
        <div
          ref={stage}
          data-testid="ui-stage"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: screen.w,
            height: screen.h,
            transform: `scale(${k})`,
            transformOrigin: 'top left',
            fontFamily: FONTS[theme.font],
            color: theme.text,
            background: 'repeating-conic-gradient(#222a3a 0% 25%, #1d2330 0% 50%) 0 0 / 64px 64px',
          }}
        >
          <div style={{ position: 'absolute', top: 10, left: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', pointerEvents: 'none' }}>
            {flow.map((w) => piece(w, { ...css(w), pointerEvents: 'auto', alignSelf: w.kind === 'bosses' ? 'center' : 'flex-start' }))}
          </div>
          {pinned.map((w) => piece(w, w.anchor === 'default' ? { position: 'absolute', right: 14, bottom: 14, ...css(w) } : css(w)))}
        </div>
      </div>

      <div className="row wrap">
        {layout.widgets.map((w) => (
          <button key={w.id} className={w.id === current.id ? 'small on' : 'small'} data-testid={`ui-pick-${w.id}`} onClick={() => setSel(w.id)}>
            {(BUILTIN_WIDGETS as readonly string[]).includes(w.kind) ? WIDGET_NAMES[w.kind] : w.label || w.id}
          </button>
        ))}
      </div>
      <div className="row wrap">
        {(['counter', 'bar', 'text'] as const).map((kind) => (
          <button
            key={kind}
            className="small"
            data-testid={`ui-add-${kind}`}
            onClick={() => {
              const w = newCustomWidget(kind, layout.widgets.map((v) => v.id));
              store.setUiLayout({ ...layout, widgets: [...layout.widgets, w] });
              setSel(w.id);
            }}
          >
            Add a {kind}
          </button>
        ))}
      </div>

      <fieldset className="story-card" data-testid="ui-selected">
        <legend>{(BUILTIN_WIDGETS as readonly string[]).includes(current.kind) ? WIDGET_NAMES[current.kind] : current.label || current.id}</legend>
        <SelectField<Anchor> label="Pinned to" testId="ui-anchor" value={current.anchor} options={ANCHORS.map((a) => ({ value: a, label: ANCHOR_NAMES[a] }))} onChange={(a) => setWidget(current.id, { anchor: a })} />
        {current.anchor !== 'default' && (
          <>
            <NumberField label="Across (pixels from that edge)" testId="ui-x" value={current.x} min={-2000} max={2000} onCommit={(v) => setWidget(current.id, { x: Math.round(v) })} />
            <NumberField label="Down (pixels from that edge)" testId="ui-y" value={current.y} min={-2000} max={2000} onCommit={(v) => setWidget(current.id, { y: Math.round(v) })} />
          </>
        )}
        <NumberField label="Size (1 = normal)" testId="ui-scale" value={current.scale} step={0.1} min={0.5} max={3} onCommit={(v) => setWidget(current.id, { scale: Math.round(v * 100) / 100 })} />
        <CheckField label="Shown" testId="ui-visible" value={current.visible} onChange={(v) => setWidget(current.id, { visible: v })} />
        {custom && (
          <>
            {current.kind !== 'text' && <TextField label="Label" testId="ui-label" value={current.label} onCommit={(v) => setWidget(current.id, { label: v })} />}
            {current.kind !== 'text' && <TextField label="Shows this flag or counter" testId="ui-variable" value={current.variable} onCommit={(v) => setWidget(current.id, { variable: v.trim() })} />}
            {current.kind === 'bar' && (
              <>
                <NumberField label="Full at" testId="ui-max" value={current.max} min={1} onCommit={(v) => setWidget(current.id, { max: v })} />
                <TextField label="...or full at this counter" testId="ui-max-variable" value={current.maxVariable} onCommit={(v) => setWidget(current.id, { maxVariable: v.trim() })} />
                <label className="field">
                  <span>Colour</span>
                  <input data-testid="ui-color" type="color" value={current.color} onChange={(e) => setWidget(current.id, { color: e.target.value })} />
                </label>
              </>
            )}
            {current.kind === 'text' && <TextField label="Words (use {name} for a flag or counter)" testId="ui-text" value={current.text} onCommit={(v) => setWidget(current.id, { text: v })} />}
            <button
              className="small"
              data-testid="ui-delete"
              onClick={() => {
                store.setUiLayout({ ...layout, widgets: layout.widgets.filter((w) => w.id !== current.id) });
                setSel('hearts');
              }}
            >
              Delete this piece
            </button>
          </>
        )}
        {current.anchor !== 'default' && (BUILTIN_WIDGETS as readonly string[]).includes(current.kind) && (
          <button className="small" data-testid="ui-unpin" onClick={() => setWidget(current.id, { anchor: 'default', x: 0, y: 0 })}>
            Put it back where the game puts it
          </button>
        )}
      </fieldset>

      <fieldset className="story-card" data-testid="ui-theme">
        <legend>Theme</legend>
        <SelectField<UiTheme['font']> label="Lettering" testId="ui-theme-font" value={theme.font} options={[{ value: 'serif', label: 'Storybook (serif)' }, { value: 'sans', label: 'Clean (sans-serif)' }, { value: 'mono', label: 'Typewriter (monospace)' }, { value: 'rounded', label: 'Friendly (rounded)' }]} onChange={(v) => setTheme({ font: v })} />
        {(
          [
            ['text', 'Text colour'],
            ['accent', 'Headings and names'],
            ['panel', 'Panels and boxes'],
            ['border', 'Borders'],
            ['highlight', 'Selected choice'],
          ] as const
        ).map(([key, label]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <input data-testid={`ui-theme-${key}`} type="color" value={theme[key]} onChange={(e) => setTheme({ [key]: e.target.value })} />
          </label>
        ))}
        <NumberField label="Roundness of corners" testId="ui-theme-radius" value={theme.radius} min={0} max={28} onCommit={(v) => setTheme({ radius: Math.round(v) })} />
        <NumberField label="Size of menus, conversation and display (1 = normal)" testId="ui-theme-scale" value={theme.scale} step={0.05} min={0.75} max={2} onCommit={(v) => setTheme({ scale: Math.round(v * 100) / 100 })} />
        <button className="small" data-testid="ui-theme-reset" onClick={() => store.setUiLayout({ ...layout, theme: defaultUiLayout().theme })}>
          Back to the standard theme
        </button>
      </fieldset>

      {problems.length > 0 && (
        <ul className="problems" data-testid="ui-problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <button className="small" data-testid="ui-reset" onClick={() => store.setUiLayout(defaultUiLayout())}>
        Reset everything to the standard screen
      </button>
    </div>
  );
}

/** `{ 'transform-origin': ... }` -> `{ transformOrigin: ... }` for React. */
function cssOf(css: Record<string, string>): CSSProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(css)) out[k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = v;
  return out as CSSProperties;
}
