// A stone plate: it sends its signal while the gardener or a crate rests on it.
export default defineScript({
  name: 'Plate',
  description: 'A plate in the path that sends a signal while the player stands in the middle of its cell, or a crate rests on it.',
  settings: {},
  outputs: ['active'],
  phase: 'source',
  update(me, game) {
    const cx = Math.floor(me.x);
    const cy = Math.floor(me.y);
    const on = (o: { x: number; y: number; h: number }): boolean => Math.floor(o.x) === cx && Math.floor(o.y) === cy && Math.abs(o.h - me.h) < 0.5;
    let down = false;
    const p = game.player;
    if (p && on(p)) down = true;
    for (const c of game.findAll('tag:crate')) if (on(c)) down = true;
    if (down !== me.state.down) {
      me.state.down = down;
      game.do('sound', { name: down ? 'plate_down' : 'plate_up', volume: 0.6 });
    }
    me.output('active', down);
  },
});
