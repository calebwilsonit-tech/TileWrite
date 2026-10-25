import type { UiNode, UiStyle } from '@tilewright/plugin-sdk';

/** The colours of the kit. A screen of the kit uses these and nothing else, so changing them re-colours everything. */
export const PARCHMENT = {
  paper: '#e8d9b5',
  paperDark: '#d4bd88',
  ink: '#3b2a14',
  inkSoft: '#6b5a3a',
  heading: '#5a2d0c',
  border: '#6b4a22',
  gold: '#b88a1e',
};

/** A sheet of paper: the box a page is written on. */
export const paper = (extra: UiStyle = {}): UiStyle => ({ fill: PARCHMENT.paper, border: PARCHMENT.border, borderWidth: 4, radius: 4, shadow: true, color: PARCHMENT.ink, ...extra });

/** The look of a row the player can choose: plain until it is pointed at or chosen with the keys. */
export const CHOSEN: UiStyle = { fill: PARCHMENT.paperDark, border: PARCHMENT.border, borderWidth: 1 };

/** Make a widget and everything under it paper-coloured text (only where no colour is set), so a page reads as ink on paper. */
export function inkOn(n: UiNode): UiNode {
  if (n.type === 'text' || n.type === 'button') n.style = { color: PARCHMENT.ink, ...n.style };
  n.children.forEach(inkOn);
  return n;
}
