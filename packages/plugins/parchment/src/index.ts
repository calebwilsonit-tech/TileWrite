import { definePlugin, type PluginDefinition, type UiNode, type UiScreen, type WidgetDef } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };

/**
 * The Parchment UI kit: a plugin that gives every menu of the game an old-paper look. It builds nothing from scratch. It takes
 * the screens the Prebuilt screens plugin offers (`api.use`), changes how they look, and offers them again with a higher
 * `priority`, so a project that has no screens of its own plays with these. The same few lines re-skin any screens: this is the
 * recipe in docs/recipes/parchment-ui-kit.md.
 */

export const PARCHMENT = {
  paper: '#e8d9b5',
  paperDark: '#d4bd88',
  ink: '#3b2a14',
  inkSoft: '#6b5a3a',
  heading: '#5a2d0c',
  border: '#6b4a22',
};

/** The parts of the game's screens this kit re-draws, by what they are for. */
const ROLES = ['title', 'pause', 'inventory', 'map', 'save', 'load', 'settings', 'controls'] as const;

/** A small flourish under a heading: a plugin widget, so any screen can use it. */
export const flourishWidget: WidgetDef = {
  id: 'parchment-flourish',
  label: 'Flourish (a line with a star in the middle)',
  defaults: { w: 200, h: 18, wMode: 'fill', hMode: 'auto' },
  render(el) {
    el.textContent = '———  ✦  ———';
    el.style.textAlign = 'center';
    el.style.color = PARCHMENT.border;
    el.style.letterSpacing = '0.2em';
  },
};

/** Change the look of one widget of a screen. Only what is to look different is touched; what the widget does is left alone. */
export function parchmentLook(n: UiNode): void {
  const clickable = n.on.click.length > 0 || n.on.change.length > 0;
  if (n.id.endsWith('.box')) {
    n.style = { ...n.style, fill: PARCHMENT.paper, border: PARCHMENT.border, borderWidth: 4, radius: 4, shadow: true };
  } else if (n.type === 'text') {
    const heading = n.name === 'Heading' || n.name === 'Game title';
    n.style = { ...n.style, color: heading ? PARCHMENT.heading : n.style.opacity !== undefined && n.style.opacity < 1 ? PARCHMENT.inkSoft : PARCHMENT.ink, ...(heading ? { bold: true } : {}) };
  } else if (clickable && n.type === 'panel') {
    const hover = { fill: PARCHMENT.paperDark, border: PARCHMENT.border, borderWidth: 1 };
    n.style = { ...n.style, radius: 3, color: PARCHMENT.ink };
    n.states = { ...n.states, hover, focus: hover };
  }
  n.children.forEach(parchmentLook);
}

/** A screen of the game, re-drawn: the same widgets and actions, the paper look, a flourish under the heading, a softer dimming. */
export function parchmentScreen(base: UiScreen): UiScreen {
  const screen = structuredClone(base);
  parchmentLook(screen.root);
  screen.dim = Math.min(screen.dim, 0.6);
  const box = screen.root.children[0];
  if (box && box.children[0]) {
    // under the first thing in the box (the heading, or the title's name and line)
    const flourish: UiNode = { ...box.children[0], id: `${screen.id}.flourish`, name: 'Flourish', type: 'plugin', source: 'parchment-flourish', text: '', wMode: 'fill', hMode: 'auto', children: [], on: { click: [], hover: [], change: [] }, style: {} };
    box.children.splice(1, 0, flourish);
  }
  return { ...screen, id: `parchment-${base.id}`, name: base.name };
}

export const parchmentPlugin: PluginDefinition = definePlugin(
  manifest,
  {
    install(api) {
      api.widget(flourishWidget);
      const base = api.use<() => UiScreen[]>('prebuilt-screens', 'screens');
      for (const screen of base?.() ?? []) {
        if (!(ROLES as readonly string[]).includes(screen.role ?? '')) continue; // the heads-up display and the travel list keep their look
        api.screen({ id: `parchment-${screen.role}`, screen: parchmentScreen(screen), role: screen.role, revision: 1, priority: 10 });
      }
    },
  },
);

