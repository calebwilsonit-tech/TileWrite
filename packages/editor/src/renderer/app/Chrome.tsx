import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, store } from './store';
import { COMMANDS, commandForKey, describeKeys, keysFor, viewportRef, type Command } from './commands';
import { eventKeySpec, findConflicts, formatKeySpec, isModifierOnly } from './keys';
import { isTyping } from '../viewport/controller';

/** Shortcut overrides saved in settings, shared by the dispatcher, palette and shortcut editor. */
export function useShortcuts(): [Record<string, string>, (id: string, keys: string | null) => void] {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  useEffect(() => {
    void window.tilewright.settings.get().then((s) => {
      if (s.shortcuts && typeof s.shortcuts === 'object') setOverrides(s.shortcuts as Record<string, string>);
    });
  }, []);
  const set = (id: string, keys: string | null): void => {
    setOverrides((cur) => {
      const next = { ...cur };
      if (keys === null) delete next[id];
      else next[id] = keys;
      void store.saveSetting('shortcuts', next);
      return next;
    });
  };
  return [overrides, set];
}

/** One global key handler: tool keys first, then commands. Typing in a field is never hijacked. */
export function useKeyDispatcher(overrides: Record<string, string>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (store.state.screen !== 'editor') return;
      if (isTyping(e)) return;
      if (e.repeat && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (store.state.mode === 'play') {
        const play = commandForKey(e, overrides);
        if (play && play.category === 'Play') {
          e.preventDefault();
          play.run();
        }
        return;
      }
      const vp = viewportRef.current;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && vp?.toolKey(e.key)) {
        e.preventDefault();
        return;
      }
      const cmd = commandForKey(e, overrides);
      if (cmd) {
        e.preventDefault();
        cmd.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overrides]);
}

export function Toasts() {
  const notices = useApp((s) => s.notices);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`toast ${n.kind}`} data-testid="toast">
          {n.text}
        </div>
      ))}
    </div>
  );
}

export function StatusBar() {
  const tool = useApp((s) => s.tool);
  useApp((s) => s.docVersion);
  const mode = useApp((s) => s.mode);
  const doc = store.doc;
  const vp = viewportRef.current;
  const cell = vp?.hoverCell;
  const info =
    doc && cell && doc.map.inBounds(cell.x, cell.y)
      ? `Cell (${cell.x}, ${cell.y})  level ${doc.map.getHeight(cell.x, cell.y)}${doc.map.getSlope(cell.x, cell.y) ? ' (stairs/ramp)' : ''}`
      : '';
  return (
    <footer className="statusbar" data-testid="statusbar">
      <span>{mode === 'play' ? 'Playing' : `Tool: ${tool}`}</span>
      <span>{info}</span>
      <span className="grow" />
      <span>{doc ? `${doc.map.width} x ${doc.map.height} cells` : ''}</span>
      <span data-testid="dirty">{doc?.dirty ? 'Unsaved changes' : 'Saved'}</span>
    </footer>
  );
}

export function CommandPalette({ overrides }: { overrides: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const show = (): void => {
      setOpen(true);
      setQ('');
      setSel(0);
    };
    document.addEventListener('tw:palette', show);
    return () => document.removeEventListener('tw:palette', show);
  }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return COMMANDS.filter((c) => (c.enabled?.() ?? true) && !/\(alternate\)|Backspace|Escape\)/.test(c.label))
      .filter((c) => !needle || `${c.category} ${c.label}`.toLowerCase().includes(needle))
      .slice(0, 12);
  }, [q, open]);

  if (!open) return null;
  const run = (c: Command | undefined): void => {
    setOpen(false);
    c?.run();
  };
  return (
    <div className="modal-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" data-testid="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          data-testid="palette-input"
          placeholder="Type a command…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSel((s) => Math.min(list.length - 1, s + 1));
            else if (e.key === 'ArrowUp') setSel((s) => Math.max(0, s - 1));
            else if (e.key === 'Enter') run(list[sel]);
            else if (e.key === 'Escape') setOpen(false);
            else return;
            e.preventDefault();
          }}
        />
        <ul>
          {list.map((c, i) => (
            <li key={c.id} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
              <span className="cat">{c.category}</span>
              <span>{c.label}</span>
              <kbd>{describeKeys(keysFor(c, overrides))}</kbd>
            </li>
          ))}
          {list.length === 0 && <li className="none">No command matches.</li>}
        </ul>
      </div>
    </div>
  );
}

export function ShortcutsDialog({ overrides, setKeys }: { overrides: Record<string, string>; setKeys(id: string, keys: string | null): void }) {
  const [open, setOpen] = useState(false);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const show = (): void => setOpen(true);
    document.addEventListener('tw:shortcuts', show);
    return () => document.removeEventListener('tw:shortcuts', show);
  }, []);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (isModifierOnly(e.key)) return;
      if (e.key === 'Escape') {
        setCapturing(null);
        return;
      }
      setKeys(capturing, formatKeySpec(eventKeySpec(e)));
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, setKeys]);

  if (!open) return null;
  const bindings = Object.fromEntries(COMMANDS.map((c) => [c.id, keysFor(c, overrides)]));
  const conflicts = new Set(findConflicts(bindings).flat());
  const rows = COMMANDS.filter((c) => !filter || `${c.category} ${c.label}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="modal-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="dialog wide" role="dialog" aria-label="Keyboard shortcuts" data-testid="shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <input className="search" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter shortcuts" />
        <div className="shortcut-list">
          <table>
            <tbody>
              {rows.map((c) => {
                const k = keysFor(c, overrides);
                const changed = c.id in overrides;
                return (
                  <tr key={c.id} className={conflicts.has(c.id) && k ? 'conflict' : ''}>
                    <td className="cat">{c.category}</td>
                    <td>{c.label}</td>
                    <td>
                      <kbd data-testid={`keys-${c.id}`}>{capturing === c.id ? 'Press a key…' : describeKeys(k) || 'none'}</kbd>
                    </td>
                    <td>
                      <button data-testid={`rebind-${c.id}`} onClick={() => setCapturing(c.id)}>
                        Change
                      </button>
                      {changed && <button onClick={() => setKeys(c.id, null)}>Reset</button>}
                      {conflicts.has(c.id) && k && <span className="warn-text"> also used by another command</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row end">
          <button onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function NewSceneDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('New scene');
  useEffect(() => {
    const show = (): void => {
      setName('New scene');
      setOpen(true);
    };
    document.addEventListener('tw:new-scene', show);
    return () => document.removeEventListener('tw:new-scene', show);
  }, []);
  if (!open) return null;
  const go = (): void => {
    setOpen(false);
    void store.newSceneInProject(name);
  };
  return (
    <div className="modal-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="dialog" role="dialog" aria-label="New scene" onMouseDown={(e) => e.stopPropagation()}>
        <h2>New scene</h2>
        <label className="field">
          <span>Name</span>
          <input autoFocus data-testid="new-scene-name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        </label>
        <div className="row end">
          <button onClick={() => setOpen(false)}>Cancel</button>
          <button className="primary" data-testid="new-scene-ok" onClick={go}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export function RecoveryDialog() {
  const recovery = useApp((s) => s.recovery);
  if (!recovery) return null;
  return (
    <div className="modal-backdrop">
      <div className="dialog" role="alertdialog" aria-label="Recover unsaved work" data-testid="recovery">
        <h2>Recover unsaved changes?</h2>
        <p>Tilewright found changes to this scene that were never saved, probably because it closed unexpectedly. Do you want to get them back?</p>
        <div className="row end">
          <button data-testid="recovery-discard" onClick={() => void store.discardRecovery()}>
            Discard them
          </button>
          <button className="primary" data-testid="recovery-accept" onClick={() => store.acceptRecovery()}>
            Recover
          </button>
        </div>
      </div>
    </div>
  );
}
