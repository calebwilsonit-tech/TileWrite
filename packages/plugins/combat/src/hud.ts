import type { WidgetDef } from '@tilewright/plugin-sdk';
import { healthOf } from './combat';

/**
 * Pieces of the heads-up display that show health. They are widgets for the UI designer like any other: the game's
 * HUD screen uses them, and a project can place them anywhere on its own screens.
 */

const SHADOW = 'text-shadow: 0 1px 3px #000;';

export const heartsWidget: WidgetDef = {
  id: 'hearts',
  label: 'Hearts (the player’s health)',
  defaults: { w: 160, h: 30, wMode: 'auto', hMode: 'auto' },
  css: `.tw-hearts { font-size: 22px; letter-spacing: 3px; ${SHADOW} } .tw-hearts .full { color: #ff5d6c; } .tw-hearts .empty { color: #8a8f9c; }`,
  render(el, _node, _values, ctx) {
    el.classList.add('tw-hearts');
    el.setAttribute('data-testid', 'tw-hearts');
    const player = ctx?.sim.world.withTag('player')[0];
    const h = player ? healthOf(player) : undefined;
    const sig = h ? `${h.hp}/${h.max}` : '';
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.replaceChildren();
    if (!h) return;
    el.setAttribute('aria-label', `Health ${h.hp} of ${h.max}`);
    for (let i = 0; i < Math.ceil(h.max); i++) {
      const full = i < Math.ceil(h.hp);
      const heart = document.createElement('span');
      heart.className = full ? 'full' : 'empty';
      heart.textContent = full ? '♥' : '♡';
      el.appendChild(heart);
    }
  },
};

export const bossBarsWidget: WidgetDef = {
  id: 'boss-bars',
  label: 'Boss health bars (one for each boss that is awake)',
  defaults: { w: 400, h: 40, wMode: 'fill', hMode: 'auto' },
  css: `.tw-bosses { ${SHADOW} }
.tw-bosses-inner { display: flex; flex-direction: column; gap: 6px; align-items: center; margin: 0 auto; width: min(60%, 480px); }
.tw-bosses[data-pinned] .tw-bosses-inner { width: 100%; }
.tw-boss { width: 100%; text-align: center; font-size: 13px; }
.tw-boss .bar { height: 10px; background: #1b1d24; border: 1px solid #000; border-radius: 6px; overflow: hidden; margin-top: 3px; }
.tw-boss .fill { height: 100%; background: linear-gradient(90deg, #b3366e, #e0566b); }`,
  render(el, node, _values, ctx) {
    el.classList.add('tw-bosses');
    // spread across the top of the screen when it fills the width; a box of its own when it is given a size
    if (node.wMode === 'fill') delete el.dataset.pinned;
    else el.dataset.pinned = '1';
    const sim = ctx?.sim;
    const bosses = (sim?.world.withTag('boss') ?? []).filter((b) => {
      const bh = healthOf(b);
      const active = (b.get<{ outputs: Record<string, boolean> }>('signals')?.outputs.active ?? true) !== false;
      return bh && !bh.dead && active;
    });
    const sig = JSON.stringify(bosses.map((b) => [b.name, healthOf(b)?.hp]));
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const inner = document.createElement('div');
    inner.className = 'tw-bosses-inner';
    el.replaceChildren(inner);
    for (const b of bosses) {
      const bh = healthOf(b)!;
      const box = document.createElement('div');
      box.className = 'tw-boss';
      box.setAttribute('data-testid', 'tw-boss');
      const name = document.createElement('span');
      name.textContent = b.name;
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.width = `${Math.max(0, (bh.hp / bh.max) * 100)}%`;
      bar.appendChild(fill);
      box.append(name, bar);
      inner.appendChild(box);
    }
  },
};
