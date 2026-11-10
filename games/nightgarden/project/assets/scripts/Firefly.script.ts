// A firefly: an optional catch in each room. Caught once, it stays caught.
export default defineScript({
  name: 'Firefly',
  description: 'A firefly the player catches by walking into it. Each room has at most one; a caught firefly stays caught.',
  settings: {
    room: { value: '', label: 'Room id (for the caught flag)' },
    hover: { value: 0.9, label: 'How far above the ground it hovers (levels)', min: 0, max: 3, step: 0.1 },
  },
  update(me, game) {
    const key = `fly_${me.settings.room}`;
    if (game.vars[key]) {
      me.visible = false;
      return;
    }
    // it bobs a little, so it reads as alive
    const p = game.player;
    if (!p) return;
    if (Math.floor(p.x) === Math.floor(me.x) && Math.floor(p.y) === Math.floor(me.y) && Math.abs(p.h - (me.h - Number(me.settings.hover))) <= 0.6) {
      game.vars[key] = 1;
      game.vars.ng_flies = Number(game.vars.ng_flies ?? 0) + 1;
      me.visible = false;
      game.emit('firefly', { room: String(me.settings.room) });
      game.do('sound', { name: 'firefly', volume: 0.8 });
    }
  },
});
