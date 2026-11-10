// The way out of a room: stepping onto it marks the room as tended and leads on to the next one.
export default defineScript({
  name: 'Exit',
  description: 'The way out of a room. When the player steps onto it the room is marked as finished and the next scene opens.',
  settings: {
    room: { value: '', label: 'Room id (for the finished flag)' },
    next: { value: '', label: 'Scene to go to' },
  },
  update(me, game) {
    const p = game.player;
    if (!p || me.state.gone) return;
    if (Math.floor(p.x) !== Math.floor(me.x) || Math.floor(p.y) !== Math.floor(me.y) || Math.abs(p.h - me.h) > 0.5) return;
    if (Math.abs(p.x - me.x) > 0.3 || Math.abs(p.y - me.y) > 0.3) return;
    me.state.gone = true;
    const key = `done_${me.settings.room}`;
    if (!game.vars[key]) {
      game.vars[key] = 1;
      game.vars.ng_done = Number(game.vars.ng_done ?? 0) + 1;
    }
    game.emit('room-done', { room: String(me.settings.room) });
    game.do('sound', { name: 'room_done', volume: 0.8 });
    game.vars.ng_reach = Math.max(Number(game.vars.ng_reach ?? 1), Number(game.vars.ng_room_no ?? 1) + 1);
    if (me.settings.next) game.travel(String(me.settings.next));
    else game.do('uiScreen', { op: 'open', screen: 'The end' });
  },
});
