import { encodePng } from '@tilewright/runtime';

/**
 * A small software drawing surface for the pictures the assistant gets of the project's own data (a map from above, a screen's
 * boxes, a graph). No window, no fonts, no images: filled shapes and a 3 x 5 pixel font, so the same code runs in a test and
 * the pictures are the same everywhere. Colours are 0xRRGGBB.
 */

export type Pt = readonly [number, number];

const GLYPHS: Record<string, string> = {
  A: '.#./#.#/###/#.#/#.#',
  B: '##./#.#/##./#.#/##.',
  C: '.##/#../#../#../.##',
  D: '##./#.#/#.#/#.#/##.',
  E: '###/#../##./#../###',
  F: '###/#../##./#../#..',
  G: '.##/#../#.#/#.#/.##',
  H: '#.#/#.#/###/#.#/#.#',
  I: '###/.#./.#./.#./###',
  J: '..#/..#/..#/#.#/.#.',
  K: '#.#/#.#/##./#.#/#.#',
  L: '#../#../#../#../###',
  M: '#.#/###/###/#.#/#.#',
  N: '##./#.#/#.#/#.#/#.#',
  O: '.#./#.#/#.#/#.#/.#.',
  P: '##./#.#/##./#../#..',
  Q: '.#./#.#/#.#/##./.##',
  R: '##./#.#/##./#.#/#.#',
  S: '.##/#../.#./..#/##.',
  T: '###/.#./.#./.#./.#.',
  U: '#.#/#.#/#.#/#.#/###',
  V: '#.#/#.#/#.#/#.#/.#.',
  W: '#.#/#.#/###/###/#.#',
  X: '#.#/#.#/.#./#.#/#.#',
  Y: '#.#/#.#/.#./.#./.#.',
  Z: '###/..#/.#./#../###',
  '0': '###/#.#/#.#/#.#/###',
  '1': '.#./##./.#./.#./###',
  '2': '##./..#/.#./#../###',
  '3': '##./..#/.#./..#/##.',
  '4': '#.#/#.#/###/..#/..#',
  '5': '###/#../##./..#/##.',
  '6': '.##/#../###/#.#/###',
  '7': '###/..#/.#./.#./.#.',
  '8': '###/#.#/###/#.#/###',
  '9': '###/#.#/###/..#/##.',
  '.': '.../.../.../.../.#.',
  ',': '.../.../.../.#./#..',
  ':': '.../.#./.../.#./...',
  ';': '.../.#./.../.#./#..',
  '-': '.../.../###/.../...',
  _: '.../.../.../.../###',
  '/': '..#/..#/.#./#../#..',
  '(': '.#./#../#../#../.#.',
  ')': '.#./..#/..#/..#/.#.',
  '!': '.#./.#./.#./.../.#.',
  '?': '##./..#/.#./.../.#.',
  "'": '.#./.#./.../.../...',
  '"': '#.#/#.#/.../.../...',
  '+': '.../.#./###/.#./...',
  '*': '.../#.#/.#./#.#/...',
  '=': '.../###/.../###/...',
  '<': '..#/.#./#../.#./..#',
  '>': '#../.#./..#/.#./#..',
  '[': '##./#../#../#../##.',
  ']': '.##/..#/..#/..#/.##',
  '#': '#.#/###/#.#/###/#.#',
  '%': '#.#/..#/.#./#../#.#',
  '@': '.#./#.#/#.#/#../.##',
  '&': '.#./#.#/.#./#.#/.##',
  '{': '.##/.#./##./.#./.##',
  '}': '##./.#./.##/.#./##.',
  '^': '.#./#.#/.../.../...',
  '~': '.../.##/##./.../...',
  ' ': '.../.../.../.../...',
};
const UNKNOWN = '###/#.#/#.#/#.#/###';

/** The glyph rows for a character (letters are drawn in capitals). */
const glyph = (ch: string): string[] => (GLYPHS[ch.toUpperCase()] ?? UNKNOWN).split('/');

export const CHAR_W = 4;
export const CHAR_H = 6;

export class Canvas {
  readonly rgba: Uint8ClampedArray;

  constructor(
    readonly width: number,
    readonly height: number,
    background: number | null = 0x1b1d23,
  ) {
    this.rgba = new Uint8ClampedArray(width * height * 4);
    if (background !== null) this.rect(0, 0, width, height, background);
  }

  /** One pixel, blended over what is there. */
  px(x: number, y: number, color: number, alpha = 1): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const r = (color >> 16) & 255;
    const g = (color >> 8) & 255;
    const b = color & 255;
    if (alpha >= 1) {
      this.rgba[i] = r;
      this.rgba[i + 1] = g;
      this.rgba[i + 2] = b;
      this.rgba[i + 3] = 255;
      return;
    }
    const a0 = this.rgba[i + 3]! / 255;
    const a = alpha + a0 * (1 - alpha);
    this.rgba[i] = (r * alpha + this.rgba[i]! * a0 * (1 - alpha)) / a;
    this.rgba[i + 1] = (g * alpha + this.rgba[i + 1]! * a0 * (1 - alpha)) / a;
    this.rgba[i + 2] = (b * alpha + this.rgba[i + 2]! * a0 * (1 - alpha)) / a;
    this.rgba[i + 3] = a * 255;
  }

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px(xx, yy, color, alpha);
  }

  strokeRect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const x1 = Math.round(x + w) - 1;
    const y1 = Math.round(y + h) - 1;
    this.line(x0, y0, x1, y0, color, alpha);
    this.line(x0, y1, x1, y1, color, alpha);
    this.line(x0, y0, x0, y1, color, alpha);
    this.line(x1, y0, x1, y1, color, alpha);
  }

  line(x0: number, y0: number, x1: number, y1: number, color: number, alpha = 1): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 100_000; guard++) {
      this.px(x0, y0, color, alpha);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** A polygon filled by scanlines (even-odd), any number of corners. */
  poly(points: readonly Pt[], color: number, alpha = 1): void {
    if (points.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(this.height - 1, Math.ceil(maxY)); y++) {
      const cy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i]!;
        const [bx, by] = points[(i + 1) % points.length]!;
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.ceil(xs[i]! - 0.5); x < xs[i + 1]! - 0.5; x++) this.px(x, y, color, alpha);
    }
  }

  polyStroke(points: readonly Pt[], color: number, alpha = 1, closed = true): void {
    for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
      const [ax, ay] = points[i]!;
      const [bx, by] = points[(i + 1) % points.length]!;
      this.line(ax, ay, bx, by, color, alpha);
    }
  }

  circle(cx: number, cy: number, r: number, color: number, fill = true, alpha = 1): void {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (fill ? d <= r : Math.abs(d - r) < 0.75) this.px(x, y, color, alpha);
      }
    }
  }

  /** An arrow from a to b with a head at b. */
  arrow(ax: number, ay: number, bx: number, by: number, color: number, head = 4): void {
    this.line(ax, ay, bx, by, color);
    const a = Math.atan2(by - ay, bx - ax);
    const wing = (d: number): Pt => [bx - head * Math.cos(a + d), by - head * Math.sin(a + d)];
    this.poly([[bx, by], wing(0.45), wing(-0.45)], color);
  }

  textWidth(s: string, scale = 1): number {
    return s.length * CHAR_W * scale - scale;
  }

  /** Text with its top left corner at x, y. Returns the width drawn. */
  text(x: number, y: number, s: string, color: number, scale = 1, alpha = 1): number {
    let cx = x;
    for (const ch of s) {
      const rows = glyph(ch);
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) if (rows[r]![c] === '#') this.rect(cx + c * scale, y + r * scale, scale, scale, color, alpha);
      }
      cx += CHAR_W * scale;
    }
    return cx - x - scale;
  }

  /** Text on a small dark label so it can be read over a picture. */
  label(x: number, y: number, s: string, color = 0xffffff, scale = 1): void {
    const w = this.textWidth(s, scale);
    this.rect(x - 1, y - 1, w + 2, 5 * scale + 2, 0x000000, 0.65);
    this.text(x, y, s, color, scale);
  }

  toPng(): Uint8Array {
    return encodePng(this.width, this.height, this.rgba);
  }
}

/** A colour darkened or lightened (factor below 1 darkens). */
export function shade(color: number, factor: number): number {
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v * factor)));
  return (ch((color >> 16) & 255) << 16) | (ch((color >> 8) & 255) << 8) | ch(color & 255);
}

/** A stable colour for a name (the same name is always the same colour), bright enough to see on a dark ground. */
export function colorFor(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const f = (n: number): number => {
    const k = (n + hue / 30) % 12;
    const v = 0.62 - 0.38 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** Cut a name to fit a number of characters. */
export const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1))}~`);
