import { useMemo, useState } from 'react';
import { behaviorList } from '@tilewright/behaviors';
import { store, useApp } from './store';

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

/** Connect two objects: pick which signal leaves the first and which enters the second. */
export function ConnectDialog() {
  const connect = useApp((s) => s.connect);
  const outs = useMemo(() => (connect ? signalChoices(connect.from, 'outputs') : []), [connect]);
  const ins = useMemo(() => (connect ? signalChoices(connect.to, 'inputs') : []), [connect]);
  const [out, setOut] = useState('');
  const [inp, setInp] = useState('');
  const doc = store.doc;
  if (!connect || !doc) return null;
  const from = doc.getEntity(connect.from);
  const to = doc.getEntity(connect.to);

  const close = (): void => store.set({ connect: null });
  const make = (o: string, i: string): void => {
    const w = doc.addWire({ entity: connect.from, output: o }, { entity: connect.to, input: i });
    store.notify(w ? 'info' : 'warn', w ? `Connected ${from?.name} “${o}” to ${to?.name} “${i}”.` : 'Those two are already connected that way.');
    close();
  };

  if (outs.length === 0 || ins.length === 0) {
    return (
      <div className="modal-backdrop" onMouseDown={close}>
        <div className="dialog" role="alertdialog" aria-label="Cannot connect" data-testid="connect-impossible" onMouseDown={(e) => e.stopPropagation()}>
          <h2>These two cannot be wired</h2>
          <p>
            {outs.length === 0 && <>“{from?.name}” has nothing that sends a signal. Give it a behaviour such as Pressure Plate, Lever, Timer or Logic Gate. </>}
            {ins.length === 0 && <>“{to?.name}” has nothing that receives a signal. Give it a behaviour such as Gate, Spawner, Moving Platform or Logic Gate.</>}
          </p>
          <div className="row end">
            <button onClick={close}>OK</button>
          </div>
        </div>
      </div>
    );
  }

  const o = outs.some((x) => x.name === out) ? out : outs[0]!.name;
  const i = ins.some((x) => x.name === inp) ? inp : ins[0]!.name;
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="dialog" role="dialog" aria-label="Connect with a wire" data-testid="connect-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Connect with a wire</h2>
        <label className="field">
          <span>{from?.name} sends</span>
          <select data-testid="connect-output" value={o} onChange={(e) => setOut(e.target.value)}>
            {outs.map((s) => (
              <option key={s.name} value={s.name}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{to?.name} receives</span>
          <select data-testid="connect-input" value={i} onChange={(e) => setInp(e.target.value)}>
            {ins.map((s) => (
              <option key={s.name} value={s.name}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{ins.find((s) => s.name === i)?.help}</p>
        <div className="row end">
          <button onClick={close}>Cancel</button>
          <button className="primary" data-testid="connect-ok" onClick={() => make(o, i)}>
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
