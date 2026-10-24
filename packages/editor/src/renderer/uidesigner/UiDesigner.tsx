import { useEffect, useMemo, useRef, useState } from 'react';
import { WIDGET_LABELS, WIDGET_TYPES, findWidget, roleOfScreen, screenBlocksInput, screenPauses, type UiDoc, type UiNode, type UiScreen, type WidgetType } from '@tilewright/runtime';
import { autoFocus, host } from '@tilewright/behaviors';
import { usePlugins } from '../plugins/hooks';
import { store, useApp } from '../app/store';
import { useStudio } from '../studio/store';
import { CheckField, NumberField, SelectField, TextField } from '../panels/fields';
import { DesignCanvas, canvasApi, namesOnScreen } from './DesignCanvas';
import { FlowMap } from './FlowMap';
import { PluginScreens } from './PluginScreens';
import { UiInspector } from './UiInspector';
import { RESOLUTIONS, designer, useDesigner } from './state';
import { addScreen, addWidget, checkUiDoc, designScreen, prefabUses, removePrefab, removeScreen, screenNameProblem, updateScreen, updateWidget } from './ui-edit';

const CONTAINERS = new Set<string>(['panel', 'list', 'grid', 'tabs', 'hand', 'turnOrder']);

function Outline({ node, depth, selected, onPick }: { node: UiNode; depth: number; selected: string | null; onPick(id: string): void }) {
  return (
    <>
      <button className={`ui-outline-row${selected === node.id ? ' on' : ''}`} style={{ paddingLeft: 6 + depth * 14 }} data-testid={`ui-outline-${node.name}`} onClick={() => onPick(node.id)}>
        <span className="ui-type">{node.type}</span> {node.name}
        {node.visible && <small title={`Shown only when ${node.visible}`}> ?</small>}
      </button>
      {node.children.map((c) => (
        <Outline key={c.id} node={c} depth={depth + 1} selected={selected} onPick={onPick} />
      ))}
    </>
  );
}

function ScreenProps({ doc, screenId }: { doc: UiDoc; screenId: string }) {
  const s = doc.screens.find((x) => x.id === screenId);
  const [problem, setProblem] = useState('');
  if (!s) return null;
  const set = (fn: (x: UiScreen) => void): void => designer.edit(updateScreen(doc, s.id, fn));
  return (
    <fieldset data-testid="ui-screen-props">
      <legend>Screen “{s.name}”</legend>
      <TextField
        testId="ui-screen-name"
        label="Name"
        value={s.name}
        onCommit={(v) => {
          const p = screenNameProblem(doc, v, s.id);
          setProblem(p ?? '');
          if (p) return;
          // buttons that open this screen follow the new name
          const old = s.name;
          const rename = (n: UiNode): void => {
            for (const group of [n.on.click, n.on.change, n.on.hover]) for (const a of group) if (a.type === 'uiScreen' && a.params.screen === old) a.params.screen = v.trim();
            n.children.forEach(rename);
          };
          const next = structuredClone(doc);
          next.screens.forEach((x) => rename(x.root));
          next.prefabs.forEach((x) => rename(x.widget));
          next.screens.find((x) => x.id === s.id)!.name = v.trim();
          designer.edit(next);
        }}
      />
      {problem && <p className="hint warn">{problem}</p>}
      <SelectField<string>
        testId="ui-screen-role"
        label="This screen is used as"
        value={s.role ?? ''}
        options={[
          { value: '', label: roleOfScreen(s) ? `(the usual for its name: ${host.ext.screenRoles.get(roleOfScreen(s))?.label ?? roleOfScreen(s)})` : '(nothing in particular: buttons open it)' },
          ...[...host.ext.screenRoles.values()].map((r) => ({ value: r.id, label: r.label })),
        ]}
        onChange={(v) => set((x) => (x.role = v === '' ? undefined : v))}
      />
      {roleOfScreen(s) && host.ext.screenRoles.get(roleOfScreen(s))?.help && <p className="hint">{host.ext.screenRoles.get(roleOfScreen(s))!.help}</p>}
      {s.from && (
        <p className="hint" data-testid="ui-screen-from">
          A copy of the screen “{s.from.screen}” from the plugin “{s.from.plugin}”. See Screens from plugins to compare it with the plugin&apos;s or put the plugin&apos;s back.
        </p>
      )}
      <CheckField
        testId="ui-screen-modal"
        label="The game waits while this screen is open (menus)"
        value={screenPauses(s)}
        onChange={(v) =>
          set((x) => {
            x.pauses = v;
            // a screen that only has the older switch keeps both halves together, as it always did
            if (x.blocksInput === undefined) x.modal = v;
            else x.modal = v && x.blocksInput;
          })
        }
      />
      <CheckField
        testId="ui-screen-blocks"
        label="The game's own buttons (walking, jumping) stop, and Back belongs to this screen"
        value={screenBlocksInput(s)}
        onChange={(v) =>
          set((x) => {
            x.blocksInput = v;
            x.modal = (x.pauses ?? x.modal) && v;
          })
        }
      />
      <SelectField<string>
        testId="ui-screen-back"
        label="When the player presses Back (Esc, the pad's B)"
        value={s.back}
        options={[
          { value: 'auto', label: 'the usual: close Pause, go back from other menus, let a heads-up display ignore it' },
          { value: 'previous', label: 'go back to the screen before it' },
          { value: 'close', label: 'close it, and anything opened from it' },
          { value: 'screen', label: 'go to a screen I choose' },
          { value: 'nothing', label: 'nothing (the screen keeps Back for itself)' },
        ]}
        onChange={(v) => set((x) => (x.back = v as typeof x.back))}
      />
      {s.back === 'screen' && (
        <SelectField<string>
          testId="ui-screen-back-to"
          label="Back goes to"
          value={s.backTo}
          options={[{ value: '', label: '(choose a screen)' }, ...doc.screens.filter((o) => o.id !== s.id).map((o) => ({ value: o.name, label: o.name }))]}
          onChange={(v) => set((x) => (x.backTo = v))}
        />
      )}
      <NumberField testId="ui-screen-priority" label="Which screen gets the buttons first when several are open (higher first; same: the one opened last)" min={-99} max={99} step={1} value={s.priority} onCommit={(v) => set((x) => (x.priority = Math.round(v)))} />
      <CheckField testId="ui-screen-start" label="Opens when the game starts (title screen, heads-up display)" value={s.opensOnStart} onChange={(v) => set((x) => (x.opensOnStart = v))} />
      <NumberField testId="ui-screen-dim" label="Darken the game behind it (0 to 1)" min={0} max={1} step={0.1} value={s.dim} onCommit={(v) => set((x) => (x.dim = v))} />
      <SelectField<string> testId="ui-screen-transition" label="When it opens" value={s.transition} options={[{ value: 'none', label: 'appears at once' }, { value: 'fade', label: 'fades in' }, { value: 'slide', label: 'slides up' }]} onChange={(v) => set((x) => (x.transition = v as typeof x.transition))} />
      <p className="hint">
        The screen that plays a part (Title, Pause, Inventory, World map, Settings...) is the one the game opens for it; with none of your own, the plugin&apos;s is used. A screen named <strong>Title</strong>, <strong>Pause</strong> or <strong>Settings</strong> plays that part without choosing it. A screen&apos;s Back setting decides what it does once it is open. Turn on <em>Screens</em> in the Play menu to watch which screen handled the last press.
      </p>
    </fieldset>
  );
}

/** The interface designer: screens made of widgets, drawn by the same code the game uses. */
export function UiDesigner() {
  useApp((s) => s.storyVersion);
  usePlugins();
  const doc = store.uiDoc;
  const sprites = useStudio((s) => s.names);
  const screenId = useDesigner((s) => s.screenId);
  const selected = useDesigner((s) => s.selected);
  const mode = useDesigner((s) => s.mode);
  const resolution = useDesigner((s) => s.resolution);
  const showSafe = useDesigner((s) => s.showSafe);
  const preview = useDesigner((s) => s.preview);
  const canUndo = useDesigner((s) => s.past.length > 0);
  const canRedo = useDesigner((s) => s.future.length > 0);
  const [newName, setNewName] = useState('');
  const [problem, setProblem] = useState('');
  const [ghost, setGhost] = useState<{ type: WidgetType; x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const prefabName = useDesigner((s) => s.prefab);
  const screen = designScreen(doc, screenId, prefabName);
  useEffect(() => {
    if (prefabName) return;
    if (screen && screen.id !== screenId) designer.set({ screenId: screen.id });
    if (!screen && screenId) designer.set({ screenId: null, selected: null });
  }, [screen, screenId, prefabName]);

  const problems = useMemo(() => checkUiDoc(doc, { tables: new Set(store.tables.map((t) => t.name)), sprites: new Set(sprites), pluginScreens: new Set([...host.ext.screens.values()].map((d) => d.screen.name)), roles: new Set(host.ext.screenRoles.keys()) }), [doc, sprites]);
  const names = screen ? namesOnScreen(screen.root, doc) : [];

  const containerFor = (): string => {
    if (!screen) return '';
    const sel = selected ? findWidget(screen.root, selected) : null;
    if (sel && CONTAINERS.has(sel.type)) return sel.id;
    if (sel) {
      let parent: UiNode | null = null;
      const find = (n: UiNode): void => {
        if (n.children.some((c) => c.id === sel.id)) parent = n;
        n.children.forEach(find);
      };
      find(screen.root);
      return (parent as UiNode | null)?.id ?? screen.root.id;
    }
    return screen.root.id;
  };

  const add = (type: WidgetType): void => {
    if (!screen) return;
    const made = addWidget(doc, screen.id, containerFor(), type);
    designer.edit(made.doc);
    designer.set({ selected: made.id });
  };

  const startPaletteDrag = (e: React.PointerEvent, type: WidgetType): void => {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent): void => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      moved = true;
      setGhost({ type, x: ev.clientX, y: ev.clientY });
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGhost(null);
      if (!moved) add(type);
      else canvasApi.current?.drop(type, ev.clientX, ev.clientY);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKey = (e: React.KeyboardEvent): void => {
    const t = e.target as HTMLElement;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) designer.redo();
      else designer.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      designer.redo();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && screen && selected !== screen.root.id) {
      void import('./ui-edit').then(({ removeWidget }) => {
        designer.edit(removeWidget(doc, selected));
        designer.set({ selected: null });
      });
    }
  };

  return (
    <div className="ui-designer" data-testid="ui-designer" ref={root} tabIndex={-1} onKeyDown={onKey}>
      <aside className="ui-left">
        <section>
          <h3>Screens</h3>
          <ul className="ui-screen-list" data-testid="ui-screen-list">
            {doc.screens.map((s) => (
              <li key={s.id}>
                <button className={s.id === screen?.id ? 'on' : ''} data-testid={`ui-screen-${s.name}`} onClick={() => designer.set({ screenId: s.id, prefab: null, selected: null })}>
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
          <div className="row">
            <input data-testid="ui-new-screen-name" aria-label="New screen name" placeholder="New screen name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            <button
              data-testid="ui-new-screen"
              onClick={() => {
                const p = screenNameProblem(doc, newName);
                setProblem(p ?? '');
                if (p) return;
                const made = addScreen(doc, newName.trim());
                designer.edit(made.doc);
                designer.set({ screenId: made.id, selected: null });
                setNewName('');
              }}
            >
              + New screen
            </button>
          </div>
          {problem && <p className="hint warn">{problem}</p>}
          {screen && (
            <button
              data-testid="ui-delete-screen"
              onClick={() => {
                designer.edit(removeScreen(doc, screen.id));
                designer.set({ screenId: null, selected: null });
              }}
            >
              Delete this screen
            </button>
          )}
        </section>
        <section>
          <h3>Palette</h3>
          <p className="hint">Drag onto the picture, or click to add inside the selected container.</p>
          <div className="ui-palette" data-testid="ui-palette">
            {WIDGET_TYPES.filter((t) => t !== 'instance').map((t) => (
              <button key={t} className="ui-palette-item" data-testid={`ui-palette-${t}`} title={WIDGET_LABELS[t]} onPointerDown={(e) => startPaletteDrag(e, t)} disabled={!screen}>
                {WIDGET_LABELS[t].split(' (')[0]}
              </button>
            ))}
          </div>
        </section>
        {host.ext.widgets.size > 0 && (
          <section data-testid="ui-plugin-widgets">
            <h3>From plugins</h3>
            <div className="ui-palette">
              {[...host.ext.widgets.values()].map((w) => (
                <button
                  key={w.id}
                  className="ui-palette-item"
                  data-testid={`ui-plugin-widget-${w.id}`}
                  title={w.label}
                  disabled={!screen}
                  onClick={() => {
                    if (!screen) return;
                    const made = addWidget(doc, screen.id, containerFor(), 'plugin');
                    designer.edit(updateWidget(made.doc, made.id, (n) => void Object.assign(n, { name: w.label.split(' (')[0], source: w.id, ...(w.defaults ?? {}) })));
                    designer.set({ selected: made.id });
                  }}
                >
                  {w.label.split(' (')[0]}
                </button>
              ))}
            </div>
          </section>
        )}
        <section>
          <h3>UI prefabs</h3>
          {doc.prefabs.length === 0 && <p className="hint">Select a widget and use “Make a UI prefab” to reuse it.</p>}
          <ul className="ui-prefab-list" data-testid="ui-prefab-list">
            {doc.prefabs.map((p) => (
              <li key={p.name}>
                <button
                  data-testid={`ui-prefab-${p.name}`}
                  title={`Used ${prefabUses(doc, p.name).length} times. Click to add one to the screen.`}
                  onClick={() => {
                    if (!screen) return;
                    const made = addWidget(doc, screen.id, containerFor(), 'instance');
                    designer.edit({ ...made.doc, screens: made.doc.screens.map((s) => (s.id === screen.id ? { ...s, root: patchInstance(s.root, made.id, p.name) } : s)) });
                    designer.set({ selected: made.id });
                  }}
                >
                  {p.name} ({prefabUses(doc, p.name).length})
                </button>
                <button aria-label={`Edit ${p.name}`} data-testid={`ui-prefab-edit-${p.name}`} title="Select the prefab's own widgets" onClick={() => designer.set({ prefab: p.name, selected: p.widget.id, mode: 'layout' })}>
                  ✎
                </button>
                <button aria-label={`Delete ${p.name}`} disabled={prefabUses(doc, p.name).length > 0} title={prefabUses(doc, p.name).length ? 'Still in use' : 'Delete'} onClick={() => designer.edit(removePrefab(doc, p.name))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
        {screen && (
          <section>
            <h3>Outline</h3>
            <div className="ui-outline" data-testid="ui-outline">
              <Outline node={screen.root} depth={0} selected={selected} onPick={(id) => designer.set({ selected: id })} />
            </div>
          </section>
        )}
        <PluginScreens doc={doc} />
      </aside>

      <main className="ui-main">
        {prefabName && (
          <p className="hint ui-prefab-banner" data-testid="ui-prefab-banner">
            Designing the UI prefab “{prefabName}”: every place that uses it follows.{' '}
            <button data-testid="ui-prefab-back" onClick={() => designer.set({ prefab: null, selected: null })}>
              Back to the screens
            </button>
          </p>
        )}
        <div className="ui-bar row wrap">
          <nav className="ui-modes">
            {(['layout', 'focus', 'flow'] as const).map((m) => (
              <button key={m} data-testid={`ui-mode-${m}`} className={mode === m ? 'on' : ''} onClick={() => designer.set({ mode: m })}>
                {m === 'layout' ? 'Layout' : m === 'focus' ? 'Focus order' : 'Screen flow'}
              </button>
            ))}
          </nav>
          <SelectField<string> testId="ui-resolution" label="Preview as" value={resolution} options={RESOLUTIONS.map((r) => ({ value: r.id, label: r.label }))} onChange={(v) => designer.set({ resolution: v })} />
          <CheckField testId="ui-show-safe" label="Safe area" value={showSafe} onChange={(v) => designer.set({ showSafe: v })} />
          <NumberField testId="ui-safe-percent" label="Keep this much free at the edges (%)" min={0} max={15} step={1} value={Math.round(doc.safeArea * 100)} onCommit={(v) => designer.edit({ ...doc, safeArea: v / 100 })} />
          <button data-testid="ui-undo" disabled={!canUndo} onClick={() => designer.undo()}>
            Undo
          </button>
          <button data-testid="ui-redo" disabled={!canRedo} onClick={() => designer.redo()}>
            Redo
          </button>
          {mode === 'focus' && screen && (
            <button data-testid="ui-autofocus" onClick={() => designer.edit({ ...doc, screens: doc.screens.map((s) => (s.id === screen.id ? { ...s, root: autoFocus(s.root) } : s)) })} title="Draw the arrows between buttons from the way they are laid out">
              Make the arrows for me
            </button>
          )}
        </div>
        {mode === 'flow' ? <FlowMap doc={doc} /> : <DesignCanvas doc={doc} />}
        {mode === 'focus' && <p className="hint">Drag from one button to another to say “pressing that way goes there”. Yellow arrows show the order the keys and a gamepad follow.</p>}
        {names.length > 0 && mode !== 'flow' && (
          <div className="ui-preview-values" data-testid="ui-preview-values">
            <strong>Try values:</strong>
            {names.slice(0, 12).map((n) => (
              <label key={n} className="ui-pv">
                <span>{n}</span>
                <input
                  data-testid={`ui-pv-${n}`}
                  value={String(preview[n] ?? '')}
                  placeholder="0"
                  onChange={(e) => designer.set({ preview: { ...preview, [n]: e.target.value === '' || Number.isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) } })}
                />
              </label>
            ))}
          </div>
        )}
        <details className="ui-problems" open={problems.length > 0}>
          <summary data-testid="ui-problems">{problems.length === 0 ? 'No problems with the screens' : `${problems.length} problem${problems.length === 1 ? '' : 's'} with the screens`}</summary>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </details>
      </main>

      <aside className="ui-right">
        {screen && !selected && !prefabName && <ScreenProps doc={doc} screenId={screen.id} />}
        <UiInspector doc={doc} widgetId={selected} />
        {screen && selected && !prefabName && <ScreenProps doc={doc} screenId={screen.id} />}
      </aside>
      {ghost && (
        <div className="ui-drag-ghost" style={{ left: ghost.x + 8, top: ghost.y + 8 }}>
          {WIDGET_LABELS[ghost.type].split(' (')[0]}
        </div>
      )}
    </div>
  );
}

function patchInstance(root: UiNode, id: string, prefab: string): UiNode {
  const copy = structuredClone(root);
  const w = findWidget(copy, id);
  if (w) {
    w.prefab = prefab;
    w.name = prefab;
  }
  return copy;
}
