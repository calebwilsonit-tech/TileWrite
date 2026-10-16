import { C, type TransformIso } from '../scene/components';
import type { Simulation } from './simulation';
import { SystemError } from './profiler';

/**
 * What to show (and write to a log) when the game stops because of an error: plain-English headline, the
 * technical detail, and a snapshot of the state around it so the cause can be found.
 */
export interface CrashReport {
  /** One sentence a designer can read. */
  headline: string;
  /** The error message itself. */
  message: string;
  stack: string;
  /** Which step of the game failed (a system, or a behaviours phase). */
  system?: string;
  /** The object it was working on, if known. */
  entity?: { id: number; name: string; sceneId?: string; x?: number; y?: number };
  snapshot: {
    tick: number;
    seconds: number;
    scene: string;
    objects: number;
    player?: { x: number; y: number; h: number; hp?: number };
    variables: Record<string, unknown>;
    recentEvents: string[];
  };
}

export function crashReport(sim: Simulation, error: unknown): CrashReport {
  const sys = error instanceof SystemError ? error : undefined;
  const original = sys?.original ?? error;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? message) : String(error);
  const player = sim.world.withTag('player')[0];
  const pt = player?.get<TransformIso>(C.Transform);
  const culprit = sys?.entityId !== undefined ? sim.world.get(sys.entityId) : undefined;
  const ct = culprit?.get<TransformIso>(C.Transform);
  const vars: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sim.runtime.vars).slice(0, 30)) vars[k] = v;
  const what = original instanceof Error ? original.message : String(original);
  return {
    headline: culprit
      ? `The game stopped because "${culprit.name}" went wrong: ${what}`
      : sys
        ? `The game stopped in its "${sys.system}" step: ${what}`
        : `The game stopped because something went wrong: ${what}`,
    message,
    stack,
    system: sys?.system,
    entity: culprit ? { id: culprit.id, name: culprit.name, sceneId: culprit.get<{ sceneId: string }>('meta')?.sceneId, x: ct?.x, y: ct?.y } : undefined,
    snapshot: {
      tick: sim.tick,
      seconds: sim.tick / 60,
      scene: sim.runtime.scene,
      objects: sim.world.count,
      player: pt ? { x: pt.x, y: pt.y, h: pt.h, hp: player?.get<{ hp: number }>('state:health')?.hp } : undefined,
      variables: vars,
      recentEvents: sim.events.recent.slice(-12).map((e) => e.type),
    },
  };
}

/** The report as text, for copying into a message or writing to a log file. */
export function formatCrashReport(r: CrashReport): string {
  const lines = [
    r.headline,
    '',
    `Tick ${r.snapshot.tick} (${r.snapshot.seconds.toFixed(1)} s) in ${r.snapshot.scene || 'an unnamed scene'}, ${r.snapshot.objects} objects.`,
    r.entity ? `Object: "${r.entity.name}"${r.entity.sceneId ? ` (${r.entity.sceneId})` : ''}${r.entity.x !== undefined ? ` at (${r.entity.x.toFixed(1)}, ${r.entity.y!.toFixed(1)})` : ''}` : '',
    r.snapshot.player ? `Player: (${r.snapshot.player.x.toFixed(1)}, ${r.snapshot.player.y.toFixed(1)})${r.snapshot.player.hp !== undefined ? `, ${r.snapshot.player.hp} hit points` : ''}` : '',
    `Variables: ${JSON.stringify(r.snapshot.variables)}`,
    `Recent events: ${r.snapshot.recentEvents.join(', ') || '(none)'}`,
    '',
    'Technical details:',
    r.stack,
  ];
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n');
}
