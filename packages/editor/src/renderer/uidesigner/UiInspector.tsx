import { useState } from 'react';
import { UI_ANCHOR_NAMES, WIDGET_LABELS, findWidget, parentOf, walkWidgets, type UiAnim, type UiAnchor, type UiDoc, type UiNode, type UiStyle } from '@tilewright/runtime';
import { autoFocus, listSourceChoices } from '@tilewright/behaviors';
import { store } from '../app/store';
import { useStudio } from '../studio/store';
import { ActionListEditor } from '../panels/LogicEditors';
import { CheckField, NumberField, SelectField, TextField } from '../panels/fields';
import { BindButton } from './BindingPicker';
import { clearFocus, duplicateWidget, makePrefab, moveWidget, removeWidget, rootOf, unlinkInstance, updateWidget, wrapInPanel } from './ui-edit';
import { designer } from './state';

const GRID: UiAnchor[][] = [['tl', 't', 'tr'], ['l', 'c', 'r'], ['bl', 'b', 'br']];
const COLOURS = [
  { value: '', label: '(from the theme)' },
  { value: 'var(--tw-panel)', label: 'Panel colour' },
  { value: 'var(--tw-border)', label: 'Border colour' },
  { value: 'var(--tw-accent)', label: 'Accent colour' },
  { value: 'var(--tw-highlight)', label: 'Highlight colour' },
  { value: 'var(--tw-text)', label: 'Text colour' },
  { value: 'transparent', label: 'Transparent' },
];

function StyleEditor({ style, onChange, testPrefix }: { style: UiStyle; onChange(next: UiStyle): void; testPrefix: string }) {
  const set = (patch: Partial<UiStyle>): void => {
    const next: UiStyle = { ...style, ...patch };
    for (const k of Object.keys(next) as (keyof UiStyle)[]) if (next[k] === '' || next[k] === undefined) delete next[k];
    onChange(next);
  };
  const colourField = (key: 'fill' | 'border' | 'color', label: string): React.ReactElement => {
    const v = style[key] ?? '';
    const isHex = /^#[0-9a-fA-F]{6}$/.test(v);
    return (
      <div className="row" key={key}>
        <SelectField<string> testId={`${testPrefix}-${key}-theme`} label={label} value={COLOURS.some((c) => c.value === v) ? v : 'custom'} options={[...COLOURS, ...(COLOURS.some((c) => c.value === v) ? [] : [{ value: 'custom', label: v || '(custom)' }])]} onChange={(x) => x !== 'custom' && set({ [key]: x })} />
        <input type="color" data-testid={`${testPrefix}-${key}`} aria-label={`${label} (pick)`} value={isHex ? v : '#808080'} onChange={(e) => set({ [key]: e.target.value })} />
      </div>
    );
  };
  return (
    <div className="ui-style">
      {colourField('fill', 'Fill')}
      {colourField('border', 'Border')}
      {colourField('color', 'Text / bar colour')}
      <NumberField testId={`${testPrefix}-borderWidth`} label="Border width" min={0} max={20} value={style.borderWidth ?? 0} onCommit={(v) => set({ borderWidth: v })} />
      <NumberField testId={`${testPrefix}-radius`} label="Corner roundness" min={0} max={60} value={style.radius ?? 0} onCommit={(v) => set({ radius: v })} />
      <NumberField testId={`${testPrefix}-fontSize`} label="Text size" min={6} max={120} value={style.fontSize ?? 0} onCommit={(v) => set({ fontSize: v || undefined })} />
      <NumberField testId={`${testPrefix}-opacity`} label="See-through (0 to 1)" min={0} max={1} step={0.1} value={style.opacity ?? 1} onCommit={(v) => set({ opacity: v })} />
      <SelectField<string> testId={`${testPrefix}-align`} label="Text alignment" value={style.align ?? ''} options={[{ value: '', label: '(default)' }, { value: 'left', label: 'left' }, { value: 'center', label: 'centre' }, { value: 'right', label: 'right' }]} onChange={(v) => set({ align: (v || undefined) as UiStyle['align'] })} />
      <CheckField testId={`${testPrefix}-bold`} label="Bold" value={style.bold === true} onChange={(v) => set({ bold: v || undefined })} />
      <CheckField testId={`${testPrefix}-shadow`} label="Drop shadow" value={style.shadow === true} onChange={(v) => set({ shadow: v || undefined })} />
    </div>
  );
}

export function UiInspector({ doc, widgetId }: { doc: UiDoc; widgetId: string | null }) {
  const sprites = useStudio((s) => s.names);
  const [stateTab, setStateTab] = useState<'normal' | 'hover' | 'pressed' | 'disabled' | 'focus'>('normal');
  const root = widgetId ? rootOf(doc, widgetId) : null;
  const w = root && widgetId ? findWidget(root.root, widgetId) : null;
  if (!widgetId || !root || !w) {
    return (
      <div className="ui-inspector" data-testid="ui-inspector">
        <p className="hint">Click a widget in the picture to change it. Drag widgets from the palette onto the picture to add them.</p>
      </div>
    );
  }
  const parent = parentOf(root.root, widgetId);
  const isRoot = parent === null;
  const flow = parent !== null && parent.layout !== 'free';
  const edit = (fn: (n: UiNode) => void): void => designer.edit(updateWidget(doc, widgetId, fn));
  const sets = (key: keyof UiNode) => (v: unknown): void => edit((n) => ((n as unknown as Record<string, unknown>)[key as string] = v));
  const prefabNames = doc.prefabs.map((p) => p.name);
  const tableNames = store.tables.map((t) => t.name);
  const siblings: UiNode[] = [];
  walkWidgets(root.root, (x) => {
    if (x.id !== widgetId) siblings.push(x);
  });
  const container = ['panel', 'list', 'grid', 'tabs', 'hand', 'turnOrder'].includes(w.type);
  const repeater = ['list', 'grid', 'hand', 'turnOrder'].includes(w.type);
  const sourceChoices = [
    { value: '', label: '(choose)' },
    ...tableNames.map((t) => ({ value: `table:${t}`, label: `each row of the table “${t}”` })),
    ...listSourceChoices().map((s) => ({ value: s.value, label: s.label })),
  ];
  if (w.source && !sourceChoices.some((c) => c.value === w.source)) sourceChoices.push({ value: w.source, label: w.source });
  const styleOf = (): UiStyle => (stateTab === 'normal' ? w.style : (w.states[stateTab] ?? {}));
  const setStyle = (s: UiStyle): void => edit((n) => (stateTab === 'normal' ? (n.style = s) : (n.states[stateTab] = s)));
  const setAnim = (i: number, patch: Partial<UiAnim>): void => edit((n) => (n.anim[i] = { ...n.anim[i]!, ...patch }));
  const index = parent ? parent.children.findIndex((c) => c.id === widgetId) : 0;
  const shift = (delta: number): void => {
    if (!parent) return;
    const target = parent.children[index + delta];
    if (!target) return;
    designer.edit(delta < 0 ? moveWidget(doc, widgetId, parent.id, target.id) : moveWidget(doc, widgetId, parent.id, parent.children[index + 2]?.id));
  };
  const intoPrevious = (): void => {
    const prev = parent?.children[index - 1];
    if (prev && ['panel', 'list', 'grid', 'tabs', 'hand', 'turnOrder'].includes(prev.type)) designer.edit(moveWidget(doc, widgetId, prev.id));
  };
  const outOfParent = (): void => {
    const grand = parent ? parentOf(root.root, parent.id) : null;
    if (parent && grand) designer.edit(moveWidget(doc, widgetId, grand.id, grand.children[grand.children.findIndex((c) => c.id === parent.id) + 1]?.id));
  };
  const prefab = w.type === 'instance' ? doc.prefabs.find((p) => p.name === w.prefab) : undefined;
  const overridable: UiNode[] = [];
  if (prefab) walkWidgets(prefab.widget, (x) => (x.type === 'text' || x.type === 'button' || x.type === 'image' || x.type === 'bar' ? overridable.push(x) : undefined));

  return (
    <div className="ui-inspector" data-testid="ui-inspector">
      <h3>{WIDGET_LABELS[w.type].split(' (')[0]}</h3>
      <TextField testId="ui-name" label="Name" value={w.name} onCommit={(v) => v.trim() && edit((n) => (n.name = v.trim()))} />
      {!isRoot && (
        <div className="row wrap">
          <button data-testid="ui-up" onClick={() => shift(-1)} title="Move earlier (in front of / before its neighbour)">↑</button>
          <button data-testid="ui-down" onClick={() => shift(1)} title="Move later">↓</button>
          <button data-testid="ui-into" onClick={intoPrevious} title="Move into the container before it">⇥</button>
          <button data-testid="ui-out" onClick={outOfParent} title="Move out of its container">⇤</button>
          <button data-testid="ui-duplicate" onClick={() => designer.edit(duplicateWidget(doc, widgetId).doc)}>
            Duplicate
          </button>
          <button data-testid="ui-wrap" onClick={() => designer.edit(wrapInPanel(doc, widgetId).doc)} title="Put it in a panel of its own">
            Wrap in a panel
          </button>
          <button
            data-testid="ui-delete"
            onClick={() => {
              designer.edit(removeWidget(doc, widgetId));
              designer.set({ selected: parent?.id ?? null });
            }}
          >
            Delete
          </button>
        </div>
      )}

      <fieldset>
        <legend>Where it is</legend>
        {flow ? (
          <p className="hint">Its container ({parent!.layout}) places it. Change the container's arrangement to move things around.</p>
        ) : (
          !isRoot && (
            <>
              <div className="ui-anchor-grid" role="group" aria-label="Pinned to">
                {GRID.flat().map((a) => (
                  <button key={a} data-testid={`ui-anchor-${a}`} className={w.anchor === a ? 'on' : ''} title={UI_ANCHOR_NAMES[a]} onClick={() => edit((n) => ((n.anchor = a), (n.x = 0), (n.y = 0)))}>
                    ●
                  </button>
                ))}
                <button data-testid="ui-anchor-fill" className={w.anchor === 'fill' ? 'on' : ''} onClick={() => edit((n) => (n.anchor = 'fill'))} title={UI_ANCHOR_NAMES.fill}>
                  fill
                </button>
              </div>
              <p className="hint">Pinned to: {UI_ANCHOR_NAMES[w.anchor]}</p>
              <div className="row">
                <NumberField testId="ui-x" label="Across" value={w.x} onCommit={sets('x')} />
                <NumberField testId="ui-y" label="Down" value={w.y} onCommit={sets('y')} />
              </div>
            </>
          )
        )}
        <div className="row">
          <SelectField<string> testId="ui-wmode" label="Width" value={w.wMode} options={[{ value: 'fixed', label: 'pixels' }, { value: 'auto', label: 'fit the contents' }, { value: 'fill', label: 'fill the room' }]} onChange={sets('wMode')} />
          {w.wMode === 'fixed' && <NumberField testId="ui-w" label="" min={1} value={w.w} onCommit={sets('w')} />}
        </div>
        <div className="row">
          <SelectField<string> testId="ui-hmode" label="Height" value={w.hMode} options={[{ value: 'fixed', label: 'pixels' }, { value: 'auto', label: 'fit the contents' }, { value: 'fill', label: 'fill the room' }]} onChange={sets('hMode')} />
          {w.hMode === 'fixed' && <NumberField testId="ui-h" label="" min={1} value={w.h} onCommit={sets('h')} />}
        </div>
        {container && (
          <>
            <SelectField<string> testId="ui-layout" label="Arrange what is inside" value={w.layout} options={[{ value: 'free', label: 'free (each pinned where you put it)' }, { value: 'row', label: 'in a row' }, { value: 'column', label: 'in a column' }, { value: 'grid', label: 'in a grid' }]} onChange={sets('layout')} />
            {w.layout !== 'free' && (
              <>
                <NumberField testId="ui-gap" label="Space between" min={0} value={w.gap} onCommit={sets('gap')} />
                <NumberField testId="ui-padding" label="Space inside the edge" min={0} value={w.padding} onCommit={sets('padding')} />
                <SelectField<string> testId="ui-align" label="Line them up" value={w.align} options={[{ value: 'start', label: 'at the start' }, { value: 'center', label: 'in the middle' }, { value: 'end', label: 'at the end' }, { value: 'stretch', label: 'stretched' }]} onChange={sets('align')} />
              </>
            )}
            {w.layout === 'grid' && <NumberField testId="ui-columns" label="Columns" min={1} max={30} value={w.columns} onCommit={sets('columns')} />}
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>What it shows</legend>
        {['text', 'button', 'toggle', 'keybind'].includes(w.type) && (
          <div className="row">
            <TextField testId="ui-text" label={w.type === 'keybind' ? 'Control (action name)' : 'Words'} value={w.text} onCommit={sets('text')} />
            {w.type !== 'keybind' && <BindButton doc={doc} widgetId={widgetId} wrap testId="ui-bind-text" onPick={(t) => edit((n) => (n.text = `${n.text}${n.text && !n.text.endsWith(' ') ? ' ' : ''}${t}`))} />}
          </div>
        )}
        {w.type === 'image' && <SelectField<string> testId="ui-sprite" label="Sprite" value={w.sprite} options={[{ value: '', label: '(none)' }, ...sprites.map((s) => ({ value: s, label: s }))]} onChange={sets('sprite')} />}
        {['bar', 'slider', 'toggle', 'dropdown'].includes(w.type) && (
          <div className="row">
            <TextField testId="ui-value" label={w.type === 'bar' ? 'Fills with' : 'Reads and sets'} value={w.value} onCommit={sets('value')} placeholder="a variable or settings.music" />
            <BindButton doc={doc} widgetId={widgetId} wrap={false} testId="ui-bind-value" onPick={sets('value')} />
          </div>
        )}
        {['bar', 'slider'].includes(w.type) && (
          <>
            <div className="row">
              <TextField testId="ui-max" label="Full at" value={w.max} onCommit={sets('max')} placeholder="100 or {Stats.hero.maxhp}" />
              <BindButton doc={doc} widgetId={widgetId} wrap testId="ui-bind-max" onPick={sets('max')} />
            </div>
            {w.type === 'slider' && (
              <div className="row">
                <NumberField testId="ui-min" label="Lowest" value={w.min} onCommit={sets('min')} />
                <NumberField testId="ui-step" label="Step" min={0.001} step={0.05} value={w.step} onCommit={sets('step')} />
              </div>
            )}
          </>
        )}
        {['dropdown', 'tabs'].includes(w.type) && <TextField testId="ui-options" label={w.type === 'tabs' ? 'Tab names (commas)' : 'Choices (commas)'} value={w.options} onCommit={sets('options')} />}
        {repeater && (
          <>
            <SelectField<string> testId="ui-source" label="Repeats for" value={w.source} options={sourceChoices} onChange={sets('source')} />
            <SelectField<string> testId="ui-template" label="Each one looks like" value={w.template} options={[{ value: '', label: w.children.length ? '(the first widget inside)' : '(put a widget inside, or pick a UI prefab)' }, ...prefabNames.map((p) => ({ value: p, label: `UI prefab “${p}”` }))]} onChange={sets('template')} />
            {w.type === 'grid' && <CheckField testId="ui-drag" label="Allow dragging a cell onto another (they swap places)" value={w.drag} onChange={sets('drag')} />}
          </>
        )}
        {w.type === 'minimap' && <TextField testId="ui-marks" label="Dots (tag:colour, ...)" value={w.marks} onCommit={sets('marks')} />}
        {w.type === 'instance' && (
          <>
            <SelectField<string> testId="ui-prefab" label="UI prefab" value={w.prefab} options={prefabNames.map((p) => ({ value: p, label: p }))} onChange={sets('prefab')} />
            {overridable.map((o) => (
              <TextField
                key={o.id}
                testId={`ui-override-${o.name}`}
                label={`${o.name}: words`}
                value={String((w.overrides[o.name]?.text as string | undefined) ?? o.text)}
                onCommit={(v) => edit((n) => (n.overrides[o.name] = { ...n.overrides[o.name], text: v }))}
              />
            ))}
            <button data-testid="ui-unlink" onClick={() => designer.edit(unlinkInstance(doc, widgetId))}>
              Unlink (make it plain widgets)
            </button>
          </>
        )}
        <div className="row">
          <TextField testId="ui-visible" label="Shown only when" value={w.visible} onCommit={sets('visible')} placeholder="{gold} >= 10" />
        </div>
        <div className="row">
          <TextField testId="ui-enabled" label="Can be used only when" value={w.enabled} onCommit={sets('enabled')} placeholder="{gold} >= {Shop.sword.cost}" />
        </div>
        <div className="row">
          <TextField testId="ui-tooltip" label="Tooltip" value={w.tooltip} onCommit={sets('tooltip')} />
          <BindButton doc={doc} widgetId={widgetId} wrap testId="ui-bind-tooltip" onPick={(t) => edit((n) => (n.tooltip = `${n.tooltip} ${t}`.trim()))} />
        </div>
        <BindButton doc={doc} widgetId={widgetId} wrap={false} label="Insert a condition from the list…" testId="ui-bind-visible" onPick={(t) => edit((n) => (n.visible = n.visible ? `${n.visible} && {${t}}` : `{${t}}`))} />
      </fieldset>

      <fieldset>
        <legend>How it looks</legend>
        <div className="ui-state-tabs" role="tablist">
          {(['normal', 'hover', 'pressed', 'disabled', 'focus'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={stateTab === s} className={stateTab === s ? 'on' : ''} data-testid={`ui-state-${s}`} onClick={() => setStateTab(s)}>
              {s === 'normal' ? 'Normal' : s === 'hover' ? 'Mouse over' : s === 'pressed' ? 'Pressed' : s === 'disabled' ? 'Disabled' : 'Selected by keys'}
            </button>
          ))}
        </div>
        <StyleEditor style={styleOf()} onChange={setStyle} testPrefix={`ui-st-${stateTab}`} />
        <h4>Movement</h4>
        {w.anim.map((a, i) => (
          <div className="row wrap" key={i} data-testid={`ui-anim-${i}`}>
            <SelectField<string> label="When" value={a.on} options={[{ value: 'show', label: 'it appears' }, { value: 'hide', label: 'it goes' }, { value: 'hover', label: 'the mouse is over it' }, { value: 'click', label: 'it is clicked' }]} onChange={(v) => setAnim(i, { on: v as UiAnim['on'] })} />
            <SelectField<string> label="Do" value={a.kind} options={[{ value: 'fade', label: 'fade' }, { value: 'slide', label: 'slide' }, { value: 'pop', label: 'pop' }, { value: 'pulse', label: 'pulse' }]} onChange={(v) => setAnim(i, { kind: v as UiAnim['kind'] })} />
            {a.kind === 'slide' && <SelectField<string> label="From" value={a.dir} options={[{ value: 'left', label: 'left' }, { value: 'right', label: 'right' }, { value: 'up', label: 'above' }, { value: 'down', label: 'below' }]} onChange={(v) => setAnim(i, { dir: v as UiAnim['dir'] })} />}
            <NumberField label="Milliseconds" min={50} max={3000} step={50} value={a.ms} onCommit={(v) => setAnim(i, { ms: v })} />
            <button aria-label="Remove movement" onClick={() => edit((n) => void n.anim.splice(i, 1))}>
              ✕
            </button>
          </div>
        ))}
        <button data-testid="ui-add-anim" onClick={() => edit((n) => void n.anim.push({ on: 'show', kind: 'fade', ms: 200, dir: 'up' }))}>
          + Movement
        </button>
      </fieldset>

      <fieldset>
        <legend>What happens</legend>
        <h4>When it is clicked (or pressed with the keys)</h4>
        <ActionListEditor testId="ui-on-click" actions={w.on.click as never} onChange={(next) => edit((n) => (n.on.click = next as never))} />
        {['slider', 'toggle', 'dropdown', 'tabs'].includes(w.type) && (
          <>
            <h4>When its value changes</h4>
            <ActionListEditor testId="ui-on-change" actions={w.on.change as never} onChange={(next) => edit((n) => (n.on.change = next as never))} />
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Moving between buttons with keys and gamepad</legend>
        {(['up', 'down', 'left', 'right'] as const).map((d) => (
          <SelectField<string> key={d} testId={`ui-focus-${d}`} label={`Pressing ${d} goes to`} value={w.focus[d]} options={[{ value: '', label: '(nearest one)' }, ...siblings.map((s) => ({ value: s.id, label: s.name }))]} onChange={(v) => edit((n) => (n.focus[d] = v))} />
        ))}
        <div className="row">
          <button data-testid="ui-focus-clear" onClick={() => designer.edit(clearFocus(doc, widgetId))}>
            Clear
          </button>
        </div>
      </fieldset>

      {!isRoot && w.type !== 'instance' && root.kind === 'screen' && (
        <fieldset>
          <legend>Reuse</legend>
          <MakePrefab doc={doc} widgetId={widgetId} name={w.name} />
        </fieldset>
      )}
      <button
        className="small"
        data-testid="ui-autofocus-screen"
        title="Fill in the arrows between every button of this screen from the way they are laid out"
        onClick={() => {
          const sc = doc.screens.find((s) => findWidget(s.root, widgetId));
          if (sc) designer.edit({ ...doc, screens: doc.screens.map((s) => (s.id === sc.id ? { ...s, root: autoFocus(s.root) } : s)) });
        }}
      >
        Arrange the arrows for this whole screen
      </button>
    </div>
  );
}

function MakePrefab({ doc, widgetId, name }: { doc: UiDoc; widgetId: string; name: string }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  return (
    <div>
      <div className="row">
        <input data-testid="ui-prefab-name" aria-label="UI prefab name" placeholder={`Name (like ${name.replace(/[^A-Za-z0-9 _-]/g, '')})`} value={text} onChange={(e) => setText(e.target.value)} />
        <button
          data-testid="ui-prefab-make"
          onClick={() => {
            const r = makePrefab(doc, widgetId, text.trim());
            if (r.problem) setProblem(r.problem);
            else {
              setProblem('');
              setText('');
              designer.edit(r.doc);
              designer.set({ selected: r.id });
            }
          }}
        >
          Make a UI prefab
        </button>
      </div>
      {problem && <p className="hint warn">{problem}</p>}
      <p className="hint">A UI prefab is a piece you make once and use many times (an inventory slot, a card). Change it once and every use follows.</p>
    </div>
  );
}
