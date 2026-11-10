import { describe, expect, it } from 'vitest';
import type { UiNode, UiStyle } from '@tilewright/runtime';
import { COLOR, THEME, TYPE } from '../src/ui/kit';
import { project } from './helpers';

/** The screens keep to DESIGN.md, section 5: the theme's colours, five type sizes, spacing in fours, and every button leads somewhere. */
const SIZES = new Set<number>(Object.values(TYPE));
const PLAIN = new Set<string>(Object.values(COLOR));
const colourOk = (c: string): boolean => PLAIN.has(c) || /^color-mix\(in srgb, var\(--tw-(panel|border|highlight)\) \d+%, (transparent|var\(--tw-panel\))\)$/.test(c);

function nodes(root: UiNode): UiNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

describe('the interface', () => {
  it('has the theme of the design document', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { PROJECT_DIR } = await import('./helpers');
    const layout = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'assets', 'ui.json'), 'utf8')) as { theme: Record<string, unknown> };
    expect(layout.theme).toEqual({ ...THEME });
  });

  it('has every screen of the design, each with one heading and a hint line', async () => {
    const p = await project();
    expect(p.ui.screens.map((s) => s.name).sort()).toEqual(['Chapter', 'Controls', 'HUD', 'How to play', 'Pause', 'Rooms', 'Settings', 'The end', 'Title'].sort());
    for (const s of p.ui.screens) {
      if (s.name === 'HUD') continue;
      const all = nodes(s.root);
      expect(all.filter((n) => n.name === 'Heading' || n.name === 'Game title').length, `${s.name}: one heading`).toBe(1);
      expect(all.filter((n) => n.name === 'Hint').length, `${s.name}: one hint line`).toBe(1);
      expect(s.modal, `${s.name} holds the game while it is open`).toBe(true);
    }
  });

  it('uses only the colours, type sizes and spacing of the design', async () => {
    const p = await project();
    const wrong: string[] = [];
    for (const s of p.ui.screens) {
      for (const n of nodes(s.root)) {
        const styles: [string, UiStyle | undefined][] = [['', n.style], ['hover', n.states.hover], ['focus', n.states.focus], ['pressed', n.states.pressed], ['disabled', n.states.disabled]];
        for (const [state, st] of styles) {
          if (!st) continue;
          for (const key of ['fill', 'border', 'color'] as const) if (st[key] !== undefined && !colourOk(st[key]!)) wrong.push(`${s.name} / ${n.name}${state ? ` (${state})` : ''}: ${key} ${st[key]}`);
          if (st.fontSize !== undefined && !SIZES.has(st.fontSize)) wrong.push(`${s.name} / ${n.name}: type size ${st.fontSize}`);
          if (st.radius !== undefined && ![6, 8, 10].includes(st.radius)) wrong.push(`${s.name} / ${n.name}: radius ${st.radius}`);
        }
        if (n.type === 'text' && n.style.fontSize === undefined) wrong.push(`${s.name} / ${n.name}: words with no type size`);
        if (n.type === 'panel' && n.children.length > 0 && n.layout !== 'free') {
          if (n.gap % 4 !== 0) wrong.push(`${s.name} / ${n.name}: gap ${n.gap}`);
          if (n.padding % 4 !== 0) wrong.push(`${s.name} / ${n.name}: padding ${n.padding}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('has no button that leads nowhere, and every menu can be left', async () => {
    const p = await project();
    const names = new Set(p.ui.screens.map((s) => s.name));
    const roles = new Set(['title', 'pause', 'settings', 'controls', 'hud']);
    const wrong: string[] = [];
    const scenes = new Set(p.project.scenes);
    for (const s of p.ui.screens) {
      let leaves = s.back !== 'nothing';
      for (const n of nodes(s.root)) {
        for (const a of [...n.on.click, ...n.on.change]) {
          if (a.type === 'uiScreen') {
            const target = String(a.params.screen ?? '');
            const op = String(a.params.op ?? 'open');
            if (op === 'back' || op === 'close') leaves = true;
            if (op !== 'back' && !(target.startsWith('role:') ? roles.has(target.slice(5)) : names.has(target))) wrong.push(`${s.name} / ${n.name}: ${op} "${target}", which is not a screen`);
          }
          if (a.type === 'travel' && !String(a.params.scene).includes('{') && !scenes.has(String(a.params.scene))) wrong.push(`${s.name} / ${n.name}: goes to a scene that is not in the game`);
        }
        if (n.type === 'button' || (n.type === 'panel' && n.on.click.length === 0 && n.states.hover && n.name !== 'Room card')) {
          if (n.on.click.length === 0) wrong.push(`${s.name} / ${n.name}: looks like a button and does nothing`);
        }
      }
      if (s.name !== 'HUD' && !leaves) wrong.push(`${s.name}: there is no way to leave this screen`);
    }
    expect(wrong).toEqual([]);
  });

  it('says things plainly: no exclamation marks, no shouting', async () => {
    const p = await project();
    for (const s of p.ui.screens) for (const n of nodes(s.root)) {
      const t = n.text.replace(/\{[^}]*\}/g, '');
      expect(t, `${s.name} / ${n.name}`).not.toContain('!');
      if (t.length > 6) expect(t === t.toUpperCase() && /[A-Z]/.test(t), `${s.name} / ${n.name} is all capitals`).toBe(false);
    }
  });
});
