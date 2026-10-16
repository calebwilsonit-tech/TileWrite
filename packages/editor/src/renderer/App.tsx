import { useEffect, useRef, useState } from 'react';
import { startWalkingSquare, type SampleHandle } from '../../../../samples/m1-walking-square/game';
import { startMultilevelRoom, type M2Handle } from '../../../../samples/m2-multilevel-room/game';
import { useApp, store } from './app/store';
import { EditorShell } from './app/EditorShell';
import { ProjectScreen } from './screens/ProjectScreen';
import { studio } from './studio/store';

declare global {
  interface Window {
    /** Exposed for end-to-end tests. */
    __sample?: SampleHandle | M2Handle;
    __store?: typeof store;
  }
}

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

type Starter = (parent: HTMLElement) => Promise<SampleHandle | M2Handle>;

function SampleView({ start, title, help }: { start: Starter; title: string; help: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let handle: (SampleHandle | M2Handle) | undefined;
    let cancelled = false;
    let timer: number | undefined;
    void start(host.current!).then((h) => {
      if (cancelled) {
        h.stop();
        return;
      }
      handle = h;
      window.__sample = h;
      timer = window.setInterval(() => {
        const player = h.sim.world.withTag('player')[0];
        const t = player?.get<{ h: number }>('transform');
        const st = (h as M2Handle).state;
        setStatus(`level ${t ? t.h.toFixed(2) : '-'}` + (st ? `  |  falls ${st.falls}  |  last landing ${st.lastLanding.toFixed(1)}` : ''));
      }, 100);
    });
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      handle?.stop();
      window.__sample = undefined;
    };
  }, [start]);
  return (
    <div className="sample">
      <div className="sample-bar">
        <a href="#">&larr; Back</a>
        <strong>{title}</strong>
        <span>{help}</span>
        <span className="sample-status" data-testid="status">
          {status}
        </span>
      </div>
      <div ref={host} className="sample-host" data-testid="sample-host" />
    </div>
  );
}

export function App() {
  const hash = useHash();
  const screen = useApp((s) => s.screen);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    window.__store = store;
    window.__studio = studio;
    void store.init().then(() => setReady(true));
  }, []);

  if (hash === '#sample-m1') {
    return <SampleView start={startWalkingSquare} title="M1: walking square" help="WASD / arrows to move, Shift to run" />;
  }
  if (hash === '#sample-m2') {
    return (
      <SampleView
        start={startMultilevelRoom}
        title="M2: multi-level room"
        help="WASD / arrows move, Shift run, Space jump. Cross the bridge, climb the stairs, avoid the pits."
      />
    );
  }
  if (!ready) return <main className="welcome" data-testid="welcome"><h1>Tilewright</h1></main>;
  return screen === 'editor' ? <EditorShell /> : <ProjectScreen />;
}
