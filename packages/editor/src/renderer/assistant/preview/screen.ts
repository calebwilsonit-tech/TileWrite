import { UiDocSchema, roleOfScreen, type UiNode, type UiScreen } from '@tilewright/runtime';
import { Canvas, clip, shade } from './canvas';

/**
 * A wireframe of an interface screen: where each widget sits and how big it is, with its words, drawn from the screen file alone.
 * The game lays screens out with the browser's own flexible boxes, so this is a close copy of the rules, not the same engine:
 * sizes of text are estimated and themes (the `var(--...)` colours) are replaced by plain ones. It is good for seeing the
 * structure of a screen (what is where, what is a button, what scrolls), not its exact look.
 */

export const SCREEN_W = 960;
export const SCREEN_H = 540;

export interface ScreenPicture {
  png: Uint8Array;
  width: number;
  height: number;
  name: string;
  notes: string[];
}

interface Box {
  node: UiNode;
  x: number;
  y: number;
  w: number;
  h: number;
  kids: Box[];
}

const fontOf = (n: UiNode): number => n.style.fontSize ?? (n.type === 'text' || n.type === 'button' ? 16 : 14);
const textScale = (n: UiNode): number => (fontOf(n) >= 13 ? 2 : 1);

/** How big a node wants to be when its size is "auto" (text from its words, containers from what they hold). */
function natural(n: UiNode): { w: number; h: number } {
  const scale = textScale(n);
  const lines = n.text.split('\n');
  const textW = Math.max(0, ...lines.map((l) => l.length)) * 4 * scale;
  const textH = lines.length * 7 * scale;
  if (n.children.length > 0 && n.type !== 'tabs') {
    const kids = n.children.map((k) => sized(k));
    const gap = n.gap;
    const pad = n.padding * 2;
    if (n.layout === 'row') return { w: kids.reduce((s, k) => s + k.w, 0) + gap * Math.max(0, kids.length - 1) + pad, h: Math.max(0, ...kids.map((k) => k.h)) + pad };
    if (n.layout === 'column') return { w: Math.max(0, ...kids.map((k) => k.w)) + pad, h: kids.reduce((s, k) => s + k.h, 0) + gap * Math.max(0, kids.length - 1) + pad };
    if (n.layout === 'grid') {
      const cols = Math.max(1, n.columns);
      const rows = Math.ceil(kids.length / cols);
      return { w: cols * Math.max(0, ...kids.map((k) => k.w)) + gap * (cols - 1) + pad, h: rows * Math.max(0, ...kids.map((k) => k.h)) + gap * (rows - 1) + pad };
    }
    return { w: Math.max(0, ...kids.map((k) => k.x0 + k.w)) + pad, h: Math.max(0, ...kids.map((k) => k.y0 + k.h)) + pad };
  }
  if (n.type === 'text') return { w: textW, h: textH };
  if (n.type === 'button') return { w: textW + 28, h: textH + 16 };
  return { w: n.w, h: n.h };
}

/** A node's own size: fixed, or what it wants. (`fill` is settled by the parent; until then it is its set size.) */
function sized(n: UiNode): { w: number; h: number; x0: number; y0: number } {
  const nat = n.wMode === 'auto' || n.hMode === 'auto' ? natural(n) : { w: n.w, h: n.h };
  return { w: n.wMode === 'auto' ? nat.w : n.w, h: n.hMode === 'auto' ? nat.h : n.h, x0: n.x, y0: n.y };
}

/** Place a node's children inside the box it was given. */
function arrange(n: UiNode, x: number, y: number, w: number, h: number): Box {
  const box: Box = { node: n, x, y, w, h, kids: [] };
  const pad = n.padding;
  const cx = x + pad;
  const cy = y + pad;
  const cw = Math.max(0, w - 2 * pad);
  const ch = Math.max(0, h - 2 * pad);
  const kids = n.type === 'tabs' ? n.children.slice(0, 1) : n.children;
  if (kids.length === 0) return box;
  if (n.layout === 'row' || n.layout === 'column') {
    const row = n.layout === 'row';
    const main = row ? cw : ch;
    const dims = kids.map((k) => sized(k));
    const fixed = dims.reduce((s, d, i) => s + ((row ? kids[i]!.wMode : kids[i]!.hMode) === 'fill' ? 0 : row ? d.w : d.h), 0) + n.gap * (kids.length - 1);
    const fills = kids.filter((k) => (row ? k.wMode : k.hMode) === 'fill').length;
    const share = fills > 0 ? Math.max(0, main - fixed) / fills : 0;
    let at = row ? cx : cy;
    kids.forEach((k, i) => {
      const d = dims[i]!;
      const along = (row ? k.wMode : k.hMode) === 'fill' ? share : row ? d.w : d.h;
      const crossMode = row ? k.hMode : k.wMode;
      const crossSize = row ? d.h : d.w;
      const crossRoom = row ? ch : cw;
      const across = crossMode === 'fill' || n.align === 'stretch' ? crossRoom : crossSize;
      const off = n.align === 'center' ? (crossRoom - across) / 2 : n.align === 'end' ? crossRoom - across : 0;
      const kx = row ? at : cx + off;
      const ky = row ? cy + off : at;
      box.kids.push(arrange(k, kx, ky, row ? along : across, row ? across : along));
      at += along + n.gap;
    });
  } else if (n.layout === 'grid') {
    const cols = Math.max(1, n.columns);
    const cellW = (cw - n.gap * (cols - 1)) / cols;
    const rowH: number[] = [];
    kids.forEach((k, i) => {
      const r = Math.floor(i / cols);
      rowH[r] = Math.max(rowH[r] ?? 0, k.hMode === 'fill' ? 0 : sized(k).h);
    });
    kids.forEach((k, i) => {
      const r = Math.floor(i / cols);
      const top = cy + rowH.slice(0, r).reduce((s, v) => s + v + n.gap, 0);
      box.kids.push(arrange(k, cx + (i % cols) * (cellW + n.gap), top, k.wMode === 'fixed' ? Math.min(k.w, cellW) : cellW, rowH[r]! || sized(k).h));
    });
  } else {
    for (const k of kids) {
      const d = sized(k);
      const kw = k.anchor === 'fill' || k.wMode === 'fill' ? cw : d.w;
      const kh = k.anchor === 'fill' || k.hMode === 'fill' ? ch : d.h;
      const a = k.anchor;
      const kx = a === 'fill' ? cx : a === 'tl' || a === 'l' || a === 'bl' ? cx + k.x : a === 't' || a === 'c' || a === 'b' ? cx + (cw - kw) / 2 + k.x : cx + cw - kw - k.x;
      const ky = a === 'fill' ? cy : a === 'tl' || a === 't' || a === 'tr' ? cy + k.y : a === 'l' || a === 'c' || a === 'r' ? cy + (ch - kh) / 2 + k.y : cy + ch - kh - k.y;
      box.kids.push(arrange(k, kx, ky, kw, kh));
    }
  }
  return box;
}

const DEFAULT_FILL: Partial<Record<UiNode['type'], number>> = { panel: 0x2b2f3a, button: 0x3a5f94, bar: 0x23262e, slider: 0x23262e, toggle: 0x23262e, dropdown: 0x2b2f3a, keybind: 0x2b2f3a, list: 0x1f2229, grid: 0x1f2229, tabs: 0x23262e, minimap: 0x14171c, hand: 0x1f2229, turnOrder: 0x23262e, image: 0x24302a };

/** A literal colour from a style ("#rgb", "#rrggbb", "rgb(1,2,3)"), or null (a theme variable, a gradient, anything else). */
function colourOf(css: string | undefined): number | null {
  if (!css) return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(css.trim());
  if (hex) {
    const h = hex[1]!;
    const six = h.length === 3 ? [...h].map((d) => d + d).join('') : h.slice(0, 6);
    return parseInt(six, 16);
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(css.trim());
  return rgb ? (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]) : null;
}

function paint(c: Canvas, b: Box, depth: number): void {
  const n = b.node;
  if (n.type === 'spacer') return;
  const fill = colourOf(n.style.fill) ?? DEFAULT_FILL[n.type];
  const border = colourOf(n.style.border) ?? (n.type === 'text' ? null : fill !== undefined ? shade(fill, 1.6) : null);
  const alpha = (n.style.opacity ?? 1) * (n.type === 'panel' && depth === 0 ? 0.55 : 1);
  if (fill !== undefined && !(n.type === 'panel' && n.style.fill === 'transparent')) c.rect(b.x, b.y, b.w, b.h, fill, alpha);
  if (border !== null && b.w > 2 && b.h > 2) c.strokeRect(b.x, b.y, b.w, b.h, border, 0.9);
  const scale = textScale(n);
  const color = colourOf(n.style.color) ?? 0xe8eaf0;
  const center = (s: string, cy: number = b.y + (b.h - 5 * scale) / 2): void => {
    const room = Math.max(1, Math.floor((b.w - 4) / (4 * scale)));
    const t = clip(s, room);
    c.text(b.x + (b.w - c.textWidth(t, scale)) / 2, cy, t, color, scale);
  };
  switch (n.type) {
    case 'text':
      if (n.text) {
        const align = n.style.align ?? 'left';
        n.text.split('\n').slice(0, 12).forEach((line, i) => {
          const t = clip(line, Math.max(1, Math.floor(b.w / (4 * scale))));
          const w = c.textWidth(t, scale);
          c.text(align === 'center' ? b.x + (b.w - w) / 2 : align === 'right' ? b.x + b.w - w : b.x, b.y + i * 7 * scale, t, color, scale);
        });
      }
      break;
    case 'button':
      center(n.text || n.name);
      break;
    case 'bar': {
      c.rect(b.x + 2, b.y + 2, Math.max(0, (b.w - 4) * 0.6), Math.max(0, b.h - 4), 0x4caf6a);
      if (n.value) c.text(b.x + 4, b.y + b.h / 2 - 2, clip(n.value, Math.floor(b.w / 4) - 1), 0xffffff);
      break;
    }
    case 'slider':
      c.line(b.x + 4, b.y + b.h / 2, b.x + b.w - 4, b.y + b.h / 2, 0x8fa0b8);
      c.circle(b.x + b.w * 0.6, b.y + b.h / 2, Math.max(3, b.h / 3), 0xe8eaf0);
      break;
    case 'toggle':
      c.strokeRect(b.x + 3, b.y + b.h / 2 - 5, 10, 10, 0xe8eaf0);
      c.text(b.x + 18, b.y + b.h / 2 - 2.5 * scale, clip(n.text || n.name, Math.floor((b.w - 20) / (4 * scale))), color, scale);
      break;
    case 'dropdown':
      c.text(b.x + 6, b.y + b.h / 2 - 2.5, clip(n.options.split(',')[0]?.trim() || n.name, Math.floor(b.w / 4) - 4), color);
      c.text(b.x + b.w - 10, b.y + b.h / 2 - 2.5, 'V', 0x8fa0b8);
      break;
    case 'keybind':
      c.text(b.x + 6, b.y + b.h / 2 - 2.5, clip(n.label ?? n.name, Math.floor(b.w / 4) - 4), color);
      break;
    case 'image':
      c.line(b.x, b.y, b.x + b.w, b.y + b.h, 0x5a7a62, 0.8);
      c.line(b.x + b.w, b.y, b.x, b.y + b.h, 0x5a7a62, 0.8);
      if (n.sprite) c.label(b.x + 3, b.y + 3, clip(n.sprite, Math.floor(b.w / 4) - 2), 0xbfe3c8);
      break;
    case 'list':
    case 'grid':
    case 'hand':
    case 'turnOrder': {
      const slots = n.type === 'grid' ? Math.max(1, n.columns) * 2 : n.type === 'turnOrder' ? 6 : 4;
      const per = n.type === 'grid' ? Math.max(1, n.columns) : slots;
      const sw = Math.max(6, Math.min(40, (b.w - 8) / per - 3));
      for (let i = 0; i < slots; i++) c.strokeRect(b.x + 4 + (i % per) * (sw + 3), b.y + 4 + Math.floor(i / per) * (sw + 3), sw, Math.min(sw, b.h - 8), 0x59647a, 0.9);
      if (n.source) c.label(b.x + 3, b.y + b.h - 9, clip(n.source, Math.floor(b.w / 4) - 2), 0x9fb3d0);
      break;
    }
    case 'tabs': {
      const names = (n.options || 'Tab 1,Tab 2').split(',').map((s) => s.trim());
      let tx = b.x + 4;
      names.slice(0, 6).forEach((name, i) => {
        const w = c.textWidth(clip(name, 12)) + 10;
        c.rect(tx, b.y + 3, w, 12, i === 0 ? 0x3a5f94 : 0x2b2f3a);
        c.text(tx + 5, b.y + 6, clip(name, 12), 0xe8eaf0);
        tx += w + 3;
      });
      break;
    }
    case 'minimap':
      c.circle(b.x + b.w / 2, b.y + b.h / 2, 2, 0x6fe08a);
      c.text(b.x + 4, b.y + b.h - 8, 'MAP', 0x59647a);
      break;
    case 'instance':
      c.label(b.x + 3, b.y + 3, clip(`prefab ${n.prefab}`, Math.floor(b.w / 4) - 2), 0xd0b080);
      break;
    case 'plugin':
      c.label(b.x + 3, b.y + 3, clip(`plugin ${n.name}`, Math.floor(b.w / 4) - 2), 0xd0b080);
      break;
    default:
      break;
  }
  // containers carry their name in a corner so they can be talked about
  if (['panel', 'list', 'grid', 'tabs', 'hand'].includes(n.type) && depth > 0 && b.w > c.textWidth(clip(n.name, 14)) + 8 && n.type !== 'tabs') c.text(b.x + 3, b.y + 2, clip(n.name, 14), 0x7d8aa3);
  for (const k of b.kids) paint(c, k, depth + 1);
}

function count(n: UiNode): number {
  return 1 + n.children.reduce((s, k) => s + count(k), 0);
}
function collect(n: UiNode, out: UiNode[] = []): UiNode[] {
  out.push(n);
  for (const k of n.children) collect(k, out);
  return out;
}

export function renderScreen(screen: UiScreen): ScreenPicture {
  const root = screen.root;
  const full = root.anchor === 'fill' || root.wMode === 'fill';
  const rw = full ? SCREEN_W : sized(root).w;
  const rh = root.anchor === 'fill' || root.hMode === 'fill' ? SCREEN_H : sized(root).h;
  const a = root.anchor;
  const rx = a === 'tl' || a === 'l' || a === 'bl' || a === 'fill' ? root.x : a === 't' || a === 'c' || a === 'b' ? (SCREEN_W - rw) / 2 + root.x : SCREEN_W - rw - root.x;
  const ry = a === 'tl' || a === 't' || a === 'tr' || a === 'fill' ? root.y : a === 'l' || a === 'c' || a === 'r' ? (SCREEN_H - rh) / 2 + root.y : SCREEN_H - rh - root.y;
  const c = new Canvas(SCREEN_W, SCREEN_H, 0x121419);
  // a faint grid so sizes can be judged
  for (let x = 0; x <= SCREEN_W; x += 80) c.line(x, 0, x, SCREEN_H, 0x1c1f27);
  for (let y = 0; y <= SCREEN_H; y += 90) c.line(0, y, SCREEN_W, y, 0x1c1f27);
  if (screen.dim > 0) c.rect(0, 0, SCREEN_W, SCREEN_H, 0x000000, screen.dim * 0.5);
  paint(c, arrange(root, rx, ry, rw, rh), 0);
  const all = collect(root);
  const buttons = all.filter((n) => n.type === 'button').map((n) => n.text || n.name);
  const role = roleOfScreen(screen);
  const notes = [
    `Screen "${screen.name}"${role ? ` (role: ${role})` : ''}: ${count(root)} widgets${buttons.length > 0 ? `, buttons: ${buttons.slice(0, 10).map((b) => `"${clip(b, 24)}"`).join(', ')}${buttons.length > 10 ? ', ...' : ''}` : ''}${screen.opensOnStart ? '; opens when the game starts' : ''}${screen.modal || screen.pauses ? '; the game waits while it is open' : ''}.`,
  ];
  const scrolling = all.filter((n) => n.style.scroll).length;
  if (scrolling > 0) notes.push(`${scrolling} widget${scrolling === 1 ? '' : 's'} scroll.`);
  notes.push(`A wireframe at ${SCREEN_W} x ${SCREEN_H}: positions and sizes follow the file, text sizes are estimated, theme colours are replaced by plain ones.`);
  return { png: c.toPng(), width: SCREEN_W, height: SCREEN_H, name: screen.name, notes };
}

/** Pictures of the screens in a screens file (at most `limit`), and a line about the ones left out. */
export function renderScreens(input: unknown, limit = 4): { pictures: ScreenPicture[]; notes: string[] } | null {
  const doc = UiDocSchema.safeParse(input);
  if (!doc.success || doc.data.screens.length === 0) return null;
  const pictures = doc.data.screens.slice(0, limit).map(renderScreen);
  const notes: string[] = [];
  if (doc.data.screens.length > limit) notes.push(`${doc.data.screens.length} screens in this file; the first ${limit} are drawn. Left out: ${doc.data.screens.slice(limit).map((s) => `"${s.name}"`).join(', ')}.`);
  return { pictures, notes };
}
