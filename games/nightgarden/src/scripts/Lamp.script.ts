// A garden lamp. The gardener lights or douses it with Interact from a cell beside it (never diagonally), facing it.
// A lamp that is not hand-lit follows its Power wire instead.
export default defineScript({
  name: 'Lamp',
  description: 'A garden lamp. The player lights or douses it with Interact from a cell beside it (not diagonally); a wired lamp follows its Power signal instead.',
  settings: {
    startLit: { value: false, label: 'Lit when the room starts' },
    byHand: { value: true, label: 'The player can light and douse it', help: 'Off: it only follows its Power wire (lit while Power is on; the other way round if it starts lit).' },
    look: { value: 'lamp', label: 'Picture name', help: 'It shows <name>_on while lit and <name>_off while dark.' },
  },
  inputs: ['power'],
  outputs: ['lit'],
  phase: 'source',
  start(me) {
    me.state.on = me.settings.startLit === true;
  },
  update(me, game) {
    if (me.state.on === undefined) me.state.on = me.settings.startLit === true;
    if (me.settings.byHand) {
      // the gardener's script says which lamp is in reach and faced (the variable ng_target)
      if (game.input.pressed('interact') && game.vars.ng_target === me.id && !game.vars.ng_moving) {
        me.state.on = !me.state.on;
        game.emit('lamp', { entity: me.id, lit: me.state.on });
        game.do('sound', { name: me.state.on ? 'lamp_on' : 'lamp_off', volume: 0.7 });
      }
    } else {
      me.state.on = me.input('power') !== (me.settings.startLit === true);
    }
    const on = me.state.on === true;
    me.output('lit', on);
    // its Light shines while it is lit (a Light set to shine "while its Switch is on" with nothing wired to the switch is dark)
    const glow = me.get<{ mode: string }>('light');
    if (glow) glow.mode = on ? 'always' : 'whenOn';
    const sp = me.get<{ asset?: string; color: number }>('sprite');
    if (sp) {
      const want = `${me.settings.look}_${on ? 'on' : 'off'}`;
      if (sp.asset !== undefined && sp.asset !== want) sp.asset = want;
      sp.color = on ? 0xffd27a : 0x5a5f73;
    }
  },
});
