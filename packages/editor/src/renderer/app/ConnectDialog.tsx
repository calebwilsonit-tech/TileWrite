import { useMemo, useState } from 'react';
import { actionPinsOf, behaviorList, eventPinsOf } from '@tilewright/behaviors';
import { store, useApp } from './store';
import { connectToTarget } from '../model/logic-edit';

/** What an object can send or receive, from the behaviours attached to it. */
function signalChoices(entityId: string, side: 'outputs' | 'inputs'): { name: string; label: string; help?: string }[] {
  const e = store.doc?.getEntity(entityId);
  if (!e) return [];
  const seen = new Map<string, { name: string; label: string; help?: string }>();
  for (const b of behaviorList()) {
    if (e.components[b.id] === undefined) continue;
    for (const s of b[side]) if (!seen.has(s.name)) seen.set(s.name, s);
  }
  return [...seen.values()];
}

/**
 * Connect two objects, two ways. "Pass the signal on" joins a signal that leaves the first to a signal that enters the second
 * (a plate to a gate: it stays on while the plate is down). "Make something happen" says what the first announces ("On click",
 * "Is defeated") and what is done to the second ("Open", "Hide", "Remove"): it makes the event and action nodes for you.
 */
export function ConnectDialog() {
  const connect = useApp((s) => s.connect);
  const outs = useMemo(() => (connect ? signalChoices(connect.from, 'outputs') : []), [connect]);
  const ins = useMemo(() => (connect ? signalChoices(connect.to, 'inputs') : []), [connect]);
  const doc = store.doc;
  const fromE = connect ? doc?.getEntity(connect.from) : undefined;
  const toE = connect ? doc?.getEntity(connect.to) : undefined;
  const events = useMemo(() => (fromE ? eventPinsOf(fromE.components) : []), [fromE]);
  const actions = useMemo(() => (toE ? actionPinsOf(toE.components) : []), [toE]);
  const [mode, setMode] = useState<'signal' | 'action' | ''>('');
  const [out, setOut] = useState('');
  const [inp, setInp] = useState('');
  const [ev, setEv] = useState('');
  const [act, setAct] = useState('');
  if (!connect || !doc) return null;

  const close = (): void => store.set({ connect: null });
  const canSignal = outs.length > 0 && ins.length > 0;
  const canAction = events.length > 0 && actions.length > 0;
  const m = mode === 'signal' && canSignal ? 'signal' : mode === 'action' && canAction ? 'action' : canSignal ? 'signal' : 'action';

  if (!canSignal && !canAction) {
    return (
      <div className="modal-backdrop" onMouseDown={close}>
        <div className="dialog" role="alertdialog" aria-label="Cannot connect" data-testid="connect-impossible" onMouseDown={(e) => e.stopPropagation()}>
          <h2>These two cannot be wired</h2>
          <p>
            {outs.length === 0 && events.length === 0 && <>“{fromE?.name}” has nothing that sends a signal or announces anything. Give it a behaviour such as Clickable, Pressure Plate, Lever, Timer or Logic Gate. </>}
            {ins.length === 0 && actions.length === 0 && <>“{toE?.name}” has nothing that receives a signal or can be told what to do.</>}
            {(outs.length > 0 || events.length > 0) && (ins.length > 0 || actions.length > 0) && <>One of them only has one half of what is needed.</>}
          </p>
          <div className="row end">
            <button onClick={close}>OK</button>
          </div>
        </div>
      </div>
    );
  }

  const o = outs.some((x) => x.name === out) ? out : outs[0]?.name ?? '';
  const i = ins.some((x) => x.name === inp) ? inp : ins[0]?.name ?? '';
  const e = events.some((x) => x.id === ev) ? ev : events[0]?.id ?? '';
  const a = actions.some((x) => x.id === act) ? act : actions[0]?.id ?? '';

  const make = (): void => {
    if (m === 'signal') {
      const w = doc.addWire({ entity: connect.from, output: o }, { entity: connect.to, input: i });
      store.notify(w ? 'info' : 'warn', w ? `Connected ${fromE?.name} “${o}” to ${toE?.name} “${i}”.` : 'Those two are already connected that way.');
    } else {
      const pin = events.find((x) => x.id === e)!;
      const pick = actions.find((x) => x.id === a)!;
      connectToTarget(doc, connect.from, pin, connect.to, pick);
      store.notify('info', `When ${fromE?.name} “${pin.label}”: ${pick.label} ${toE?.name}. (Change it in the Inspector under Quick actions.)`);
    }
    close();
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="dialog" role="dialog" aria-label="Connect with a wire" data-testid="connect-dialog" onMouseDown={(ev2) => ev2.stopPropagation()}>
        <h2>Connect with a wire</h2>
        <div className="row">
          <label className="check">
            <input type="radio" name="connect-mode" data-testid="connect-mode-signal" disabled={!canSignal} checked={m === 'signal'} onChange={() => setMode('signal')} /> Pass the signal on
          </label>
          <label className="check">
            <input type="radio" name="connect-mode" data-testid="connect-mode-action" disabled={!canAction} checked={m === 'action'} onChange={() => setMode('action')} /> Make something happen
          </label>
        </div>
        {m === 'signal' ? (
          <>
            <label className="field">
              <span>{fromE?.name} sends</span>
              <select data-testid="connect-output" value={o} onChange={(x) => setOut(x.target.value)}>
                {outs.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{toE?.name} receives</span>
              <select data-testid="connect-input" value={i} onChange={(x) => setInp(x.target.value)}>
                {ins.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">{ins.find((s) => s.name === i)?.help}</p>
          </>
        ) : (
          <>
            <label className="field">
              <span>When {fromE?.name}</span>
              <select data-testid="connect-event" value={e} onChange={(x) => setEv(x.target.value)}>
                {events.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Then to {toE?.name}</span>
              <select data-testid="connect-action" value={a} onChange={(x) => setAct(x.target.value)}>
                {actions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="hint">{actions.find((s) => s.id === a)?.help}</p>
          </>
        )}
        <div className="row end">
          <button onClick={close}>Cancel</button>
          <button className="primary" data-testid="connect-ok" onClick={make}>
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
