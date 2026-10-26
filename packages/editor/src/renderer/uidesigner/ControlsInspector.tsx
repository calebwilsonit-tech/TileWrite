import { useState } from 'react';
import { host } from '@tilewright/behaviors';
import { UI_STYLES } from '@tilewright/behaviors';
import {
  FieldControlSchema,
  MAP_BLENDS,
  MAP_LAYER_FIELDS,
  MAP_LAYER_KINDS,
  MAP_PROJECTIONS,
  MAP_SOURCES,
  MARKER_FROM,
  MapSpecSchema,
  MarkerKindSchema,
  PopupSchema,
  SCROLL_FOLLOW,
  ScrollBarSchema,
  ScrollerSchema,
  SliderSchema,
  defaultMapLayer,
  type FieldDef,
  type MapLayer,
  type MapSpec,
  type MarkerKind,
  type UiDoc,
  type UiNode,
} from '@tilewright/runtime';
import { store, useApp } from '../app/store';
import { useStudio } from '../studio/store';
import { ActionListEditor } from '../panels/LogicEditors';
import { CheckField, NumberField, SelectField, TextField } from '../panels/fields';
import { applyControlStyle, setPart } from './ui-edit';
import { designer, useDesigner } from './state';

/**
 * The inspector's sections for the controls the engine draws: scrolling, sliders, pop-up lists, the other form controls, and the map.
 * Every part is a choice of UI prefab; every rule is a setting; every setting is a field the designer can read, so a plugin's own kind
 * of layer or source gets the same fields with no code here.
 */

type Edit = (fn: (n: UiNode) => void) => void;
interface Props {
  doc: UiDoc;
  w: UiNode;
  edit: Edit;
}

// ---------- the project's flags ----------

export function FlagNote({ w }: { w: UiNode }) {
  const compat = useApp((s) => s.project?.project.compat) ?? {};
  const needs: ('uiScroll' | 'uiControls')[] = [];
  if ((w.scroller || w.style.scroll) && compat.uiScroll !== true) needs.push('uiScroll');
  if (['slider', 'dropdown', 'toggle', 'tabs', 'keybind'].includes(w.type) && compat.uiControls !== true) needs.push('uiControls');
  if (needs.length === 0) return null;
  return (
    <div className="hint warn" data-testid="ui-flag-note">
      <p>
        This project plays {needs.includes('uiScroll') ? 'scrolling' : 'sliders, choice lists and tick boxes'} the older way (the browser draws it), so the settings below show in the picture and not in the game. The older look stays until you switch the newer one on.
      </p>
      <button
        data-testid="ui-flag-on"
        onClick={() => {
          const next = { ...compat };
          for (const n of needs) next[n] = true;
          store.updateProjectSettings({ compat: next });
        }}
      >
        Switch it on for this project
      </button>
    </div>
  );
}

// ---------- parts ----------

interface RoleInfo {
  role: string;
  label: string;
  optional?: boolean;
}

function PartPicker({ doc, info, value, suits, onChange, testId }: { doc: UiDoc; info: RoleInfo; value: string | undefined; suits: string; onChange(next: string | undefined): void; testId: string }) {
  const pluginParts = [...host.ext.uiParts.values()].filter((p) => p.suits.includes(suits) || p.suits.includes('any'));
  const options: { value: string; label: string }[] = [];
  if (info.optional) options.push({ value: '__none', label: '(not used)' });
  options.push({ value: '', label: '(the built-in one)' });
  for (const p of doc.prefabs) options.push({ value: p.name, label: `UI prefab “${p.name}”` });
  for (const p of pluginParts) if (!doc.prefabs.some((x) => x.name === p.name)) options.push({ value: p.name, label: `From a plugin: ${p.label}` });
  if (value && !options.some((o) => o.value === value)) options.push({ value, label: `“${value}” (missing)` });
  return <SelectField<string> testId={testId} label={info.label} value={value === undefined ? (info.optional ? '__none' : '') : value} options={options} onChange={(v) => onChange(v === '__none' ? undefined : v)} />;
}

function PartsEditor({ doc, w, roles, where, parts, suits, prefix }: { doc: UiDoc; w: UiNode; roles: RoleInfo[]; where: 'slider' | 'popup' | 'field' | 'widget' | 'bar'; parts: Record<string, string> | undefined; suits: string; prefix: string }) {
  const [style, setStyle] = useState('');
  const known = new Set(roles.map((r) => r.role));
  const extras = Object.keys(parts ?? {}).filter((k) => !known.has(k));
  const [extraName, setExtraName] = useState('');
  return (
    <div className="ui-parts" data-testid={`${prefix}-parts`}>
      <h4>Parts (each is an ordinary UI prefab you can replace)</h4>
      {roles.map((r) => (
        <PartPicker key={r.role} doc={doc} info={r} value={parts?.[r.role]} suits={suits} testId={`${prefix}-part-${r.role}`} onChange={(v) => designer.edit(setPart(doc, w.id, where, r.role, v))} />
      ))}
      {where === 'field' || where === 'slider' ? (
        <>
          {extras.map((k) => (
            <PartPicker key={k} doc={doc} info={{ role: k, label: `Extra part “${k}”`, optional: true }} value={parts?.[k]} suits="any" testId={`${prefix}-part-${k}`} onChange={(v) => designer.edit(setPart(doc, w.id, where, k, v))} />
          ))}
          <div className="row">
            <TextField testId={`${prefix}-extra-name`} label="Add an extra part (a name)" value={extraName} onCommit={(v) => setExtraName(v)} />
            <button
              data-testid={`${prefix}-extra-add`}
              disabled={!/^[a-z][A-Za-z0-9]*$/.test(extraName) || known.has(extraName)}
              onClick={() => {
                designer.edit(setPart(doc, w.id, where, extraName, ''));
                setExtraName('');
              }}
            >
              + Part
            </button>
          </div>
        </>
      ) : null}
      <div className="row wrap">
        <SelectField<string> testId={`${prefix}-style`} label="Start from a style" value={style} options={[{ value: '', label: '(choose)' }, ...UI_STYLES.map((s) => ({ value: s.id, label: `${s.label}: ${s.description}` }))]} onChange={setStyle} />
        <button data-testid={`${prefix}-style-apply`} disabled={style === ''} onClick={() => designer.edit(applyControlStyle(doc, w.id, style))}>
          Use this style
        </button>
      </div>
      <p className="hint">A style only copies some UI prefabs into the project and names them in the parts above. Change or replace any of them afterwards.</p>
      <PreviewStates w={w} />
    </div>
  );
}

/** See a state the widget only has for a moment, in the picture (and a pop-up list open). */
export function PreviewStates({ w }: { w: UiNode }) {
  const state = useDesigner((s) => s.previewState);
  const open = useDesigner((s) => s.previewOpen);
  return (
    <div className="ui-preview-states" role="group" aria-label="Show it as">
      <span>Show it in the picture as:</span>
      {(['normal', 'hover', 'pressed', 'focus', 'disabled'] as const).map((s) => (
        <button key={s} data-testid={`ui-preview-${s}`} className={state === s ? 'on' : ''} onClick={() => designer.set({ previewState: s })}>
          {s === 'normal' ? 'Normal' : s === 'hover' ? 'Mouse over' : s === 'pressed' ? 'Pressed' : s === 'focus' ? 'Selected by keys' : 'Disabled'}
        </button>
      ))}
      {w.type === 'dropdown' && (
        <button data-testid="ui-preview-open" className={open ? 'on' : ''} onClick={() => designer.set({ previewOpen: !open })}>
          Open
        </button>
      )}
    </div>
  );
}

const SLIDER_ROLES: RoleInfo[] = [
  { role: 'track', label: 'Track' },
  { role: 'fill', label: 'Filled part' },
  { role: 'thumb', label: 'Thumb' },
  { role: 'thumb2', label: 'Second thumb (a range)', optional: true },
  { role: 'tick', label: 'Tick mark', optional: true },
  { role: 'value', label: 'The value as words', optional: true },
];
const BAR_ROLES: RoleInfo[] = [
  { role: 'track', label: 'Track' },
  { role: 'thumb', label: 'Thumb' },
  { role: 'arrowStart', label: 'Arrow at the start', optional: true },
  { role: 'arrowEnd', label: 'Arrow at the end', optional: true },
  { role: 'page', label: 'Mark for every page', optional: true },
];
const POPUP_ROLES: RoleInfo[] = [
  { role: 'box', label: 'The closed box' },
  { role: 'list', label: 'The list' },
  { role: 'option', label: 'Each option' },
  { role: 'group', label: 'A group heading' },
  { role: 'search', label: 'The search box' },
  { role: 'empty', label: 'When nothing matches' },
];

// ---------- sliders ----------

export function SliderSection({ doc, w, edit }: Props) {
  const s = w.slider ?? SliderSchema.parse({});
  const set = (fn: (x: typeof s) => void): void =>
    edit((n) => {
      const x = n.slider ?? SliderSchema.parse({});
      fn(x);
      n.slider = x;
    });
  const range = s.value2 !== '';
  return (
    <fieldset data-testid="ui-slider-section">
      <legend>Slider</legend>
      <FlagNote w={w} />
      <div className="row">
        <SelectField<string> testId="ui-slider-direction" label="Direction" value={s.angle === 0 ? 'h' : s.angle === -90 ? 'v' : s.angle === 90 ? 'vd' : 'custom'} options={[{ value: 'h', label: 'left to right' }, { value: 'v', label: 'bottom to top (vertical)' }, { value: 'vd', label: 'top to bottom' }, { value: 'custom', label: 'any angle' }]} onChange={(v) => set((x) => (x.angle = v === 'h' ? 0 : v === 'v' ? -90 : v === 'vd' ? 90 : x.angle === 0 ? 30 : x.angle))} />
        {!['h', 'v', 'vd'].includes(s.angle === 0 ? 'h' : s.angle === -90 ? 'v' : s.angle === 90 ? 'vd' : 'custom') && <NumberField testId="ui-slider-angle" label="Angle (degrees)" min={-360} max={360} value={s.angle} onCommit={(v) => set((x) => (x.angle = v))} />}
      </div>
      <CheckField testId="ui-slider-range" label="Two thumbs (a range: the second one reads and sets another value)" value={range} onChange={(v) => set((x) => (x.value2 = v ? 'range_high' : ''))} />
      {range && <TextField testId="ui-slider-value2" label="Second thumb reads and sets" value={s.value2} onCommit={(v) => set((x) => (x.value2 = v))} />}
      <SelectField<string> testId="ui-slider-curve" label="Value along the track" value={s.curve} options={[{ value: 'linear', label: 'even steps' }, { value: 'log', label: 'logarithmic (fine at the low end)' }, { value: 'table', label: 'my own curve (a table of points)' }]} onChange={(v) => set((x) => (x.curve = v as typeof s.curve))} />
      {s.curve === 'table' && <TextField testId="ui-slider-curve-table" label="Curve: position:value pairs from 0 to 1" value={s.curveTable} placeholder="0:0, 0.5:0.1, 1:1" onCommit={(v) => set((x) => (x.curveTable = v))} />}
      <TextField testId="ui-slider-snap" label="Places it sticks to (numbers; blank: the steps)" value={s.snapPoints} placeholder="0, 25, 50, 100" onCommit={(v) => set((x) => (x.snapPoints = v))} />
      <div className="row">
        <TextField testId="ui-slider-format" label="Value shown as" value={s.format} placeholder="{value}%" onCommit={(v) => set((x) => (x.format = v))} />
        <NumberField testId="ui-slider-decimals" label="Decimals" min={0} max={6} value={s.decimals} onCommit={(v) => set((x) => (x.decimals = v))} />
      </div>
      <NumberField testId="ui-slider-bigstep" label="A big step (0: ten steps)" min={0} step={0.5} value={s.bigStep} onCommit={(v) => set((x) => (x.bigStep = v))} />
      <SelectField<string> testId="ui-slider-ticks" label="Marks along the track" value={s.ticks} options={[{ value: 'none', label: 'none' }, { value: 'steps', label: 'at every step' }, { value: 'points', label: 'at the places it sticks to' }]} onChange={(v) => set((x) => (x.ticks = v as typeof s.ticks))} />
      <CheckField testId="ui-slider-wheel" label="The mouse wheel steps it" value={s.wheel} onChange={(v) => set((x) => (x.wheel = v))} />
      <details>
        <summary>Buttons that move it (names of the project’s controls)</summary>
        {(['less', 'more', 'bigLess', 'bigMore'] as const).map((k) => (
          <TextField key={k} testId={`ui-slider-action-${k}`} label={k === 'less' ? 'Smaller' : k === 'more' ? 'Bigger' : k === 'bigLess' ? 'A lot smaller' : 'A lot bigger'} value={s.actions[k]} onCommit={(v) => set((x) => (x.actions[k] = v))} />
        ))}
        <div className="row">
          <NumberField testId="ui-slider-hold-delay" label="Held: wait (seconds)" min={0} step={0.1} value={s.holdDelay} onCommit={(v) => set((x) => (x.holdDelay = v))} />
          <NumberField testId="ui-slider-hold-rate" label="then steps a second" min={1} value={s.holdRate} onCommit={(v) => set((x) => (x.holdRate = v))} />
          <NumberField testId="ui-slider-hold-accel" label="faster by" min={1} step={0.5} value={s.holdAccel} onCommit={(v) => set((x) => (x.holdAccel = v))} />
        </div>
      </details>
      <PartsEditor doc={doc} w={w} roles={SLIDER_ROLES} where="slider" parts={s.parts} suits="slider" prefix="ui-slider" />
      <h4>While it is being moved</h4>
      <ActionListEditor testId="ui-on-changing" actions={(w.on.changing ?? []) as never} onChange={(next) => edit((n) => (n.on.changing = next as never))} />
    </fieldset>
  );
}

// ---------- pop-up lists ----------

export function PopupSection({ doc, w, edit }: Props) {
  const p = w.popup ?? PopupSchema.parse({});
  const set = (fn: (x: typeof p) => void): void =>
    edit((n) => {
      const x = n.popup ?? PopupSchema.parse({});
      fn(x);
      n.popup = x;
    });
  const screens = doc.screens.map((s) => s.name);
  return (
    <fieldset data-testid="ui-popup-section">
      <legend>Pop-up list</legend>
      <FlagNote w={w} />
      <SelectField<string> testId="ui-popup-place" label="The list opens" value={p.place} options={[{ value: 'below', label: 'below the box' }, { value: 'above', label: 'above the box' }, { value: 'beside', label: 'beside the box' }, { value: 'centred', label: 'in the middle of the screen' }, { value: 'screen', label: 'as a screen of its own' }]} onChange={(v) => set((x) => (x.place = v as typeof p.place))} />
      {p.place === 'screen' && <SelectField<string> testId="ui-popup-screen" label="The screen" value={p.screen} options={[{ value: '', label: '(choose)' }, ...screens.map((s) => ({ value: s, label: s }))]} onChange={(v) => set((x) => (x.screen = v))} />}
      <div className="row wrap">
        <CheckField testId="ui-popup-multi" label="Choose many" value={p.multi} onChange={(v) => set((x) => (x.multi = v))} />
        <CheckField testId="ui-popup-search" label="Type to search" value={p.search} onChange={(v) => set((x) => (x.search = v))} />
        <CheckField testId="ui-popup-step" label="Left and right on the closed box step through the options" value={p.stepClosed} onChange={(v) => set((x) => (x.stepClosed = v))} />
      </div>
      <p className="hint">The options are the choices above, or the rows of a source (set “Repeats for” where the choices are). For rows, say what each option is:</p>
      <div className="row wrap">
        <TextField testId="ui-popup-value" label="Its value" value={p.value} placeholder="{row.id}" onCommit={(v) => set((x) => (x.value = v))} />
        <TextField testId="ui-popup-label" label="Its words" value={p.label} placeholder="{row.name}" onCommit={(v) => set((x) => (x.label = v))} />
        <TextField testId="ui-popup-detail" label="A description" value={p.detail} placeholder="{row.about}" onCommit={(v) => set((x) => (x.detail = v))} />
        <TextField testId="ui-popup-group" label="A group heading" value={p.group} placeholder="{row.kind}" onCommit={(v) => set((x) => (x.group = v))} />
        <TextField testId="ui-popup-icon" label="A picture" value={p.icon} placeholder="{row.sprite}" onCommit={(v) => set((x) => (x.icon = v))} />
      </div>
      <TextField testId="ui-popup-filter" label="Show an option only when" value={p.filter} placeholder="{option.value} != secret" onCommit={(v) => set((x) => (x.filter = v))} />
      <div className="row wrap">
        <TextField testId="ui-popup-open" label="Button that opens it" value={p.open} onCommit={(v) => set((x) => (x.open = v))} />
        <NumberField testId="ui-popup-rows" label="Rows before it scrolls" min={1} max={50} value={p.maxRows} onCommit={(v) => set((x) => (x.maxRows = v))} />
        <SelectField<string> testId="ui-popup-width" label="Width" value={p.width} options={[{ value: 'box', label: 'as wide as the box' }, { value: 'fit', label: 'fits the words' }]} onChange={(v) => set((x) => (x.width = v as typeof p.width))} />
      </div>
      <div className="row wrap">
        <TextField testId="ui-popup-many" label="Box says, when many are chosen" value={p.manyText} onCommit={(v) => set((x) => (x.manyText = v))} />
        <TextField testId="ui-popup-none" label="Box says, when nothing is" value={p.none} onCommit={(v) => set((x) => (x.none = v))} />
        <SelectField<string> testId="ui-popup-anim" label="Opening" value={p.animOpen} options={[{ value: 'none', label: 'at once' }, { value: 'fade', label: 'fades in' }, { value: 'slide', label: 'slides in' }, { value: 'pop', label: 'pops' }]} onChange={(v) => set((x) => (x.animOpen = v as typeof p.animOpen))} />
      </div>
      <PartsEditor doc={doc} w={w} roles={POPUP_ROLES} where="popup" parts={p.parts} suits="popup" prefix="ui-popup" />
    </fieldset>
  );
}

// ---------- the other form controls ----------

export function FieldSection({ doc, w, edit }: Props) {
  const f = w.field ?? FieldControlSchema.parse({});
  const number = w.type === 'numberfield';
  const set = (fn: (x: typeof f) => void): void =>
    edit((n) => {
      const x = n.field ?? FieldControlSchema.parse({});
      fn(x);
      n.field = x;
    });
  return (
    <fieldset data-testid="ui-field-section">
      <legend>{number ? 'Number field' : 'Text field'}</legend>
      <TextField testId="ui-field-placeholder" label="Hint when empty" value={f.placeholder} onCommit={(v) => set((x) => (x.placeholder = v))} />
      {number ? (
        <div className="row wrap">
          <NumberField testId="ui-field-min" label="Lowest" value={f.min} onCommit={(v) => set((x) => (x.min = v))} />
          <NumberField testId="ui-field-max" label="Highest" value={f.max} onCommit={(v) => set((x) => (x.max = v))} />
          <NumberField testId="ui-field-step" label="One step" min={0.001} step={0.5} value={f.step} onCommit={(v) => set((x) => (x.step = v))} />
        </div>
      ) : (
        <div className="row wrap">
          <NumberField testId="ui-field-maxlength" label="Longest" min={1} max={500} value={f.maxLength} onCommit={(v) => set((x) => (x.maxLength = v))} />
          <SelectField<string> testId="ui-field-allow" label="Allowed" value={f.allow} options={[{ value: 'any', label: 'any letters' }, { value: 'letters', label: 'letters and spaces' }, { value: 'name', label: 'letters, numbers, spaces, - and _' }, { value: 'digits', label: 'digits only' }]} onChange={(v) => set((x) => (x.allow = v as typeof f.allow))} />
          <CheckField testId="ui-field-secret" label="Show dots" value={f.secret} onChange={(v) => set((x) => (x.secret = v))} />
        </div>
      )}
      <h4>When the player finishes (Enter)</h4>
      <ActionListEditor testId="ui-field-commit" actions={f.commit as never} onChange={(next) => set((x) => (x.commit = next as never))} />
      <PartsEditor doc={doc} w={w} roles={number ? [{ role: 'box', label: 'The box' }, { role: 'up', label: 'Up arrow', optional: true }, { role: 'down', label: 'Down arrow', optional: true }] : [{ role: 'box', label: 'The box' }]} where="field" parts={f.parts} suits="field" prefix="ui-field" />
    </fieldset>
  );
}

export function SimplePartsSection({ doc, w }: Props) {
  const roles: RoleInfo[] = w.type === 'toggle' ? [{ role: 'box', label: 'The box' }, { role: 'label', label: 'The words' }] : w.type === 'keybind' ? [{ role: 'name', label: 'The name of the control' }, { role: 'key', label: 'The key or button' }] : [{ role: 'tab', label: 'Each tab' }];
  return (
    <fieldset data-testid="ui-simple-parts">
      <legend>{w.type === 'toggle' ? 'Tick box' : w.type === 'keybind' ? 'Key binding' : 'Tabs'}</legend>
      <FlagNote w={w} />
      <PartsEditor doc={doc} w={w} roles={roles} where="widget" parts={w.parts} suits={w.type} prefix="ui-parts" />
    </fieldset>
  );
}

// ---------- scrolling ----------

export function ScrollingSection({ doc, w, edit }: Props) {
  const on = w.scroller !== undefined || w.style.scroll === true;
  const s = w.scroller ?? ScrollerSchema.parse({});
  const set = (fn: (x: typeof s) => void): void =>
    edit((n) => {
      const x = n.scroller ?? ScrollerSchema.parse({});
      fn(x);
      n.scroller = x;
    });
  const bar = s.bar;
  const setBar = (fn: (b: NonNullable<typeof bar>) => void): void =>
    set((x) => {
      const b = x.bar ?? ScrollBarSchema.parse({});
      fn(b);
      x.bar = b;
    });
  return (
    <fieldset data-testid="ui-scroll-section">
      <legend>Scrolling</legend>
      <CheckField
        testId="ui-scroll-on"
        label="Scrolls when what is inside does not fit (the engine scrolls it: wheel, buttons, dragging, touch; never a browser scrollbar)"
        value={on}
        onChange={(v) =>
          edit((n) => {
            if (v) {
              n.scroller ??= ScrollerSchema.parse({});
              n.style = { ...n.style };
              delete n.style.scroll;
            } else {
              delete n.scroller;
              delete n.style.scroll;
            }
          })
        }
      />
      {on && <FlagNote w={w} />}
      {on && (
        <>
          <div className="row wrap">
            <SelectField<string> testId="ui-scroll-dir" label="Direction" value={s.dir} options={[{ value: 'vertical', label: 'up and down' }, { value: 'horizontal', label: 'left and right' }, { value: 'both', label: 'both ways' }]} onChange={(v) => set((x) => (x.dir = v as typeof s.dir))} />
            <SelectField<string> testId="ui-scroll-snap" label="Sticks to" value={s.snap} options={[{ value: 'none', label: 'nothing' }, { value: 'rows', label: 'rows' }, { value: 'pages', label: 'pages' }, { value: 'grid', label: 'a grid' }]} onChange={(v) => set((x) => (x.snap = v as typeof s.snap))} />
            {s.snap === 'grid' && <NumberField testId="ui-scroll-snapsize" label="Grid cell (pixels)" min={1} value={s.snapSize} onCommit={(v) => set((x) => (x.snapSize = v))} />}
          </div>
          <div className="row wrap">
            <SelectField<string> testId="ui-scroll-edges" label="At the ends" value={s.edges} options={[{ value: 'stop', label: 'it stops' }, { value: 'elastic', label: 'it stretches and springs back' }]} onChange={(v) => set((x) => (x.edges = v as typeof s.edges))} />
            <SelectField<string> testId="ui-scroll-motion" label="Moving" value={s.motion} options={[{ value: 'smooth', label: 'eases (at once under Reduce motion)' }, { value: 'instant', label: 'at once' }]} onChange={(v) => set((x) => (x.motion = v as typeof s.motion))} />
            <CheckField testId="ui-scroll-momentum" label="Carries on after a drag" value={s.momentum} onChange={(v) => set((x) => (x.momentum = v))} />
            <NumberField testId="ui-scroll-speed" label="Speed (1 = normal)" min={0.1} step={0.1} value={s.speed} onCommit={(v) => set((x) => (x.speed = v))} />
          </div>
          <div className="row wrap">
            <SelectField<string> testId="ui-scroll-follow" label="When the focus moves inside" value={s.follow} options={SCROLL_FOLLOW.map((f) => ({ value: f, label: f === 'nearest' ? 'bring it into view, the least it takes' : f === 'center' ? 'keep it in the middle' : f === 'margin' ? 'keep rows of room around it' : f === 'page' ? 'go page by page' : 'do not move' }))} onChange={(v) => set((x) => (x.follow = v as typeof s.follow))} />
            {s.follow === 'margin' && <NumberField testId="ui-scroll-margin" label="Rows of room" min={0} max={20} value={s.margin} onCommit={(v) => set((x) => (x.margin = v))} />}
          </div>
          <div className="row wrap">
            <NumberField testId="ui-scroll-padstart" label="Room before the first row" min={0} value={s.padStart} onCommit={(v) => set((x) => (x.padStart = v))} />
            <NumberField testId="ui-scroll-padend" label="Room after the last" min={0} value={s.padEnd} onCommit={(v) => set((x) => (x.padEnd = v))} />
            <NumberField testId="ui-scroll-limit" label="Never further than (pixels, 0 = the end)" min={0} value={s.limit} onCommit={(v) => set((x) => (x.limit = v))} />
          </div>
          <div className="row wrap">
            <CheckField testId="ui-scroll-wheel" label="Mouse wheel" value={s.wheel} onChange={(v) => set((x) => (x.wheel = v))} />
            <CheckField testId="ui-scroll-drag" label="Drag the content" value={s.drag} onChange={(v) => set((x) => (x.drag = v))} />
            <SelectField<string> testId="ui-scroll-stick" label="Stays at" value={s.stick} options={[{ value: 'none', label: 'where the player left it' }, { value: 'end', label: 'the end as rows arrive (a chat log)' }, { value: 'start', label: 'the start' }]} onChange={(v) => set((x) => (x.stick = v as typeof s.stick))} />
          </div>
          <div className="row wrap">
            <NumberField testId="ui-scroll-auto" label="Scrolls by itself (pixels a second, 0 = no)" min={0} value={s.auto} onCommit={(v) => set((x) => (x.auto = v))} />
            <CheckField testId="ui-scroll-loop" label="and starts again" value={s.autoLoop} onChange={(v) => set((x) => (x.autoLoop = v))} />
            <CheckField testId="ui-scroll-lazy" label="Makes rows only as they come into view (long lists)" value={s.lazy} onChange={(v) => set((x) => (x.lazy = v))} />
            {s.lazy && <NumberField testId="ui-scroll-rowsize" label="A row is (pixels, with its gap)" min={1} value={s.rowSize} onCommit={(v) => set((x) => (x.rowSize = v))} />}
          </div>
          <TextField testId="ui-scroll-bind" label="Keep its position in variables named" value={s.bind} placeholder="inv_scroll  (also .row, .rows, .top, .bottom)" onCommit={(v) => set((x) => (x.bind = v))} />
          <details>
            <summary>Buttons that scroll it (names of the project’s controls)</summary>
            {(['up', 'down', 'left', 'right', 'pageUp', 'pageDown'] as const).map((k) => (
              <TextField key={k} testId={`ui-scroll-action-${k}`} label={k} value={s.actions[k]} onCommit={(v) => set((x) => (x.actions[k] = v))} />
            ))}
            <div className="row wrap">
              <NumberField testId="ui-scroll-hold-delay" label="Held: wait (seconds)" min={0} step={0.1} value={s.holdDelay} onCommit={(v) => set((x) => (x.holdDelay = v))} />
              <NumberField testId="ui-scroll-hold-rate" label="then rows a second" min={1} value={s.holdRate} onCommit={(v) => set((x) => (x.holdRate = v))} />
              <NumberField testId="ui-scroll-hold-accel" label="faster by" min={1} step={0.5} value={s.holdAccel} onCommit={(v) => set((x) => (x.holdAccel = v))} />
            </div>
          </details>
          <h4>The scrollbar</h4>
          <SelectField<string> testId="ui-bar-show" label="Shown" value={bar?.show ?? 'never'} options={[{ value: 'never', label: 'never' }, { value: 'always', label: 'always' }, { value: 'scroll', label: 'while it scrolls' }, { value: 'hover', label: 'when the pointer is over it' }]} onChange={(v) => (v === 'never' ? set((x) => bar && (x.bar!.show = 'never')) : setBar((b) => (b.show = v as typeof b.show)))} />
          {bar && bar.show !== 'never' && (
            <>
              <div className="row wrap">
                <SelectField<string> testId="ui-bar-side" label="On the" value={bar.side} options={[{ value: 'right', label: 'right' }, { value: 'left', label: 'left' }, { value: 'top', label: 'top' }, { value: 'bottom', label: 'bottom' }]} onChange={(v) => setBar((b) => (b.side = v as typeof b.side))} />
                <NumberField testId="ui-bar-size" label="Width (pixels)" min={2} max={80} value={bar.size} onCommit={(v) => setBar((b) => (b.size = v))} />
                <SelectField<string> testId="ui-bar-thumb" label="Thumb is" value={bar.thumb} options={[{ value: 'visible', label: 'as long as what is in view' }, { value: 'fixed', label: 'a fixed length' }]} onChange={(v) => setBar((b) => (b.thumb = v as typeof b.thumb))} />
                {bar.thumb === 'fixed' && <NumberField testId="ui-bar-thumbsize" label="Length (pixels)" min={4} value={bar.thumbSize} onCommit={(v) => setBar((b) => (b.thumbSize = v))} />}
                <CheckField testId="ui-bar-arrows" label="Arrows" value={bar.arrows} onChange={(v) => setBar((b) => (b.arrows = v))} />
                <CheckField testId="ui-bar-pages" label="A mark for every page" value={bar.pageMarks} onChange={(v) => setBar((b) => (b.pageMarks = v))} />
              </div>
              <PartsEditor doc={doc} w={w} roles={BAR_ROLES} where="bar" parts={bar.parts} suits="scrollbar" prefix="ui-bar" />
            </>
          )}
          {(bar === undefined || bar.show === 'never') && <button data-testid="ui-bar-add" onClick={() => setBar((b) => (b.show = 'scroll'))}>+ Scrollbar</button>}
          <h4>“More above” and “more below”</h4>
          {(['before', 'after'] as const).map((k) => {
            const e = s[k];
            return (
              <div key={k} className="row wrap">
                <CheckField testId={`ui-edge-${k}`} label={k === 'before' ? 'A widget when there is more before' : 'A widget when there is more after'} value={e !== undefined} onChange={(v) => set((x) => (v ? (x[k] = { prefab: '', when: '' }) : delete x[k]))} />
                {e && <PartPicker doc={doc} info={{ role: k, label: 'It looks like' }} value={e.prefab} suits="scrollbar" testId={`ui-edge-${k}-prefab`} onChange={(v) => set((x) => (x[k] = { ...(x[k] ?? { when: '' }), prefab: v ?? '' }))} />}
                {e && <TextField testId={`ui-edge-${k}-when`} label="Shown only when (blank: when there is more)" value={e.when} placeholder="{scroll.hidden_after} > 0" onCommit={(v) => set((x) => (x[k] = { ...(x[k] ?? { prefab: '' }), when: v }))} />}
              </div>
            );
          })}
          <h4>When it scrolls</h4>
          <ActionListEditor testId="ui-scroll-on-scrolled" actions={s.on.scrolled as never} onChange={(next) => set((x) => (x.on.scrolled = next as never))} />
          <h4>When it reaches the end</h4>
          <ActionListEditor testId="ui-scroll-on-bottom" actions={s.on.bottom as never} onChange={(next) => set((x) => (x.on.bottom = next as never))} />
          <h4>When it reaches the start</h4>
          <ActionListEditor testId="ui-scroll-on-top" actions={s.on.top as never} onChange={(next) => set((x) => (x.on.top = next as never))} />
        </>
      )}
    </fieldset>
  );
}

// ---------- fields of a kind (built-in or a plugin's) ----------

function FieldsEditor({ fields, values, onChange, prefix }: { fields: FieldDef[]; values: Record<string, unknown>; onChange(key: string, value: unknown): void; prefix: string }) {
  const sprites = useStudio((s) => s.names);
  const tables = store.tables.map((t) => t.name);
  return (
    <div className="ui-fields">
      {fields.map((f) => {
        const id = `${prefix}-${f.key}`;
        const v = values[f.key] ?? f.default;
        switch (f.type) {
          case 'number':
            return <NumberField key={f.key} testId={id} label={f.label} step={0.5} value={typeof v === 'number' ? v : Number(v) || 0} onCommit={(n) => onChange(f.key, n)} />;
          case 'bool':
            return <CheckField key={f.key} testId={id} label={f.label} value={v === true} onChange={(b) => onChange(f.key, b)} />;
          case 'choice':
            return <SelectField<string> key={f.key} testId={id} label={f.label} value={String(v ?? f.options?.[0]?.value ?? '')} options={f.options ?? []} onChange={(x) => onChange(f.key, x)} />;
          case 'picture':
            return <SelectField<string> key={f.key} testId={id} label={f.label} value={String(v ?? '')} options={[{ value: '', label: '(none)' }, ...sprites.map((s) => ({ value: s, label: s }))]} onChange={(x) => onChange(f.key, x)} />;
          case 'table':
            return <SelectField<string> key={f.key} testId={id} label={f.label} value={String(v ?? '')} options={[{ value: '', label: '(none)' }, ...tables.map((t) => ({ value: t, label: t }))]} onChange={(x) => onChange(f.key, x)} />;
          case 'colour': {
            const text = String(v ?? '');
            return (
              <div className="row" key={f.key}>
                <TextField testId={id} label={f.label} value={text} onCommit={(x) => onChange(f.key, x)} />
                <input type="color" aria-label={`${f.label} (pick)`} value={/^#[0-9a-f]{6}$/i.test(text) ? text : '#808080'} onChange={(e) => onChange(f.key, e.target.value)} />
              </div>
            );
          }
          default:
            return <TextField key={f.key} testId={id} label={f.label} value={String(v ?? '')} placeholder={f.help} onCommit={(x) => onChange(f.key, x)} />;
        }
      })}
    </div>
  );
}

const layerFields = (kind: string): FieldDef[] => MAP_LAYER_FIELDS[kind] ?? host.ext.mapLayers.get(kind)?.fields ?? [];

// ---------- the map ----------

const move = <T,>(list: T[], i: number, d: number): void => {
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  const [x] = list.splice(i, 1);
  list.splice(j, 0, x!);
};

export function MapSection({ doc, w, edit }: Props) {
  const m = w.map ?? MapSpecSchema.parse({});
  const set = (fn: (x: MapSpec) => void): void =>
    edit((n) => {
      const x = n.map ?? MapSpecSchema.parse({});
      fn(x);
      n.map = x;
    });
  const scenes = store.getState().project?.project.scenes ?? [];
  const tables = store.tables.map((t) => t.name);
  const [newKind, setNewKind] = useState('terrain');
  const pluginLayerKinds = [...host.ext.mapLayers.values()].map((d) => ({ value: d.id, label: `${d.label} (from a plugin)` }));
  const layerKinds = [...MAP_LAYER_KINDS.map((k) => ({ value: k as string, label: k === 'terrain' ? 'Terrain (from the tiles and heights)' : k === 'picture' ? 'Picture (any image)' : k === 'regions' ? 'Regions (filled or outlined)' : k === 'paths' ? 'Paths (links)' : k === 'fog' ? 'Fog (what is not known yet)' : k === 'markers' ? 'Markers (UI prefabs)' : k === 'grid' ? 'Grid lines' : 'Labels (names)' })), ...pluginLayerKinds];
  const sourceFor = [...host.ext.markerSources.values()].map((d) => ({ value: d.id, label: `${d.label} (from a plugin)` }));
  return (
    <fieldset data-testid="ui-map-section">
      <legend>Map</legend>
      <div className="row wrap">
        <SelectField<string> testId="ui-map-source" label="What it is a map of" value={m.source.kind} options={MAP_SOURCES.map((k) => ({ value: k, label: k === 'current' ? 'the scene being played' : k === 'scene' ? 'a scene I choose' : k === 'scenes' ? 'several scenes on one layout' : k === 'table' ? 'a table of cells' : k === 'list' ? 'a list source' : 'nothing (a picture with markers on it)' }))} onChange={(v) => set((x) => (x.source.kind = v as MapSpec['source']['kind']))} />
        {m.source.kind === 'scene' && <SelectField<string> testId="ui-map-scene" label="Scene" value={m.source.scene} options={[{ value: '', label: '(the one being played)' }, ...scenes.map((s) => ({ value: s, label: s }))]} onChange={(v) => set((x) => (x.source.scene = v))} />}
        {m.source.kind === 'table' && <SelectField<string> testId="ui-map-table" label="Table (columns x, y, tile, height, value)" value={m.source.table} options={[{ value: '', label: '(choose)' }, ...tables.map((t) => ({ value: t, label: t }))]} onChange={(v) => set((x) => (x.source.table = v))} />}
        {m.source.kind === 'list' && <TextField testId="ui-map-list" label="List source" value={m.source.table} onCommit={(v) => set((x) => (x.source.table = v))} />}
        {['none', 'table', 'list', 'scenes'].includes(m.source.kind) && (
          <>
            <NumberField testId="ui-map-width" label="Width (cells)" min={1} value={m.source.width} onCommit={(v) => set((x) => (x.source.width = v))} />
            <NumberField testId="ui-map-height" label="Height (cells)" min={1} value={m.source.height} onCommit={(v) => set((x) => (x.source.height = v))} />
          </>
        )}
      </div>
      {m.source.kind === 'scenes' && (
        <div className="ui-map-scenes">
          {m.source.scenes.map((s, i) => (
            <div className="row" key={i}>
              <SelectField<string> testId={`ui-map-scenes-${i}`} label="Scene" value={s.scene} options={[{ value: '', label: '(choose)' }, ...scenes.map((x) => ({ value: x, label: x }))]} onChange={(v) => set((x) => (x.source.scenes[i]!.scene = v))} />
              <NumberField testId={`ui-map-scenes-${i}-x`} label="Left (cells)" value={s.x} onCommit={(v) => set((x) => (x.source.scenes[i]!.x = v))} />
              <NumberField testId={`ui-map-scenes-${i}-y`} label="Top (cells)" value={s.y} onCommit={(v) => set((x) => (x.source.scenes[i]!.y = v))} />
              <button aria-label="Remove" onClick={() => set((x) => void x.source.scenes.splice(i, 1))}>✕</button>
            </div>
          ))}
          <button data-testid="ui-map-scenes-add" onClick={() => set((x) => void x.source.scenes.push({ scene: '', x: 0, y: 0 }))}>+ Scene</button>
        </div>
      )}
      <h4>How cells become places</h4>
      <div className="row wrap">
        <SelectField<string> testId="ui-map-projection" label="Seen" value={m.projection.kind} options={MAP_PROJECTIONS.map((k) => ({ value: k, label: k === 'topdown' ? 'from above' : k === 'iso' ? 'isometric, like the game' : 'a picture with markers placed on it' }))} onChange={(v) => set((x) => (x.projection.kind = v as MapSpec['projection']['kind']))} />
        {m.projection.kind === 'iso' && <SelectField<string> testId="ui-map-rotation" label="Turned" value={m.projection.rotation} options={[{ value: 'camera', label: 'with the game’s camera' }, { value: 'fixed', label: 'a fixed angle' }]} onChange={(v) => set((x) => (x.projection.rotation = v as 'camera' | 'fixed'))} />}
        {m.projection.kind === 'iso' && m.projection.rotation === 'fixed' && <NumberField testId="ui-map-angle" label="Angle (90, 180, 270)" step={90} value={m.projection.angle} onCommit={(v) => set((x) => (x.projection.angle = v))} />}
        <NumberField testId="ui-map-cell" label="Pixels a cell is across" min={1} max={256} value={m.view.cell} onCommit={(v) => set((x) => (x.view.cell = v))} />
      </div>
      <div className="row wrap">
        <NumberField testId="ui-map-zoom" label="Starting zoom" min={0.05} step={0.25} value={m.view.zoom} onCommit={(v) => set((x) => (x.view.zoom = v))} />
        <NumberField testId="ui-map-zoommin" label="Least" min={0.05} step={0.25} value={m.view.zoomMin} onCommit={(v) => set((x) => (x.view.zoomMin = v))} />
        <NumberField testId="ui-map-zoommax" label="Most" min={0.05} step={0.5} value={m.view.zoomMax} onCommit={(v) => set((x) => (x.view.zoomMax = v))} />
        <CheckField testId="ui-map-fit" label="Zoom 1 is the whole map in the window" value={m.view.fit} onChange={(v) => set((x) => (x.view.fit = v))} />
      </div>
      <div className="row wrap">
        <TextField testId="ui-map-centre" label="Looks at" value={m.view.centre} placeholder="auto, 12,8 (cells) or follow:player" onCommit={(v) => set((x) => (x.view.centre = v || 'auto'))} />
        <SelectField<string> testId="ui-map-turn" label="The map turns" value={m.view.turn} options={[{ value: 'none', label: 'never' }, { value: 'camera', label: 'with the game’s camera (from above)' }, { value: 'fixed', label: 'to a fixed angle (from above)' }]} onChange={(v) => set((x) => (x.view.turn = v as MapSpec['view']['turn']))} />
        {m.view.turn === 'fixed' && <NumberField testId="ui-map-turnangle" label="Degrees" value={m.view.turnAngle} onCommit={(v) => set((x) => (x.view.turnAngle = v))} />}
      </div>

      <h4>Layers (the first is at the back)</h4>
      {m.layers.map((l, i) => (
        <LayerEditor key={l.id} doc={doc} index={i} layer={l} count={m.layers.length} set={set} />
      ))}
      <div className="row">
        <SelectField<string> testId="ui-map-layer-new-kind" label="Add a layer" value={newKind} options={layerKinds} onChange={setNewKind} />
        <button
          data-testid="ui-map-layer-add"
          onClick={() =>
            set((x) => {
              let n = x.layers.length + 1;
              while (x.layers.some((l) => l.id === `${newKind}${n}`)) n++;
              const id = x.layers.some((l) => l.id === newKind) ? `${newKind}${n}` : newKind;
              const def = host.ext.mapLayers.get(newKind);
              x.layers.push({ ...defaultMapLayer(newKind, id), name: def?.label ?? defaultMapLayer(newKind, id).name, settings: Object.fromEntries(layerFields(newKind).filter((f) => f.default !== undefined).map((f) => [f.key, f.default])) });
            })
          }
        >
          + Layer
        </button>
      </div>

      <h4>Markers</h4>
      {m.markers.map((k, i) => (
        <MarkerEditor key={k.id} doc={doc} index={i} kind={k} count={m.markers.length} set={set} sources={sourceFor} />
      ))}
      <button
        data-testid="ui-map-marker-add"
        onClick={() =>
          set((x) => {
            let n = x.markers.length + 1;
            while (x.markers.some((k) => k.id === `kind${n}`)) n++;
            x.markers.push(MarkerKindSchema.parse({ id: `kind${n}`, name: `Markers ${n}` }));
          })
        }
      >
        + Marker kind
      </button>

      <h4>Moving around</h4>
      <div className="row wrap">
        <SelectField<string> testId="ui-map-navmode" label="The highlight goes to the next marker" value={m.nav.mode} options={[{ value: 'direction', label: 'by direction on the screen' }, { value: 'order', label: 'in list order' }, { value: 'nearest', label: 'to the nearest' }]} onChange={(v) => set((x) => (x.nav.mode = v as MapSpec['nav']['mode']))} />
        <CheckField testId="ui-map-wrap" label="Comes round at the ends" value={m.nav.wrap} onChange={(v) => set((x) => (x.nav.wrap = v))} />
        <SelectField<string> testId="ui-map-start" label="Starts on" value={m.nav.start} options={[{ value: 'first', label: 'the first marker' }, { value: 'here', label: 'the marker nearest the player' }, { value: 'none', label: 'nothing' }]} onChange={(v) => set((x) => (x.nav.start = v as MapSpec['nav']['start']))} />
        <SelectField<string> testId="ui-map-keys" label="The arrows" value={m.nav.keys} options={[{ value: 'highlight', label: 'move the highlight' }, { value: 'pan', label: 'pan the view' }, { value: 'none', label: 'do nothing here' }]} onChange={(v) => set((x) => (x.nav.keys = v as MapSpec['nav']['keys']))} />
      </div>
      <div className="row wrap">
        <CheckField testId="ui-map-click" label="Click chooses" value={m.nav.click} onChange={(v) => set((x) => (x.nav.click = v))} />
        <CheckField testId="ui-map-drag" label="Drag pans" value={m.nav.drag} onChange={(v) => set((x) => (x.nav.drag = v))} />
        <CheckField testId="ui-map-wheel" label="Wheel zooms" value={m.nav.wheel} onChange={(v) => set((x) => (x.nav.wheel = v))} />
        <CheckField testId="ui-map-pinch" label="Pinch zooms" value={m.nav.pinch} onChange={(v) => set((x) => (x.nav.pinch = v))} />
      </div>
      <details>
        <summary>Buttons the map listens to (names of the project’s controls)</summary>
        {(['up', 'down', 'left', 'right', 'next', 'prev', 'zoomIn', 'zoomOut', 'select', 'recentre'] as const).map((k) => (
          <TextField key={k} testId={`ui-map-action-${k}`} label={k} value={m.nav.actions[k]} onCommit={(v) => set((x) => (x.nav.actions[k] = v))} />
        ))}
      </details>
      <TextField testId="ui-map-bind" label="Keep the highlighted marker, the zoom and the centre in variables named" value={m.bind} placeholder="map  (then {map.label}, {map.zoom}, {map.row.name}...)" onCommit={(v) => set((x) => (x.bind = v))} />
      <h4>When a marker is highlighted</h4>
      <ActionListEditor testId="ui-map-on-highlight" actions={m.on.highlight as never} onChange={(next) => set((x) => (x.on.highlight = next as never))} />
      <h4>When a marker is chosen</h4>
      <ActionListEditor testId="ui-map-on-choose" actions={m.on.choose as never} onChange={(next) => set((x) => (x.on.choose = next as never))} />
      <h4>When part of the map is revealed</h4>
      <ActionListEditor testId="ui-map-on-reveal" actions={m.on.reveal as never} onChange={(next) => set((x) => (x.on.reveal = next as never))} />
      <div className="row wrap">
        <SelectField<string> testId="ui-map-style" label="Start from a style (markers)" value="" options={[{ value: '', label: '(choose)' }, ...UI_STYLES.map((s) => ({ value: s.id, label: s.label }))]} onChange={(v) => v && designer.edit(applyControlStyle(doc, w.id, v))} />
      </div>
    </fieldset>
  );
}

function LayerEditor({ doc, index, layer, count, set }: { doc: UiDoc; index: number; layer: MapLayer; count: number; set(fn: (m: MapSpec) => void): void }) {
  void doc;
  const [open, setOpen] = useState(false);
  const fields = layerFields(layer.kind);
  const edit = (fn: (l: MapLayer) => void): void => set((x) => fn(x.layers[index]!));
  const id = `ui-map-layer-${index}`;
  return (
    <div className="ui-map-layer" data-testid={id}>
      <div className="row">
        <button data-testid={`${id}-toggle`} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} {layer.name || layer.id} <small>({layer.kind})</small>
        </button>
        <button aria-label="Move back" onClick={() => set((x) => move(x.layers, index, -1))} disabled={index === 0}>
          ↑
        </button>
        <button aria-label="Move forward" onClick={() => set((x) => move(x.layers, index, 1))} disabled={index === count - 1}>
          ↓
        </button>
        <button data-testid={`${id}-delete`} aria-label="Remove the layer" onClick={() => set((x) => void x.layers.splice(index, 1))}>
          ✕
        </button>
      </div>
      {open && (
        <div className="ui-map-layer-body">
          <TextField testId={`${id}-name`} label="Name" value={layer.name} onCommit={(v) => edit((l) => (l.name = v))} />
          <div className="row wrap">
            <NumberField testId={`${id}-opacity`} label="Opacity (0 to 1)" min={0} max={1} step={0.1} value={layer.opacity} onCommit={(v) => edit((l) => (l.opacity = v))} />
            <SelectField<string> testId={`${id}-blend`} label="Blend" value={layer.blend} options={MAP_BLENDS.map((b) => ({ value: b, label: b }))} onChange={(v) => edit((l) => (l.blend = v as MapLayer['blend']))} />
          </div>
          <TextField testId={`${id}-visible`} label="Shown only when" value={layer.visible} placeholder="{show_grid} = 1" onCommit={(v) => edit((l) => (l.visible = v))} />
          <div className="row wrap">
            <NumberField testId={`${id}-zoommin`} label="Only from this zoom (0: always)" min={0} step={0.5} value={layer.zoomMin} onCommit={(v) => edit((l) => (l.zoomMin = v))} />
            <NumberField testId={`${id}-zoommax`} label="Only up to this zoom" min={0} step={0.5} value={layer.zoomMax} onCommit={(v) => edit((l) => (l.zoomMax = v))} />
          </div>
          <FieldsEditor fields={fields} values={layer.settings} prefix={id} onChange={(k, v) => edit((l) => (l.settings = { ...l.settings, [k]: v }))} />
        </div>
      )}
    </div>
  );
}

function MarkerEditor({ doc, index, kind, count, set, sources }: { doc: UiDoc; index: number; kind: MarkerKind; count: number; set(fn: (m: MapSpec) => void): void; sources: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const edit = (fn: (k: MarkerKind) => void): void => set((x) => fn(x.markers[index]!));
  const id = `ui-map-marker-${index}`;
  const sourceDef = host.ext.markerSources.get(kind.from);
  const states = Object.entries(kind.statePrefabs);
  const [newState, setNewState] = useState('');
  return (
    <div className="ui-map-marker" data-testid={id}>
      <div className="row">
        <button data-testid={`${id}-toggle`} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} {kind.name || kind.id} <small>({kind.from})</small>
        </button>
        <button aria-label="Earlier" onClick={() => set((x) => move(x.markers, index, -1))} disabled={index === 0}>
          ↑
        </button>
        <button aria-label="Later" onClick={() => set((x) => move(x.markers, index, 1))} disabled={index === count - 1}>
          ↓
        </button>
        <button data-testid={`${id}-delete`} aria-label="Remove the marker kind" onClick={() => set((x) => void x.markers.splice(index, 1))}>
          ✕
        </button>
      </div>
      {open && (
        <div className="ui-map-marker-body">
          <div className="row wrap">
            <TextField testId={`${id}-id`} label="Id (used in conditions and actions)" value={kind.id} onCommit={(v) => v.trim() && edit((k) => (k.id = v.trim()))} />
            <TextField testId={`${id}-name`} label="Name" value={kind.name} onCommit={(v) => edit((k) => (k.name = v))} />
          </div>
          <div className="row wrap">
            <SelectField<string> testId={`${id}-from`} label="Comes from" value={kind.from} options={[...MARKER_FROM, ...sources]} onChange={(v) => edit((k) => (k.from = v))} />
            {kind.from !== 'hand' && <TextField testId={`${id}-source`} label={kind.from === 'tags' ? 'Tag' : kind.from === 'prefabs' ? 'Prefab or name' : kind.from === 'table' ? 'Table' : kind.from === 'regions' ? 'Region names (blank: all)' : 'Source'} value={kind.source} onCommit={(v) => edit((k) => (k.source = v))} />}
          </div>
          {['table', 'list'].includes(kind.from) && (
            <div className="row wrap">
              <TextField testId={`${id}-x`} label="Across (a column, or a value)" value={kind.x} onCommit={(v) => edit((k) => (k.x = v))} />
              <TextField testId={`${id}-y`} label="Down" value={kind.y} onCommit={(v) => edit((k) => (k.y = v))} />
            </div>
          )}
          {sourceDef?.fields && <FieldsEditor fields={sourceDef.fields} values={kind.settings} prefix={`${id}-set`} onChange={(k, v) => edit((x) => (x.settings = { ...x.settings, [k]: v }))} />}
          <PartPicker doc={doc} info={{ role: 'marker', label: 'Each marker looks like (a UI prefab)' }} value={kind.prefab} suits="map" testId={`${id}-prefab`} onChange={(v) => edit((k) => (k.prefab = v ?? ''))} />
          <TextField testId={`${id}-state`} label="State of each marker (words, {values})" value={kind.state} placeholder="{place.state}" onCommit={(v) => edit((k) => (k.state = v))} />
          {states.map(([s, p]) => (
            <div className="row" key={s}>
              <PartPicker doc={doc} info={{ role: s, label: `When the state is “${s}”, it looks like` }} value={p} suits="map" testId={`${id}-state-${s}`} onChange={(v) => edit((k) => (v === undefined ? delete k.statePrefabs[s] : (k.statePrefabs[s] = v)))} />
              <button aria-label={`Remove the state ${s}`} onClick={() => edit((k) => delete k.statePrefabs[s])}>
                ✕
              </button>
            </div>
          ))}
          <div className="row">
            <TextField testId={`${id}-newstate`} label="Add a state (a name)" value={newState} onCommit={setNewState} />
            <button data-testid={`${id}-newstate-add`} disabled={newState.trim() === ''} onClick={() => (edit((k) => (k.statePrefabs[newState.trim()] = '')), setNewState(''))}>
              + State
            </button>
          </div>
          <TextField testId={`${id}-show`} label="Shown only when (sees marker.*, map.zoom, map.distance)" value={kind.show} placeholder="{map.distance} > 5" onCommit={(v) => edit((k) => (k.show = v))} />
          <div className="row wrap">
            <TextField testId={`${id}-sort`} label="Drawn higher the greater this is" value={kind.sort} onCommit={(v) => edit((k) => (k.sort = v))} />
            <NumberField testId={`${id}-cluster`} label="Merge when closer than (pixels, 0 = never)" min={0} value={kind.cluster} onCommit={(v) => edit((k) => (k.cluster = v))} />
          </div>
          {kind.cluster > 0 && <PartPicker doc={doc} info={{ role: 'cluster', label: 'A group looks like' }} value={kind.clusterPrefab} suits="map" testId={`${id}-clusterprefab`} onChange={(v) => edit((k) => (k.clusterPrefab = v ?? ''))} />}
          <div className="row wrap">
            <CheckField testId={`${id}-follows`} label="Moves with its object" value={kind.follows} onChange={(v) => edit((k) => (k.follows = v))} />
            <CheckField testId={`${id}-scale`} label="Grows with the zoom" value={kind.scaleWithZoom} onChange={(v) => edit((k) => (k.scaleWithZoom = v))} />
            <CheckField testId={`${id}-choosable`} label="Can be highlighted and chosen" value={kind.choosable} onChange={(v) => edit((k) => (k.choosable = v))} />
          </div>
          {kind.from === 'hand' && (
            <div className="ui-map-hand">
              {kind.hand.map((h, hi) => (
                <div className="row wrap" key={hi}>
                  <TextField testId={`${id}-hand-${hi}-id`} label="Id" value={h.id} onCommit={(v) => edit((k) => (k.hand[hi]!.id = v))} />
                  <NumberField testId={`${id}-hand-${hi}-x`} label="Across" value={h.x} onCommit={(v) => edit((k) => (k.hand[hi]!.x = v))} />
                  <NumberField testId={`${id}-hand-${hi}-y`} label="Down" value={h.y} onCommit={(v) => edit((k) => (k.hand[hi]!.y = v))} />
                  <TextField testId={`${id}-hand-${hi}-label`} label="Words" value={h.label} onCommit={(v) => edit((k) => (k.hand[hi]!.label = v))} />
                  <TextField testId={`${id}-hand-${hi}-state`} label="State" value={h.state} onCommit={(v) => edit((k) => (k.hand[hi]!.state = v))} />
                  <button aria-label="Remove the marker" onClick={() => edit((k) => void k.hand.splice(hi, 1))}>
                    ✕
                  </button>
                </div>
              ))}
              <button data-testid={`${id}-hand-add`} onClick={() => edit((k) => void k.hand.push({ id: `m${k.hand.length + 1}`, x: 0, y: 0, label: '', state: '' }))}>
                + Marker
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
