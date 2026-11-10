// A moonstone sends its signal while its spot is lit; a shadestone while it is dark. Wire it to a gate or a lamp.
export default defineScript({
  name: 'Moonstone',
  description: 'A stone set in the path that sends a signal while its spot is lit (a moonstone) or while it is dark (a shadestone).',
  settings: {
    whenDark: { value: false, label: 'Sends while it is DARK (a shadestone)' },
  },
  outputs: ['active'],
  phase: 'source',
  update(me, game) {
    if (me.state.ready === undefined) {
      me.state.ready = false; // the first update comes before the lights have been worked out
      me.output('active', false);
      return;
    }
    me.output('active', String(game.vars.ng_lit ?? '')[Math.floor(me.y) * Number(game.vars.ng_w ?? 0) + Math.floor(me.x)] === '1' !== (me.settings.whenDark === true));
  },
});
