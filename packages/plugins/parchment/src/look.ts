import { type UiNode, type UiScreen } from '@tilewright/plugin-sdk';
import { PARCHMENT } from './palette';

/**
 * Giving a screen the paper look without changing what it does: the part of the kit that re-skins the engine's own screens (Save, Load,
 * Settings, Controls). It only touches `style` and `states`; actions, list sources and bindings stay as they were, so every button still
 * works. This is the recipe in docs/recipes/parchment-ui-kit.md.
 */

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

/**
 * A difficulty that is chosen for a save is locked for that save: the kit's New game page sets the variable `difficulty_locked`
 * (saved with the game), and the Settings page's difficulty choice can no longer be used while it is set, and says why.
 */
function lockDifficulty(n: UiNode): void {
  if (n.id === 'difficulty.choice') n.enabled = '{difficulty_locked} != 1';
  if (n.id === 'difficulty') {
    const note: UiNode = { ...n.children[0]!, id: 'difficulty.locked', name: 'Locked note', type: 'text', text: 'locked for this save', wMode: 'auto', hMode: 'auto', visible: '{difficulty_locked} = 1', children: [], on: { click: [], hover: [], change: [] }, style: { fontSize: 12, opacity: 0.7, color: PARCHMENT.inkSoft } };
    n.children.splice(1, 0, note);
  }
  n.children.forEach(lockDifficulty);
}

/** A screen of the game, re-drawn: the same widgets and actions, the paper look, a flourish under the heading, a softer dimming. */
export function parchmentScreen(base: UiScreen): UiScreen {
  const screen = structuredClone(base);
  parchmentLook(screen.root);
  if (screen.role === 'settings') lockDifficulty(screen.root);
  screen.dim = Math.min(screen.dim, 0.6);
  const box = screen.root.children[0];
  if (box && box.children[0]) {
    // under the first thing in the box (the heading, or the title's name and line)
    const flourish: UiNode = { ...box.children[0], id: `${screen.id}.flourish`, name: 'Flourish', type: 'plugin', source: 'parchment-flourish', text: '', wMode: 'fill', hMode: 'auto', children: [], on: { click: [], hover: [], change: [] }, style: {} };
    box.children.splice(1, 0, flourish);
  }
  return { ...screen, id: `parchment-${base.id}`, name: base.name };
}
