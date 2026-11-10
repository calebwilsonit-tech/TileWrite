import { it } from 'vitest';
import { parseRoom } from '../src/model';
import { CHAPTERS } from '../src/rooms';
import { Rules, describe, solve } from '../src/solver';

/** A quick look at every room by the rules alone (no game): is it solvable, and how long is the way? */
it('rooms by the rules', () => {
  const only = process.env.NG_ROOM;
  for (const c of CHAPTERS) {
    for (const def of c.rooms) {
      if (only && !def.id.startsWith(only)) continue;
      let line: string;
      try {
        const rules = new Rules(parseRoom(def));
        const out = solve(rules);
        const fly = rules.firefly ? solve(rules, { firefly: true }) : null;
        line = out ? `${out.actions.length} steps, ${out.actions.filter((a) => a.kind === 'toggle').length} lamps, ${out.actions.filter((a) => a.kind === 'push').length} pushes, ${out.states} states${rules.firefly ? `, firefly ${fly ? fly.actions.length : 'IMPOSSIBLE'}` : ''}\n      ${describe(out.actions)}${fly ? `\n      fly: ${describe(fly.actions)}` : ''}` : 'NO WAY OUT';
      } catch (e) {
        line = `ERROR ${(e as Error).message}`;
      }
      process.stdout.write(`${def.id} ${def.name}: ${line}\n`);
    }
  }
});
