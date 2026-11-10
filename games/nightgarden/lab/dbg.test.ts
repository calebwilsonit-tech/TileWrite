import { it } from 'vitest';
import { parseRoom } from '../src/model';
import { CHAPTERS } from '../src/rooms';
import { Rules, type Action } from '../src/solver';
it('dbg', () => {
  const def = CHAPTERS.flatMap((c) => c.rooms).find((r) => r.id === process.env.NG_ROOM)!;
  const rules = new Rules(parseRoom(def));
  let s = rules.initial();
  const show = (label: string) => process.stdout.write(`${label}: at ${s.px},${s.py} h${rules.playerHeight(s)} grown ${s.grown.map(Number).join('')} shut ${s.shut.map(Number).join('')} chan ${s.chan.map(Number).join('')} lit ${rules.litCells(s).map(Number).join('').match(new RegExp(`.{${rules.w}}`, 'g'))!.join('/')}\n`);
  show('start');
  for (const tok of (process.env.NG_PLAN ?? '').split(' ').filter(Boolean)) {
    const a: Action = tok.startsWith('!') ? { kind: 'toggle', dir: tok[1] as never } : tok === tok.toUpperCase() ? { kind: 'push', dir: tok as never } : { kind: 'move', dir: tok.toUpperCase() as never };
    const t = rules.apply(s, a);
    if (!t) { process.stdout.write(`${tok}: CANNOT\n`); break; }
    s = t;
    show(tok);
  }
});
