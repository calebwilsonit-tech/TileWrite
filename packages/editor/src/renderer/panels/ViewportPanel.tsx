import { useEffect, useRef } from 'react';
import { host } from '@tilewright/behaviors';
import { bindingLabel } from '@tilewright/runtime';
import { useApp, store } from '../app/store';
import { viewportRef } from '../app/commands';
import { ViewportController } from '../viewport/controller';

/** The keys of the buttons the plugins that are on added (", J attacks, Q dodges"). */
function pluginKeys(): string {
  return Object.values(host.inputActions())
    .map((a) => {
      const key = a.bindings.find((b) => b.startsWith('key:'));
      return key ? `, ${bindingLabel(key)} ${a.label.toLowerCase()}` : '';
    })
    .join('');
}

export function ViewportPanel() {
  const host = useRef<HTMLDivElement>(null);
  const mode = useApp((s) => s.mode);
  const paused = useApp((s) => s.paused);
  const logicHit = useApp((s) => s.logicHit);

  useEffect(() => {
    const vp = new ViewportController();
    let cancelled = false;
    void vp.mount(host.current!).then(() => {
      if (cancelled) return;
      viewportRef.current = vp;
      window.__viewport = vp;
      if (store.doc) vp.setDoc(store.doc);
    });
    return () => {
      cancelled = true;
      viewportRef.current = null;
      window.__viewport = undefined;
      vp.dispose();
    };
  }, []);

  return (
    <div className="viewport-wrap">
      <div ref={host} className="viewport-host" data-testid="viewport" tabIndex={0} />
      {mode === 'play' && logicHit && (
        <div className="play-badge logic-break" data-testid="logic-break" role="status">
          Stopped at a breakpoint: {logicHit.text}.{' '}
          <button data-testid="logic-break-resume" onClick={() => store.togglePause()}>
            Resume
          </button>{' '}
          <button data-testid="logic-break-step" onClick={() => store.step()}>
            Step
          </button>
        </div>
      )}
      {mode === 'play' && !logicHit && (
        <div className="play-badge" data-testid="play-badge">
          {paused ? 'Paused' : 'Playing'}: WASD / arrows move, Shift runs, Space jumps, E interacts{pluginKeys()}, P pauses. Esc stops.
        </div>
      )}
    </div>
  );
}
