import type { WidgetDef } from '@tilewright/plugin-sdk';
import { itemsOf, quickSlots } from './items';

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** The four quick slots: the key that uses each, the item in it and how many. Shown only once an item has been put in one. */
export const quickSlotsWidget: WidgetDef = {
  id: 'quick-slots',
  hud: { piece: 'slots', name: 'Quick slots', order: 2 },
  label: 'Quick slots (the items on the number keys)',
  defaults: { w: 200, h: 48, wMode: 'auto', hMode: 'auto' },
  css: `.tw-slots { display: flex; gap: 6px; text-shadow: 0 1px 3px #000; }
.tw-slot { width: 44px; height: 44px; border: 2px solid #ffffff55; border-radius: min(var(--tw-radius, 10px), 14px); background: color-mix(in srgb, var(--tw-panel, #14161b) 80%, transparent); display: flex; align-items: center; justify-content: center; position: relative; font-size: 11px; }
.tw-slot .key { position: absolute; top: 1px; left: 4px; opacity: .7; }
.tw-slot .count { position: absolute; bottom: 1px; right: 4px; }
.tw-slot .gem { width: 20px; height: 20px; border-radius: 5px; }`,
  render(el, _node, _values, ctx) {
    el.classList.add('tw-slots');
    const sim = ctx?.sim;
    if (!sim) return;
    const slots = quickSlots(sim.runtime.vars);
    const sig = JSON.stringify(slots.map((id) => [id, id ? sim.runtime.vars[`item:${id}`] : 0]));
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.replaceChildren();
    if (!slots.some(Boolean)) return;
    slots.forEach((id, i) => {
      const s = document.createElement('div');
      s.className = 'tw-slot';
      s.setAttribute('data-testid', `tw-slot-${i + 1}`);
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(i + 1);
      s.appendChild(key);
      if (id) {
        const def = itemsOf(sim.assets).get(id);
        const gem = document.createElement('div');
        gem.className = 'gem';
        gem.style.background = hex(def?.color ?? 0xcccccc);
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = String(sim.runtime.vars[`item:${id}`] ?? 0);
        s.append(gem, count);
        s.title = def?.name ?? id;
      }
      el.appendChild(s);
    });
  },
};
