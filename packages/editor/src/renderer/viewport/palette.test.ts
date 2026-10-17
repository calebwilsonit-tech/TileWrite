import { describe, expect, it } from 'vitest';
import { NORMAL_PALETTE, PALETTE, SAFE_PALETTE, setColourBlindSafe, type Palette } from './palette';

// Machado, Oliveira and Fernandes (2009), full severity, applied to linear RGB
const MATRICES = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
} as const;

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

type Vec = [number, number, number];

function lab(rgb: Vec): Vec {
  const [r, g, b] = rgb.map((v) => Math.min(1, Math.max(0, v))) as Vec;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function seen(color: number, kind: keyof typeof MATRICES | 'normal'): Vec {
  const lin: Vec = [toLinear((color >> 16) & 255), toLinear((color >> 8) & 255), toLinear(color & 255)];
  if (kind === 'normal') return lab(lin);
  const m = MATRICES[kind];
  return lab([0, 1, 2].map((i) => m[i]![0]! * lin[0] + m[i]![1]! * lin[1] + m[i]![2]! * lin[2]) as Vec);
}

const delta = (a: Vec, b: Vec): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The overlay colours that have to be told apart at a glance. */
const MEANINGFUL: (keyof Palette)[] = ['walkable', 'blocked', 'water', 'stair', 'trigger', 'deck'];

function leastDifference(p: Palette, kind: keyof typeof MATRICES | 'normal'): { pair: string; value: number } {
  let worst = { pair: '', value: Infinity };
  for (let i = 0; i < MEANINGFUL.length; i++) {
    for (let j = i + 1; j < MEANINGFUL.length; j++) {
      const v = delta(seen(p[MEANINGFUL[i]!], kind), seen(p[MEANINGFUL[j]!], kind));
      if (v < worst.value) worst = { pair: `${MEANINGFUL[i]} / ${MEANINGFUL[j]}`, value: v };
    }
  }
  return worst;
}

describe('colour-blind-safe overlay colours', () => {
  it('stay clearly apart for red-green and blue-yellow colour blindness', () => {
    for (const kind of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
      const w = leastDifference(SAFE_PALETTE, kind);
      expect(w.value, `${kind}: ${w.pair}`).toBeGreaterThan(14);
    }
  });

  it('are needed: the default green and red are hard to tell apart for red-green colour blindness', () => {
    expect(delta(seen(NORMAL_PALETTE.walkable, 'deuteranopia'), seen(NORMAL_PALETTE.blocked, 'deuteranopia'))).toBeLessThan(delta(seen(SAFE_PALETTE.walkable, 'deuteranopia'), seen(SAFE_PALETTE.blocked, 'deuteranopia')));
  });

  it('switch in place, so every overlay that reads the palette changes at once', () => {
    setColourBlindSafe(true);
    expect(PALETTE.walkable).toBe(SAFE_PALETTE.walkable);
    expect(PALETTE.solid).toBe(SAFE_PALETTE.solid);
    setColourBlindSafe(false);
    expect(PALETTE).toEqual(NORMAL_PALETTE);
  });
});
