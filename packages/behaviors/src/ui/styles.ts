import { UiNodeSchema, type UiNode } from '@tilewright/runtime';

/**
 * A few very different starting points for the look of the controls the engine draws: flat, old paper, sci-fi, pixel art. A style is
 * only a set of UI prefabs and which part of which control each one is for; applying one copies the prefabs into the project (they are
 * ordinary UI prefabs from then on, to change or replace) and names them in the widget's parts. Nothing here is built into any control.
 */

export interface UiStyleDef {
  id: string;
  label: string;
  description: string;
}

export const UI_STYLES: UiStyleDef[] = [
  { id: 'flat', label: 'Flat', description: 'Plain rounded boxes in the game’s own colours.' },
  { id: 'paper', label: 'Old paper', description: 'Warm paper, brown ink and brass.' },
  { id: 'scifi', label: 'Sci-fi', description: 'Dark glass with a cyan glow.' },
  { id: 'pixel', label: 'Pixel art', description: 'Square, chunky, no rounding.' },
];

interface Look {
  paper: string;
  ink: string;
  edge: string;
  accent: string;
  hover: string;
  radius: number;
  borderWidth: number;
  shadow: boolean;
  font?: number;
}

const LOOKS: Record<string, Look> = {
  flat: { paper: '#1c2029', ink: '#f4efe6', edge: '#8b93a7', accent: '#6aa8ff', hover: '#2a3140', radius: 8, borderWidth: 2, shadow: false },
  paper: { paper: '#e8d9b5', ink: '#3b2a14', edge: '#8a6a3a', accent: '#b8862b', hover: '#d9c394', radius: 6, borderWidth: 2, shadow: true },
  scifi: { paper: '#0a1620', ink: '#c8f4ff', edge: '#22d3ee', accent: '#22d3ee', hover: '#0f2a3a', radius: 2, borderWidth: 1, shadow: true },
  pixel: { paper: '#222034', ink: '#ffffff', edge: '#fbf236', accent: '#fbf236', hover: '#45283c', radius: 0, borderWidth: 4, shadow: false },
};

const node = (id: string, patch: Record<string, unknown>): UiNode => UiNodeSchema.parse({ id, name: id, ...patch });

/** The prefabs of a style, named "<Style> <part>" ("Sci-fi slider thumb"). */
export function stylePrefabs(styleId: string): { name: string; widget: UiNode }[] {
  const look = LOOKS[styleId];
  const def = UI_STYLES.find((s) => s.id === styleId);
  if (!look || !def) return [];
  const n = def.label;
  const box = { fill: look.paper, border: look.edge, borderWidth: look.borderWidth, radius: look.radius, shadow: look.shadow, color: look.ink } as const;
  const hovered = { fill: look.hover };
  const focused = { border: look.accent, borderWidth: look.borderWidth + 1 };
  const out: [string, UiNode][] = [
    [`${n} slider track`, node('track', { w: 100, h: 10, wMode: 'fill', hMode: 'fixed', style: { ...box, shadow: false, radius: Math.min(look.radius, 5), borderWidth: Math.max(1, look.borderWidth - 1) } })],
    [`${n} slider fill`, node('fill', { w: 100, h: 10, hMode: 'fixed', style: { fill: look.accent, radius: Math.min(look.radius, 5) } })],
    [`${n} slider thumb`, node('thumb', { w: 22, h: 22, style: { fill: look.paper, border: look.accent, borderWidth: look.borderWidth + 1, radius: look.radius === 0 ? 0 : 60, shadow: look.shadow }, states: { hover: { fill: look.hover }, pressed: { fill: look.accent }, focus: { borderWidth: look.borderWidth + 2 } } })],
    [`${n} slider tick`, node('tick', { w: 3, h: 14, style: { fill: look.edge } })],
    [`${n} slider value`, node('value', { type: 'text', text: '{slider.text}', wMode: 'auto', hMode: 'auto', style: { color: look.ink, fontSize: 14, bold: true } })],
    [`${n} scrollbar track`, node('track', { w: 10, h: 100, wMode: 'fill', hMode: 'fill', style: { fill: look.paper, border: look.edge, borderWidth: 1, radius: Math.min(look.radius, 6), opacity: 0.8 } })],
    [`${n} scrollbar thumb`, node('thumb', { w: 10, h: 40, wMode: 'fill', hMode: 'fill', style: { fill: look.accent, radius: Math.min(look.radius, 6) }, states: { hover: { fill: look.ink }, pressed: { fill: look.ink } } })],
    [`${n} scrollbar arrow`, node('arrow', { type: 'text', text: '{scroll.arrow}', wMode: 'auto', hMode: 'auto', style: { color: look.accent, fontSize: 12 } })],
    [`${n} more rows`, node('more', { type: 'text', text: '{scroll.arrow} {scroll.hidden_after} more', wMode: 'auto', hMode: 'auto', style: { color: look.accent, fontSize: 13, bold: true } })],
    [
      `${n} drop-down box`,
      node('box', { type: 'panel', w: 200, h: 34, wMode: 'fill', hMode: 'fixed', layout: 'row', align: 'center', padding: 8, style: box, states: { hover: hovered, focus: focused, disabled: { opacity: 0.4 } }, children: [{ id: 'text', name: 'Chosen', type: 'text', text: '{popup.text}', wMode: 'fill', hMode: 'auto', style: { color: look.ink } }, { id: 'arrow', name: 'Arrow', type: 'text', text: '▾', wMode: 'auto', hMode: 'auto', style: { color: look.accent } }] }),
    ],
    [`${n} pop-up list`, node('list', { type: 'panel', w: 200, h: 120, wMode: 'fill', hMode: 'auto', layout: 'column', gap: 2, padding: 4, style: { ...box, shadow: true } })],
    [
      `${n} pop-up option`,
      node('option', { type: 'panel', w: 200, h: 32, wMode: 'fill', hMode: 'fixed', layout: 'row', align: 'center', padding: 8, gap: 8, style: { radius: Math.min(look.radius, 4), color: look.ink }, states: { hover: hovered, focus: { fill: look.hover, border: look.accent, borderWidth: 2 } }, children: [{ id: 'mark', name: 'Chosen mark', type: 'text', text: '✔', wMode: 'auto', hMode: 'auto', visible: '{option.chosen} = 1', style: { color: look.accent } }, { id: 'text', name: 'Option', type: 'text', text: '{option.label}', wMode: 'fill', hMode: 'auto', style: { color: look.ink } }, { id: 'detail', name: 'Description', type: 'text', text: '{option.detail}', wMode: 'auto', hMode: 'auto', visible: '{option.detail}', style: { color: look.ink, opacity: 0.65, fontSize: 12 } }] }),
    ],
    [`${n} tick box`, node('box', { type: 'panel', w: 24, h: 24, layout: 'column', align: 'center', style: { ...box, shadow: false, radius: Math.min(look.radius, 5) }, states: { hover: hovered, focus: focused }, children: [{ id: 'mark', name: 'Tick', type: 'text', text: '✔', wMode: 'auto', hMode: 'auto', visible: '{toggle.on} = 1', style: { color: look.accent, bold: true } }] })],
    [`${n} text field`, node('box', { type: 'panel', w: 220, h: 34, wMode: 'fill', hMode: 'fixed', layout: 'row', align: 'center', padding: 8, style: box, states: { hover: hovered, focus: focused }, children: [{ id: 'text', name: 'Words', type: 'text', text: '{field.text}', wMode: 'auto', hMode: 'auto', visible: '{field.empty} = 0', style: { color: look.ink } }, { id: 'hint', name: 'Hint', type: 'text', text: '{field.placeholder}', wMode: 'auto', hMode: 'auto', visible: '{field.empty} = 1', style: { color: look.ink, opacity: 0.5 } }] })],
    [`${n} tab`, node('tab', { type: 'panel', w: 90, h: 34, wMode: 'auto', hMode: 'fixed', layout: 'row', align: 'center', padding: 12, style: { ...box, shadow: false }, states: { hover: hovered, focus: focused }, children: [{ id: 'text', name: 'Tab', type: 'text', text: '{tab.name}', wMode: 'auto', hMode: 'auto', style: { color: look.ink } }] })],
    [
      `${n} marker`,
      node('marker', { type: 'panel', w: 18, h: 18, layout: 'free', style: { fill: look.accent, border: look.ink, borderWidth: look.borderWidth > 2 ? 3 : 2, radius: look.radius === 0 ? 0 : 60, shadow: look.shadow }, children: [{ id: 'ring', name: 'Highlight ring', type: 'panel', anchor: 'c', w: 32, h: 32, visible: '{marker.highlight} = 1', style: { border: look.ink, borderWidth: 3, radius: look.radius === 0 ? 0 : 60 } }] }),
    ],
  ];
  return out.map(([name, widget]) => ({ name, widget }));
}

/** Which of a style's prefabs go in which part of a control (by the control's kind: slider, scrollbar, popup, toggle, field, tabs, map). */
export function styleParts(styleId: string, kind: string): Record<string, string> {
  const n = UI_STYLES.find((s) => s.id === styleId)?.label;
  if (!n) return {};
  switch (kind) {
    case 'slider':
      return { track: `${n} slider track`, fill: `${n} slider fill`, thumb: `${n} slider thumb`, thumb2: `${n} slider thumb`, tick: `${n} slider tick` };
    case 'scrollbar':
      return { track: `${n} scrollbar track`, thumb: `${n} scrollbar thumb`, arrowStart: `${n} scrollbar arrow`, arrowEnd: `${n} scrollbar arrow` };
    case 'popup':
      return { box: `${n} drop-down box`, list: `${n} pop-up list`, option: `${n} pop-up option` };
    case 'toggle':
      return { box: `${n} tick box` };
    case 'textfield':
    case 'numberfield':
      return { box: `${n} text field` };
    case 'tabs':
      return { tab: `${n} tab` };
    case 'map':
      return { marker: `${n} marker` };
    default:
      return {};
  }
}
