import { useEffect, useState } from 'react';
import { api } from '../project/api';
import { DEFAULT_ACCESSIBILITY, ZOOMS, applyAccessibility, cleanAccessibility, type Accessibility } from './accessibility';
import { store } from './store';

/** Text size, colour-blind-safe colours and less motion. Changes apply at once and are remembered. */
export function AccessibilityDialog() {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState<Accessibility>(DEFAULT_ACCESSIBILITY);

  useEffect(() => {
    const show = (): void => {
      setOpen(true);
      void api().settings.get().then((s) => setA(cleanAccessibility(s.accessibility)));
    };
    document.addEventListener('tw:accessibility', show);
    return () => document.removeEventListener('tw:accessibility', show);
  }, []);

  if (!open) return null;
  const change = (patch: Partial<Accessibility>): void => {
    const next = cleanAccessibility({ ...a, ...patch });
    setA(next);
    applyAccessibility(next);
    void store.saveSetting('accessibility', next);
  };
  return (
    <div className="modal-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="dialog" role="dialog" aria-label="Accessibility" data-testid="accessibility-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Accessibility</h2>
        <label className="field">
          <span>Size of everything in the window</span>
          <select data-testid="acc-zoom" value={a.zoom} onChange={(e) => change({ zoom: Number(e.target.value) })}>
            {ZOOMS.map((z) => (
              <option key={z} value={z}>
                {Math.round(z * 100)}%
              </option>
            ))}
          </select>
        </label>
        <label className="field check">
          <input data-testid="acc-colourblind" type="checkbox" checked={a.colourBlind} onChange={(e) => change({ colourBlind: e.target.checked })} />
          <span>Colour-blind-safe colours for overlays (walkable, blocked, water, stairs...)</span>
        </label>
        <label className="field check">
          <input data-testid="acc-motion" type="checkbox" checked={a.reduceMotion} onChange={(e) => change({ reduceMotion: e.target.checked })} />
          <span>Less motion in the editor (no pulsing)</span>
        </label>
        <p className="hint">Every key in the editor can be changed under Shortcuts, and the game&rsquo;s own controls can be remapped from its pause menu (Settings, Controls).</p>
        <div className="row end">
          <button className="primary" data-testid="acc-close" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
