// Shows one picture while one of the object's own signals is on and another while it is off
// (a pressure plate that is down, a moonstone that is glowing).
export default defineScript({
  name: 'Shows',
  description: 'Shows one picture while a signal this object sends is on, and another while it is off (a plate that is down, a moonstone that glows).',
  settings: {
    signal: { value: 'active', label: 'Signal this object sends' },
    on: { value: '', label: 'Picture while it is on' },
    off: { value: '', label: 'Picture while it is off' },
  },
  phase: 'actuator',
  update(me) {
    const sp = me.get<{ asset?: string }>('sprite');
    if (!sp) return;
    const want = String(me.isOutputOn(String(me.settings.signal)) ? me.settings.on : me.settings.off);
    if (want && sp.asset !== want) sp.asset = want;
  },
});
