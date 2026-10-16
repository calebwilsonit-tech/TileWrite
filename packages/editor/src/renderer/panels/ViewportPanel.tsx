import { useEffect, useRef } from 'react';
import { useApp, store } from '../app/store';
import { viewportRef } from '../app/commands';
import { ViewportController } from '../viewport/controller';

export function ViewportPanel() {
  const host = useRef<HTMLDivElement>(null);
  const mode = useApp((s) => s.mode);
  const paused = useApp((s) => s.paused);

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
      {mode === 'play' && (
        <div className="play-badge" data-testid="play-badge">
          {paused ? 'Paused' : 'Playing'}: WASD / arrows move, Shift runs, Space jumps. Esc stops.
        </div>
      )}
    </div>
  );
}
