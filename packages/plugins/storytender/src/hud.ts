import type { WidgetDef } from '@tilewright/plugin-sdk';

/** The lantern's fuel: a bar that is full while the lantern is, and turns orange when it is nearly out. Shown only while the player carries a light. */
export const lightBarWidget: WidgetDef = {
  id: 'light-bar',
  hud: { piece: 'lightbar', name: 'Light bar', order: 1 },
  label: 'Light bar (how much light the lantern has left)',
  defaults: { w: 160, h: 12, wMode: 'auto', hMode: 'auto' },
  css: `.tw-lightbar { width: 160px; height: 10px; background: #1b1d24; border: 1px solid #000; border-radius: 6px; overflow: hidden; }
.tw-lightbar .fill { height: 100%; background: linear-gradient(90deg, #d9a21a, #ffe27a); }
.tw-lightbar.low .fill { background: linear-gradient(90deg, #8a3a1a, #d9701a); }`,
  render(el, _node, _values, ctx) {
    el.classList.add('tw-lightbar');
    el.setAttribute('data-testid', 'tw-lightbar');
    const sim = ctx?.sim;
    const player = sim?.world.withTag('player')[0];
    const percent = sim && player?.has('lightResource') ? Math.round(((Number(sim.runtime.vars.light) || 0) / Math.max(1, Number(sim.runtime.vars.lightMax) || 100)) * 100) : null;
    const sig = String(percent);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.replaceChildren();
    el.style.display = percent === null ? 'none' : 'block';
    if (percent === null) return;
    el.setAttribute('aria-label', `Light ${percent} percent`);
    el.classList.toggle('low', percent <= 25);
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    el.appendChild(fill);
  },
};
