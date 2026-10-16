import { useEffect, useRef, useState } from 'react';
import { startWalkingSquare, type SampleHandle } from '../../../../samples/m1-walking-square/game';

declare global {
  interface Window {
    /** Exposed for end-to-end tests. */
    __sample?: SampleHandle;
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

function SampleM1() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let handle: SampleHandle | undefined;
    let cancelled = false;
    void startWalkingSquare(host.current!).then((h) => {
      if (cancelled) h.stop();
      else {
        handle = h;
        window.__sample = h;
      }
    });
    return () => {
      cancelled = true;
      handle?.stop();
      window.__sample = undefined;
    };
  }, []);
  return (
    <div className="sample">
      <div className="sample-bar">
        <a href="#">&larr; Back</a>
        <span>M1 sample: walking square. Move with WASD / arrows, hold Shift to run.</span>
      </div>
      <div ref={host} className="sample-host" data-testid="sample-host" />
    </div>
  );
}

export function App() {
  const hash = useHash();
  if (hash === '#sample-m1') return <SampleM1 />;
  return (
    <main className="welcome" data-testid="welcome">
      <h1>Tilewright</h1>
      <p>A no-code 2D isometric game engine.</p>
      <p className="muted">Foundations (M0) - the editor shell opens. Project manager coming in M3.</p>
      <p>
        <a href="#sample-m1" data-testid="open-sample-m1">
          Open the M1 sample (walking square)
        </a>
      </p>
    </main>
  );
}
