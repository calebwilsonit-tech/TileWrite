// A garden gate: open while its Open wire says so, shut otherwise. It never shuts on something standing in its
// doorway (the gardener, a crate): it waits until the doorway is clear, and eases off anyone half inside.
export default defineScript({
  name: 'Gate',
  description: 'A gate that opens while its Open signal is on (or off, if turned round). It never closes on whoever stands in the doorway: it waits until they have left.',
  settings: {
    openWhenOff: { value: false, label: 'Open while the signal is OFF' },
    height: { value: 2, label: 'Height when shut (levels)', min: 1, max: 4, step: 0.5 },
    seconds: { value: 0.25, label: 'Seconds to open or shut', min: 0.05, max: 3, step: 0.05 },
  },
  inputs: ['open'],
  outputs: ['isOpen', 'shut'],
  phase: 'actuator',
  update(me, game) {
    if (me.state.open === undefined) {
      me.state.open = -1; // the first update comes before the wires have settled: wait one
      return;
    }
    const wantOpen = me.input('open') !== (me.settings.openWhenOff === true);
    if (me.state.open === -1) me.state.open = wantOpen ? 1 : 0;
    let open = me.state.open as number;
    const cx = Math.floor(me.x);
    const cy = Math.floor(me.y);
    let held = false;
    const p = game.player;
    const inDoorway = (o: { x: number; y: number; h: number }): boolean => Math.floor(o.x) === cx && Math.floor(o.y) === cy && o.h < me.h + 1;
    if (p && inDoorway(p)) held = true;
    for (const c of game.findAll('tag:crate')) if (inDoorway(c)) held = true;
    const shut = !wantOpen && !held;
    const col = me.get<{ height: number; enabled: boolean }>('collider');
    if (shut && col && !col.enabled && p && p.h < me.h + 1) {
      // someone half in the doorway (their middle is outside it) is eased out as it shuts
      const dx = p.x - me.x;
      const dy = p.y - me.y;
      if (Math.abs(dx) < 0.8 && Math.abs(dy) < 0.8) {
        if (Math.abs(dx) >= Math.abs(dy)) p.x = me.x + Math.sign(dx) * 0.82;
        else p.y = me.y + Math.sign(dy) * 0.82;
      }
    }
    // it is a wall from the moment it starts to shut and a doorway from the moment it starts to open; only the picture takes time
    const full = Number(me.settings.height);
    if (col) {
      col.enabled = shut;
      col.height = full;
    }
    const step = game.dt / Math.max(0.05, Number(me.settings.seconds));
    open = shut ? Math.max(0, open - step) : Math.min(1, open + step);
    me.state.open = open;
    const sp = me.get<{ height: number; asset?: string }>('sprite');
    if (sp) {
      sp.height = Math.max(0.05, full * (1 - open));
      const want = open >= 1 ? 'gate_open' : open <= 0 ? 'gate_shut' : 'gate_half';
      if (sp.asset !== undefined && sp.asset !== want) sp.asset = want;
    }
    me.output('shut', shut);
    me.output('isOpen', open >= 1);
  },
});
