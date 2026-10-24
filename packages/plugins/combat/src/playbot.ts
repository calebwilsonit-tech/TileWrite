import { C, type ActionSnapshot, type TransformIso, type Bot, type PlayReport, type WalkOptions, formatTime } from '@tilewright/plugin-sdk';
import { healthOf } from './combat';

type ReportKind = PlayReport['kind'];

/**
 * Fight something with the quill and the movement buttons: walk up to it, swing when it is close, repeat until it is
 * defeated or gone. Gives up when the player is defeated or time runs out.
 */
export function fight(bot: Bot, ref: string, opts: WalkOptions = {}): PlayReport {
  const start = bot.game.sim.tick;
  const maxTicks = Math.round((opts.maxSeconds ?? 90) * 60);
  const first = bot.game.find(ref);
  const label = opts.label ?? (first ? `"${first.name}"` : ref);
  const done = (kind: ReportKind, message: string, ok = false): PlayReport => ({ ok, kind, seconds: (bot.game.sim.tick - start) / 60, message, at: { ...bot.pos() } });
  if (!first) return done('blocked', `There is nothing matching "${ref}" to fight.`);
  while (bot.game.sim.tick - start < maxTicks) {
    const target = bot.game.find(ref);
    if (!target || (healthOf(target)?.dead ?? false)) return done('reached', `Defeated ${label} in ${formatTime((bot.game.sim.tick - start) / 60)}.`, true);
    if (healthOf(bot.game.player)?.dead) return done('died', `The player was defeated fighting ${label}.`);
    if (bot.game.sim.runtime.dialogue || bot.game.sim.runtime.cutscene) {
      bot.press('interact');
      continue;
    }
    const tt = target.require<TransformIso>(C.Transform);
    const me = bot.pos();
    const dx = tt.x - me.x;
    const dy = tt.y - me.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 4) {
      // far away: walk round whatever is in the way first
      const r = bot.walkTo({ x: tt.x, y: tt.y }, { arrive: 3, maxSeconds: 4, label });
      if (!r.ok && r.kind !== 'timeout') return done(r.kind, r.message);
      continue;
    }
    const snap: ActionSnapshot = {};
    if (dist > 1.3) {
      // a direction on the map is a pair of screen keys
      const sx = (dx - dy) / 2;
      const sy = (dx + dy) / 2;
      if (sx > 0.25) snap.move_right = 1;
      if (sx < -0.25) snap.move_left = 1;
      if (sy > 0.25) snap.move_down = 1;
      if (sy < -0.25) snap.move_up = 1;
    }
    if (dist < 1.9 && (bot.game.sim.tick - start) % 24 === 0) snap.attack = 1;
    bot.step(snap);
  }
  return done('timeout', `Did not defeat ${label} within ${formatTime(opts.maxSeconds ?? 90)}.`);
}

