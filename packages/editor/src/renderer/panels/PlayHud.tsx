import { useEffect, useState } from 'react';
import { healthOf } from '@tilewright/behaviors';

interface Hud {
  player: { hp: number; max: number } | null;
  bosses: { name: string; hp: number; max: number }[];
}

function read(): Hud {
  const sim = window.__play?.sim;
  if (!sim) return { player: null, bosses: [] };
  const p = sim.world.withTag('player')[0];
  const ph = p ? healthOf(p) : undefined;
  const bosses: Hud['bosses'] = [];
  for (const b of sim.world.withTag('boss')) {
    const h = healthOf(b);
    const active = (b.get<{ outputs: Record<string, boolean> }>('signals')?.outputs.active ?? true) !== false;
    if (h && !h.dead && active) bosses.push({ name: b.name, hp: h.hp, max: h.max });
  }
  return { player: ph ? { hp: ph.hp, max: ph.max } : null, bosses };
}

/** Hearts for the player and a bar for any boss that is fighting, drawn over the game while it plays. */
export function PlayHud() {
  const [hud, setHud] = useState<Hud>(read);
  useEffect(() => {
    const id = window.setInterval(() => setHud(read()), 100);
    return () => window.clearInterval(id);
  }, []);
  if (!hud.player && hud.bosses.length === 0) return null;
  return (
    <div className="play-hud" data-testid="play-hud">
      {hud.player && (
        <div className="hud-hearts" data-testid="hud-hearts" aria-label={`Health ${hud.player.hp} of ${hud.player.max}`}>
          {Array.from({ length: Math.ceil(hud.player.max) }, (_, i) => (
            <span key={i} className={i < Math.ceil(hud.player!.hp) ? 'heart full' : 'heart empty'}>
              {i < Math.ceil(hud.player!.hp) ? '♥' : '♡'}
            </span>
          ))}
        </div>
      )}
      {hud.bosses.map((b) => (
        <div key={b.name} className="hud-boss" data-testid="hud-boss">
          <span>{b.name}</span>
          <div className="bar">
            <div className="fill" style={{ width: `${Math.max(0, (b.hp / b.max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
