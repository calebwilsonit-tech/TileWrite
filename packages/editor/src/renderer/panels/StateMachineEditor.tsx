import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  CONDITION_LABELS,
  bossMachine,
  checkMachine,
  describeMachineCondition,
  guardMachine,
  newMachineCondition,
  type MachineCondition,
  type StateMachine,
} from '@tilewright/behaviors';
import {
  ANY,
  ANY_POS,
  STATE_H,
  STATE_W,
  addState,
  addTransition,
  arrowPath,
  moveState,
  positions,
  removeState,
  removeTransition,
  reorderTransition,
  toggleBehaviour,
  updateState,
  updateTransition,
} from '../model/machine-edit';
import { CheckField, NumberField, SelectField, TextField } from './fields';
import { SoundField } from './SoundField';

type Drag = { kind: 'state'; id: string; dx: number; dy: number; x: number; y: number; moved: boolean } | { kind: 'link'; from: string; x: number; y: number } | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean };

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const MOVES = [
  { value: 'none', label: 'Stands still (unless a behaviour moves it)' },
  { value: 'toward', label: 'Walks toward its target' },
  { value: 'away', label: 'Walks away from its target' },
  { value: 'home', label: 'Walks back to where it started' },
];

function ConditionFields({ c, onChange }: { c: MachineCondition; onChange(c: MachineCondition): void }) {
  return (
    <>
      <SelectField<string>
        label="Changes state when"
        testId="sm-when"
        value={c.type}
        options={(Object.keys(CONDITION_LABELS) as MachineCondition['type'][]).map((t) => ({ value: t, label: CONDITION_LABELS[t] }))}
        onChange={(t) => onChange(newMachineCondition(t as MachineCondition['type']))}
      />
      {(c.type === 'lost' || c.type === 'time') && <NumberField label="Seconds" testId="sm-seconds" value={c.seconds} min={0} step={0.5} onCommit={(v) => onChange({ ...c, seconds: v })} />}
      {(c.type === 'near' || c.type === 'far') && <NumberField label="Cells" testId="sm-cells" value={c.cells} min={0.5} step={0.5} onCommit={(v) => onChange({ ...c, cells: v })} />}
      {c.type === 'health' && <NumberField label="Health percent" testId="sm-percent" value={c.percent} min={0} max={100} step={5} onCommit={(v) => onChange({ ...c, percent: v })} />}
      {c.type === 'variable' && (
        <>
          <TextField label="Variable" testId="sm-var" value={c.name} onCommit={(v) => onChange({ ...c, name: v.trim() })} />
          <SelectField<string> label="Is" value={c.op} options={['=', '!=', '>', '>=', '<', '<='].map((o) => ({ value: o, label: o }))} onChange={(o) => onChange({ ...c, op: o as typeof c.op })} />
          <TextField label="Value" value={String(c.value)} onCommit={(v) => onChange({ ...c, value: v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v })} />
        </>
      )}
    </>
  );
}

/**
 * The moods of an enemy or boss as a graph: a card for every state, an arrow for every "when this happens, change to
 * that". Drag cards to move them, drag from the dot on a card to another card to add an arrow, click a card or an arrow
 * label to edit it below. Arrows leaving a state are tried in order and the first that fits wins.
 */
export function StateMachineEditor({ machine, has, onChange }: { machine: StateMachine; has: string[]; onChange(next: StateMachine): void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 30, y: 110, zoom: 0.85 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [sel, setSel] = useState<{ kind: 'state' | 'arrow'; id: string } | null>(null);
  const [big, setBig] = useState(false);
  const base = useMemo(() => positions(machine), [machine]);
  /** Show every card: scale and shift the view to the cards' bounding box. */
  const fit = (m: StateMachine = machine): void => {
    const el = svg.current;
    if (!el || m.states.length === 0) return setView({ x: 30, y: 110, zoom: 0.85 });
    const pos = positions(m);
    const xs = [...pos.values()].map((p) => p.x);
    const ys = [...pos.values()].map((p) => p.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys) - (m.transitions.some((t) => t.from === ANY) ? 100 : 0);
    const w = Math.max(...xs) + STATE_W - x0 + 20;
    const h = Math.max(...ys) + STATE_H - y0 + 40;
    const zoom = Math.max(0.3, Math.min(1.1, (el.clientWidth - 24) / w, (el.clientHeight - 24) / h));
    setView({ zoom, x: 12 - x0 * zoom, y: 12 - y0 * zoom });
  };
  useEffect(() => fit(), []);
  const problems = useMemo(() => checkMachine(machine, (b) => has.includes(b)), [machine, has]);
  const pos = (id: string): { x: number; y: number } => (id === ANY ? ANY_POS : drag?.kind === 'state' && drag.id === id ? { x: drag.x, y: drag.y } : (base.get(id) ?? { x: 0, y: 0 }));

  const toGraph = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.zoom, y: (e.clientY - r.top - view.y) / view.zoom };
  };
  const stateAt = (p: { x: number; y: number }): string | null => {
    for (const s of [...machine.states].reverse()) {
      const q = pos(s.id);
      if (p.x >= q.x && p.x <= q.x + STATE_W && p.y >= q.y && p.y <= q.y + STATE_H) return s.id;
    }
    return null;
  };

  const down = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return;
    svg.current!.setPointerCapture(e.pointerId);
    const target = e.target as Element;
    const p = toGraph(e);
    const arrow = target.closest('[data-arrow]');
    if (arrow) {
      setSel({ kind: 'arrow', id: arrow.getAttribute('data-arrow')! });
      return;
    }
    const port = target.closest('[data-port]');
    if (port) {
      setDrag({ kind: 'link', from: port.getAttribute('data-port')!, x: p.x, y: p.y });
      return;
    }
    const id = stateAt(p);
    if (id) {
      const q = pos(id);
      setSel({ kind: 'state', id });
      setDrag({ kind: 'state', id, dx: p.x - q.x, dy: p.y - q.y, x: q.x, y: q.y, moved: false });
      return;
    }
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false });
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      setView((v) => ({ ...v, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy }));
      setDrag({ ...drag, moved: drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3 });
      return;
    }
    const p = toGraph(e);
    if (drag.kind === 'state') setDrag({ ...drag, x: p.x - drag.dx, y: p.y - drag.dy, moved: drag.moved || Math.hypot(p.x - drag.dx - drag.x, p.y - drag.dy - drag.y) > 2 });
    else setDrag({ ...drag, x: p.x, y: p.y });
  };
  const up = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!drag) return;
    svg.current?.releasePointerCapture?.(e.pointerId);
    if (drag.kind === 'state' && drag.moved) onChange(moveState(machine, drag.id, drag.x, drag.y));
    else if (drag.kind === 'link') {
      const to = stateAt(toGraph(e));
      if (to && to !== drag.from) {
        const r = addTransition(machine, drag.from, to);
        onChange(r.machine);
        setSel({ kind: 'arrow', id: r.id });
      }
    } else if (drag.kind === 'pan' && !drag.moved) setSel(null);
    setDrag(null);
  };

  // arrows between the same pair bend differently
  const seen = new Map<string, number>();
  const arrows = machine.transitions
    .filter((t) => (t.from === ANY || machine.states.some((s) => s.id === t.from)) && machine.states.some((s) => s.id === t.to))
    .map((t) => {
      const key = [t.from, t.to].sort().join('|');
      const k = seen.get(key) ?? 0;
      seen.set(key, k + 1);
      return { t, k };
    });

  const state = sel?.kind === 'state' ? machine.states.find((s) => s.id === sel.id) : undefined;
  const arrow = sel?.kind === 'arrow' ? machine.transitions.find((t) => t.id === sel.id) : undefined;
  const fromOptions = [{ value: ANY, label: 'Any state' }, ...machine.states.map((s) => ({ value: s.id, label: s.name }))];
  const toOptions = machine.states.map((s) => ({ value: s.id, label: s.name }));

  return (
    <div className={big ? 'smedit dg-overlay' : 'smedit'} data-testid="sm-editor">
      <div className="row wrap">
        <SelectField<string>
          label="Start from an example"
          testId="sm-example"
          value=""
          options={[
            { value: '', label: '(choose)' },
            { value: 'guard', label: 'Guard: patrols, chases, looks around, goes back' },
            { value: 'boss', label: 'Boss: watches, attacks, backs off, rages when hurt' },
          ]}
          onChange={(v) => {
            if (v === '') return;
            if (machine.states.length > 0 && !window.confirm('Replace the states and arrows below with the example?')) return;
            const next = { ...(v === 'guard' ? guardMachine() : bossMachine()), target: machine.target };
            onChange(next);
            setSel(null);
            setTimeout(() => fit(next), 0);
          }}
        />
        <button
          className="small"
          data-testid="sm-add-state"
          onClick={() => {
            const r = addState(machine);
            onChange(r.machine);
            setSel({ kind: 'state', id: r.id });
            setTimeout(() => fit(r.machine), 0); // so the new card is in view
          }}
        >
          Add a state
        </button>
        <button className="small" data-testid="sm-fit" onClick={() => fit()}>
          Fit to window
        </button>
        <button
          className="small"
          data-testid="sm-big"
          aria-pressed={big}
          onClick={() => {
            setBig(!big);
            setTimeout(() => fit(), 50);
          }}
          title="Fill the window with the state machine, for more room"
        >
          {big ? 'Back to the panel' : 'Make it bigger'}
        </button>
      </div>
      <svg ref={svg} className="sm-canvas" data-testid="sm-canvas" role="application" aria-label="State machine" onPointerDown={down} onPointerMove={move} onPointerUp={up} onWheel={(e) => setView((v) => ({ ...v, zoom: Math.max(0.3, Math.min(1.6, v.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) }))}>
        <defs>
          <marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#9aa3b2" />
          </marker>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {machine.transitions.some((t) => t.from === ANY) && (
            <g transform={`translate(${ANY_POS.x} ${ANY_POS.y})`} data-testid="sm-any">
              <rect width={STATE_W} height={36} rx={18} fill="#2a2d37" stroke="#4a4f60" strokeDasharray="4 3" />
              <text x={STATE_W / 2} y={23} textAnchor="middle" fontSize={12} fill="#d6dbe6">
                Any state
              </text>
              <circle cx={STATE_W} cy={18} r={7} fill="#6aa8ff" stroke="#0d0f14" strokeWidth={2} data-port={ANY} />
            </g>
          )}
          {arrows.map(({ t, k }) => {
            const a = pos(t.from);
            const aEff = t.from === ANY ? { x: a.x, y: a.y - (STATE_H - 36) / 2 } : a;
            const loop = t.from === t.to;
            const { d, label } = loop ? { d: `M${a.x + 40},${a.y} C${a.x + 40},${a.y - 60} ${a.x + 110},${a.y - 60} ${a.x + 110},${a.y}`, label: { x: a.x + 75, y: a.y - 48 } } : arrowPath(aEff, pos(t.to), k);
            const on = sel?.kind === 'arrow' && sel.id === t.id;
            const text = clip(describeMachineCondition(t.when), 30);
            return (
              <g key={t.id} data-arrow={t.id} data-testid={`sm-arrow-${t.from === ANY ? 'any' : t.from}-${t.to}`}>
                <path d={d} fill="none" stroke={on ? '#6aa8ff' : '#9aa3b2'} strokeWidth={on ? 3 : 2} markerEnd="url(#sm-arrow)" />
                <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                <rect x={label.x - text.length * 3.1 - 5} y={label.y - 10} width={text.length * 6.2 + 10} height={20} rx={9} fill={on ? '#27406b' : '#1b1e27'} stroke={on ? '#6aa8ff' : '#3a3d48'} />
                <text x={label.x} y={label.y + 4} textAnchor="middle" fontSize={11} fill="#d6dbe6" pointerEvents="none">
                  {text}
                </text>
              </g>
            );
          })}
          {drag?.kind === 'link' && <path d={`M${pos(drag.from).x + STATE_W},${pos(drag.from).y + STATE_H / 2} L${drag.x},${drag.y}`} stroke="#6aa8ff" strokeWidth={2} strokeDasharray="5 4" fill="none" />}
          {machine.states.map((s) => {
            const p = pos(s.id);
            const on = sel?.kind === 'state' && sel.id === s.id;
            return (
              <g key={s.id} transform={`translate(${p.x} ${p.y})`} data-testid={`sm-state-${s.id}`}>
                <rect width={STATE_W} height={STATE_H} rx={12} fill="#1b1e27" stroke={on ? '#6aa8ff' : machine.start === s.id ? '#46c98b' : '#3a3d48'} strokeWidth={on ? 3 : 2} />
                <text x={12} y={22} fontSize={13} fontWeight={700} fill="#fff">
                  {clip(s.name, 17)}
                </text>
                {machine.start === s.id && (
                  <text x={STATE_W - 10} y={22} textAnchor="end" fontSize={10} fill="#46c98b">
                    ▶ start
                  </text>
                )}
                <text x={12} y={42} fontSize={11} fill="#aab1c2">
                  {clip(s.behaviours.length > 0 ? s.behaviours.join(', ') : 'no behaviours', 22)}
                </text>
                <text x={12} y={58} fontSize={11} fill="#8b92a5">
                  {s.move === 'none' ? 'stands' : s.move === 'toward' ? 'walks toward' : s.move === 'away' ? 'walks away' : 'walks home'}
                </text>
                <circle cx={STATE_W} cy={STATE_H / 2} r={7} fill="#6aa8ff" stroke="#0d0f14" strokeWidth={2} style={{ cursor: 'crosshair' }} data-port={s.id} data-testid={`sm-port-${s.id}`} />
              </g>
            );
          })}
        </g>
      </svg>
      <p className="hint">Drag a card to move it. Drag from its blue dot to another card to add an arrow. Click a card or an arrow's label to edit it below.</p>
      {machine.transitions.length > 0 && !machine.transitions.some((t) => t.from === ANY) && (
        <button className="small" data-testid="sm-add-any" onClick={() => onChange(addTransition(machine, ANY, machine.start || machine.states[0]?.id || '', newMachineCondition('defeated')).machine)}>
          Add an arrow from any state
        </button>
      )}

      {state && (
        <fieldset className="story-card" data-testid="sm-state-form">
          <legend>State: {state.name}</legend>
          <TextField label="Name" testId="sm-name" value={state.name} onCommit={(v) => onChange(updateState(machine, state.id, { name: v.trim() || state.name }))} />
          <CheckField label="The object starts in this state" testId="sm-start" value={machine.start === state.id} onChange={(on) => on && onChange({ ...machine, start: state.id })} />
          <div className="field">
            <span>Behaviours that run here (the ones left unticked are switched off in this state)</span>
            {has.length === 0 && <small>This object has no other behaviours yet. Add Patrol, Vision Cone, Chase, Damage on Touch... above.</small>}
            {has.map((b) => (
              <label key={b} className="field check">
                <input data-testid={`sm-beh-${b}`} type="checkbox" checked={state.behaviours.includes(b)} onChange={(e) => onChange(toggleBehaviour(machine, state.id, b, e.target.checked))} />
                <span>{b}</span>
              </label>
            ))}
          </div>
          <SelectField<string> label="Moves" testId="sm-move" value={state.move} options={MOVES} onChange={(v) => onChange(updateState(machine, state.id, { move: v as typeof state.move }))} />
          {state.move !== 'none' && <NumberField label="Speed (cells per second)" testId="sm-speed" value={state.speed} min={0.5} max={15} step={0.5} onCommit={(v) => onChange(updateState(machine, state.id, { speed: v }))} />}
          <TextField label="Animation to play on entering (empty = leave it)" value={state.anim} onCommit={(v) => onChange(updateState(machine, state.id, { anim: v.trim() }))} />
          <TextField label="Message to show on entering" testId="sm-message" value={state.message} onCommit={(v) => onChange(updateState(machine, state.id, { message: v }))} />
          <SoundField label="Sound to play on entering" value={state.sound} onCommit={(v) => onChange(updateState(machine, state.id, { sound: v.trim() }))} />
          <button
            className="small"
            data-testid="sm-delete-state"
            onClick={() => {
              onChange(removeState(machine, state.id));
              setSel(null);
            }}
          >
            Delete this state (and its arrows)
          </button>
        </fieldset>
      )}

      {arrow && (
        <fieldset className="story-card" data-testid="sm-arrow-form">
          <legend>Arrow</legend>
          <SelectField<string> label="From" testId="sm-from" value={arrow.from} options={fromOptions} onChange={(v) => onChange(updateTransition(machine, arrow.id, { from: v }))} />
          <SelectField<string> label="To" testId="sm-to" value={arrow.to} options={toOptions} onChange={(v) => onChange(updateTransition(machine, arrow.id, { to: v }))} />
          <ConditionFields c={arrow.when} onChange={(when) => onChange(updateTransition(machine, arrow.id, { when }))} />
          <div className="row">
            <button className="small" aria-label="Try this arrow earlier" onClick={() => onChange(reorderTransition(machine, arrow.id, -1))}>
              Earlier
            </button>
            <button className="small" aria-label="Try this arrow later" onClick={() => onChange(reorderTransition(machine, arrow.id, 1))}>
              Later
            </button>
            <button
              className="small"
              data-testid="sm-delete-arrow"
              onClick={() => {
                onChange(removeTransition(machine, arrow.id));
                setSel(null);
              }}
            >
              Delete this arrow
            </button>
          </div>
          <small>Arrows leaving a state are tried from first to last; the first one whose condition holds is taken.</small>
        </fieldset>
      )}

      {problems.length > 0 && (
        <ul className="story-problems" data-testid="sm-problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
