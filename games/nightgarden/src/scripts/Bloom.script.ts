// A night-garden flower bed. A moonbloom rises into a tall, solid stalk while its bed is lit and sinks back
// in the dark; a duskcap does the opposite. Whoever stands in the middle of the bed rides it up and down.
export default defineScript({
  name: 'Bloom',
  description: 'A flower bed that rises into a tall solid stalk while it is lit (a moonbloom) or while it is dark (a duskcap), and sinks back otherwise. Whoever stands on the bed rides it.',
  settings: {
    kind: { value: 'moonbloom', label: 'Kind', options: ['moonbloom', 'duskcap'], help: 'A moonbloom rises in light. A duskcap rises in the dark.' },
    height: { value: 2, label: 'Full height (levels)', min: 1, max: 4, step: 1 },
    seconds: { value: 0.5, label: 'Seconds to rise or sink', min: 0.1, max: 5, step: 0.1 },
  },
  outputs: ['grown'],
  phase: 'actuator',
  start(me) {
    me.state.p = 0;
    me.state.first = true;
  },
  update(me, game) {
    if (me.state.p === undefined) me.state.p = 0;
    const lit = String(game.vars.ng_lit ?? '')[Math.floor(me.y) * Number(game.vars.ng_w ?? 0) + Math.floor(me.x)] === '1';
    const want = (me.settings.kind === 'moonbloom') === lit;
    if (me.state.first !== false) {
      // the first update comes before the lights have been worked out: wait one, then a bed that should be up is up already
      if (me.state.first === true) {
        me.state.first = 'next';
        return;
      }
      me.state.first = false;
      me.state.p = want ? 1 : 0;
    }
    const p0 = me.state.p as number;
    const col = me.get<{ w: number; d: number; height: number }>('collider');
    const who = game.player;
    if (want && p0 < 0.1 && who && col) {
      // someone half on the bed is eased off it (only the middle of the bed carries a rider)
      const dx = who.x - me.x;
      const dy = who.y - me.y;
      const reach = col.w / 2 + 0.3;
      const level = who.h >= me.h - 0.1 && who.h <= me.h + 0.6;
      if (level && Math.abs(dx) < reach && Math.abs(dy) < reach && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
        if (Math.abs(dx) >= Math.abs(dy)) who.x = me.x + Math.sign(dx) * (reach + 0.02);
        else who.y = me.y + Math.sign(dy) * (reach + 0.02);
      }
    }
    const step = game.dt / Math.max(0.05, Number(me.settings.seconds));
    const p = Math.min(1, Math.max(0, p0 + (want ? step : -step)));
    me.state.p = p;
    const height = Math.max(0.2, p * Number(me.settings.height));
    if (col) col.height = height;
    const sp = me.get<{ asset?: string; height: number }>('sprite');
    if (sp) {
      sp.height = height;
      const stage = p <= 0 ? 0 : p < 0.5 ? 1 : p < 1 ? 2 : 3;
      const want2 = `${me.settings.kind}_${stage}`;
      if (sp.asset !== undefined && sp.asset !== want2) sp.asset = want2;
    }
    me.output('grown', p >= 1);
    if (p !== p0 && (p === 1 || p === 0)) game.emit('bloom', { entity: me.id, grown: p === 1 });
  },
});
