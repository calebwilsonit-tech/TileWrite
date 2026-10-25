import { completeLayout, hudPieces, screenKit, type UiLayout, type UiNode, type UiScreen, type UiWidget } from '@tilewright/plugin-sdk';

const { text, widget } = screenKit;


/** The heads-up display's anchors, as the designer names them. */
const ANCHOR: Record<string, UiNode['anchor']> = { tl: 'tl', tc: 't', tr: 'tr', cl: 'l', c: 'c', cr: 'r', bl: 'bl', bc: 'b', br: 'br' };

const horizontal = (a: string): 'l' | 'c' | 'r' => (a.endsWith('l') ? 'l' : a.endsWith('r') ? 'r' : 'c');
const vertical = (a: string): 't' | 'c' | 'b' => (a.startsWith('t') ? 't' : a.startsWith('b') ? 'b' : 'c');

/** What one piece of the layout becomes: the widget of the plugin that offers it, or text and bars for the project's own. */
function pieceOf(w: UiWidget): UiNode | null {
  const id = `hud.${w.id}`;
  const scale = w.scale !== 1 ? { scale: w.scale } : {};
  const style = { themeScale: true as const, ...scale };
  const offered = hudPieces().find((p) => p.piece === w.kind);
  if (offered) {
    return widget('plugin', id, { name: w.id, source: offered.widget, wMode: offered.fillsRow && w.anchor === 'default' ? 'fill' : offered.fillsRow ? 'fixed' : 'auto', hMode: 'auto', w: offered.width, h: 24, visible: `{part.${offered.widget}}`, style });
  }
  switch (w.kind) {
    case 'counter':
      return text(id, `${w.label ? `${w.label} ` : ''}{${w.variable}}`, { name: w.id, style: { ...style, fontSize: 15 } });
    case 'text':
      return text(id, w.text, { name: w.id, style: { ...style, fontSize: 15 } });
    case 'bar': {
      const label = w.label ? [text(`${id}.label`, w.label, { name: `${w.id} label`, style: { fontSize: 15, opacity: 0.85 } })] : [];
      const bar = widget('bar', `${id}.bar`, { name: `${w.id} bar`, w: 160, h: 10, value: w.variable, max: w.maxVariable ? `{${w.maxVariable}}` : String(w.max), style: { fill: '#1b1d24', color: w.color, radius: 6, border: '#000000', borderWidth: 1 } });
      return widget('panel', id, { name: w.id, layout: 'column', gap: 3, padding: 0, wMode: 'auto', hMode: 'auto', style: { ...style }, children: [...label, bar] });
    }
    default:
      return null; // the messages are drawn by the game itself
  }
}

/**
 * The heads-up display as a designer screen, for a project's interface layout (Story, Interface): the pieces on the default
 * anchor stand in a column at the top left, the others are pinned where the layout says. With no layout it is the standard one.
 */
export function hudScreen(layout: UiLayout | null): UiScreen {
  const offered = hudPieces();
  const order = offered.map((p) => p.piece);
  const l = completeLayout(layout, order);
  const flow: UiNode[] = [];
  const pinned: UiNode[] = [];
  const mine = l.widgets.filter((w) => w.visible && w.kind !== 'toasts');
  const sorted = [...mine.filter((w) => order.includes(w.kind)).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)), ...mine.filter((w) => !order.includes(w.kind))];
  for (const w of sorted) {
    const piece = pieceOf(w);
    if (!piece) continue;
    if (w.anchor === 'default') {
      flow.push(piece);
      continue;
    }
    const h = horizontal(w.anchor);
    const v = vertical(w.anchor);
    // the offsets of a pinned piece measure inward from its edge; the designer's measure outward from the right and bottom
    const box = widget('panel', `${piece.id}.pin`, { name: `${w.id} (pinned)`, anchor: ANCHOR[w.anchor] ?? 'tl', x: h === 'r' ? -w.x : w.x, y: v === 'b' ? -w.y : w.y, wMode: 'auto', hMode: 'auto', layout: 'column', padding: 0, style: {}, children: [{ ...piece, anchor: 'tl' }] });
    pinned.push(box);
  }
  const column = widget('panel', 'hud.column', { name: 'Heads-up display', anchor: 'fill', x: 12, y: 10, layout: 'column', gap: 6, padding: 0, align: 'start', style: {}, children: flow });
  const root = widget('panel', 'hud.root', { name: 'HUD root', anchor: 'fill', layout: 'free', padding: 0, style: {}, children: [column, ...pinned] });
  return { id: 'prebuilt-hud', name: 'HUD', root, modal: false, back: 'auto', backTo: '', priority: 0, dim: 0, transition: 'none', mapX: 0, mapY: 0, opensOnStart: false, role: 'hud' };
}
