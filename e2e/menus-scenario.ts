import type { Page } from '@playwright/test';

/**
 * Round 2, item 3.2: the game's own menus before and after they became designer screens. The same presses are played in two
 * builds of the editor (the one from before phase 3, `4cd481c`, which drew the menus itself, and this one, where they are
 * screens), and what the player would see is written down after each: whether the game waits, the title, every row with its
 * words and its value, which row has the focus, and the player's settings. `e2e/menus-record.spec.ts` plays it; `scripts/menus-diff.mjs`
 * compares two recordings. Nothing here depends on how the menus are drawn.
 */

export interface Row {
  label: string;
  detail: string;
  focused: boolean;
}
export interface Seen {
  step: string;
  /** The game waits behind a menu. */
  waits: boolean;
  /** What is open, by the words at the top of it (empty when no menu is). */
  title: string;
  rows: Row[];
  hints: string[];
  settings?: Record<string, unknown>;
  vars?: Record<string, unknown>;
  scene?: string;
}

/** What is on the screen now, read the same way whichever build drew it. Runs in the page. */
export function observeInPage(): Omit<Seen, 'step'> {
  const w = window as unknown as { __play?: { sim: { runtime: { menuOpen?: boolean; ui: { modal: boolean; stack: string[] }; vars: Record<string, unknown>; scene: string; dialogue: unknown } }; session: { settings: Record<string, unknown> } } };
  const play = w.__play;
  const rt = play?.sim.runtime;
  const text = (e: Element | null | undefined): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const out: Omit<Seen, 'step'> = { waits: Boolean(rt && (rt.menuOpen === true || rt.ui.modal)), title: '', rows: [], hints: [] };
  const builtin = document.querySelector('[data-testid="tw-menu"]');
  if (builtin) {
    // the older build: one box drawn by the game
    out.title = text(builtin.querySelector('h1,h2'));
    out.rows = [...builtin.querySelectorAll('.tw-row')].map((r) => ({ label: text(r.children[0]), detail: text(r.querySelector('.detail')), focused: r.classList.contains('on') }));
    out.hints = [...builtin.querySelectorAll('.tw-hint')].map((h) => text(h));
  } else {
    // the screen on top is the last one opened (the order of the layers in the page is not the order they were opened in)
    const top = rt?.ui.stack[rt.ui.stack.length - 1] ?? '';
    const layer = /^HUD/.test(top) ? undefined : document.querySelector(`[data-testid="tw-screen-${top}"]`);
    if (layer) {
      const texts = [...layer.querySelectorAll('.tw-w.text')];
      out.title = text(texts[0]);
      const kinds = ['clickable', 'slider', 'dropdown', 'toggle', 'keybind'];
      const shown = (e: Element): boolean => !e.closest('.hidden') && getComputedStyle(e).display !== 'none';
      const controls = [...layer.querySelectorAll('.tw-w')].filter((e) => kinds.some((k) => e.classList.contains(k)) && !(e.parentElement?.closest('.tw-w.clickable')) && shown(e));
      const value = (e: Element): string => {
        if (e.classList.contains('slider')) {
          const input = e.querySelector('input') as HTMLInputElement | null;
          return input ? `${Math.round(Number(input.value) * 100)}%` : text(e);
        }
        if (e.classList.contains('dropdown')) return (e.querySelector('select') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent?.trim() ?? text(e);
        if (e.classList.contains('toggle')) return text(e).startsWith('☑') ? 'on' : 'off';
        return text(e);
      };
      out.rows = controls.map((c) => {
        const focused = (c as HTMLElement).dataset.focus === '1';
        if (c.classList.contains('keybind')) {
          const spans = [...c.querySelectorAll('span')].map((x) => text(x));
          return { label: spans[0] ?? '', detail: spans[1] ?? '', focused };
        }
        const control = ['slider', 'dropdown', 'toggle', 'keybind'].some((k) => c.classList.contains(k));
        if (!control && c.classList.contains('clickable')) {
          const t = [...c.querySelectorAll('.tw-w.text')].map((x) => text(x));
          return { label: t[0] ?? '', detail: t.length > 1 ? (t[t.length - 1] ?? '') : '', focused };
        }
        const label = text(c.parentElement?.querySelector(':scope > .tw-w.text'));
        return { label, detail: value(c), focused };
      });
      const hints = texts.filter((t) => t.getAttribute('data-name') === 'Hint');
      out.hints = hints.map((h) => text(h));
    }
  }
  if (play && rt) {
    out.settings = { ...play.session.settings };
    out.scene = rt.scene;
    out.vars = Object.fromEntries(Object.entries(rt.vars).filter(([k]) => /^(slot:|item:|lit:|visited:)/.test(k)));
  }
  return out;
}

export class Recorder {
  readonly seen: Seen[] = [];
  constructor(readonly page: Page) {}

  /** Hold these buttons for `ticks` steps of the game (a press is the edge: nothing, then the buttons). */
  async hold(snapshot: Record<string, number>, ticks = 1): Promise<void> {
    await this.page.evaluate(
      ([s, n]) => {
        const r = (window as unknown as { __play: { runner: { paused: boolean; inputSource: () => unknown; step(): void } } }).__play.runner;
        (window as unknown as { __store: { set(p: unknown): void } }).__store.set({ paused: true });
        r.paused = true;
        r.inputSource = () => s;
        for (let i = 0; i < (n as number); i++) r.step();
      },
      [snapshot, ticks] as const,
    );
    await this.page.waitForTimeout(90);
  }

  /** One press of a button: let go first, press, let go. */
  async press(action: string): Promise<void> {
    await this.hold({}, 2);
    await this.hold({ [action]: 1 }, 2);
    await this.hold({}, 3);
  }

  async look(step: string): Promise<Seen> {
    await this.page.waitForTimeout(60);
    const s = { step, ...(await this.page.evaluate(observeInPage)) };
    this.seen.push(s);
    return s;
  }
}

/** The player's presses: what the keys are called in the game. */
export const KEYS = { back: 'pause', ok: 'interact', up: 'move_up', down: 'move_down', left: 'move_left', right: 'move_right', inventory: 'inventory', map: 'map' } as const;

/** Play the whole script, writing down what is seen after each press. The page must be in Play with the game running. */
export async function runScript(r: Recorder): Promise<void> {
  const open = async (step: string): Promise<Seen> => r.look(step);
  const rowsOf = (s: Seen): string[] => s.rows.map((x) => x.label);

  await r.hold({}, 20);
  await open('in the game, nothing open');

  // ---- the pause menu: opens, moves (and wraps), closes ----
  await r.press(KEYS.back);
  const pause = await open('Esc: the menu opens');
  for (let i = 0; i < pause.rows.length + 1; i++) {
    await r.press(KEYS.down);
    await open(`down ${i + 1}`);
  }
  await r.press(KEYS.up);
  await open('up (wraps to the last row)');
  await r.press(KEYS.back);
  await open('Esc: the menu closes');

  // ---- every row of the pause menu, opened and left with Esc ----
  const labels = rowsOf(pause);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!;
    if (/^(resume|quit|restart)/i.test(label)) continue; // (tried below, they leave the menu)
    await r.press(KEYS.back);
    await r.hold({}, 3);
    await focusRow(r, label);
    await open(`pause, on "${label}"`);
    await r.press(KEYS.ok);
    const inside = await open(`"${label}": opened`);
    await sub(r, inside, label);
    // leave: back until the game runs again
    for (let k = 0; k < 4; k++) {
      const now = await r.look(`leaving "${label}" ${k + 1}`);
      if (!now.waits && now.rows.length === 0) break;
      await r.press(KEYS.back);
    }
    await r.look(`left "${label}"`);
  }

  // ---- the keys that open the inventory and the map directly ----
  await r.press(KEYS.inventory);
  await open('the inventory key');
  await r.press(KEYS.back);
  await open('Esc from the inventory (it was opened by its key)');
  await closeAll(r);
  await r.press(KEYS.map);
  await open('the map key');
  await r.press(KEYS.back);
  await open('Esc from the map');
  await closeAll(r);

  // ---- resume, and restart ----
  await r.press(KEYS.back);
  await r.press(KEYS.ok);
  await open('Resume chosen');
  await r.press(KEYS.back);
  await r.hold({}, 3);
  await focusRow(r, labels.find((l) => /^restart/i.test(l)) ?? 'Restart this area');
  await open('on "Restart this area"');
  await r.press(KEYS.ok);
  await r.hold({}, 5);
  await open('Restart chosen');
}

/** The title screen: what it offers, where the keys take you, and what each row does. The page must be in Play with the title up. */
export async function runTitleScript(r: Recorder, hasSave: boolean): Promise<void> {
  await r.hold({}, 10);
  // (the saves are read a moment after the title opens; the game keeps stepping while that happens)
  await r.page.waitForTimeout(400);
  await r.hold({}, 5);
  const title = await r.look(`title (${hasSave ? 'with' : 'without'} a save)`);
  for (let i = 0; i < title.rows.length; i++) {
    await r.press(KEYS.down);
    await r.look(`title: down ${i + 1}`);
  }
  await r.press(KEYS.up);
  await r.look('title: up');
  await r.press(KEYS.back);
  await r.look('title: Esc does nothing');
  for (const label of ['Load game', 'Settings']) {
    await focusRow(r, label);
    await r.press(KEYS.ok);
    await r.look(`title: "${label}" opened`);
    await r.press(KEYS.back);
    await r.look(`title: Esc from "${label}" goes back to the title`);
  }
  await focusRow(r, 'New game');
  await r.look('title: on "New game"');
  await r.press(KEYS.ok);
  await r.hold({}, 5);
  await r.look('title: New game chosen');
}

/** Move down until the row with these words has the focus (a build that remembers where the focus was, and one that does not, both get there). */
async function focusRow(r: Recorder, label: string): Promise<void> {
  for (let k = 0; k < 20; k++) {
    const s = await r.look(`(looking for "${label}")`);
    r.seen.pop();
    const at = s.rows.findIndex((x) => x.focused);
    const want = s.rows.findIndex((x) => x.label === label);
    if (want < 0 || (at >= 0 && at === want)) return;
    // (no wrapping around is relied on, and a build that has no focus yet starts from the top)
    await r.press(at >= 0 && want < at ? KEYS.up : KEYS.down);
  }
}

/** Back until nothing is open (a build that goes from the inventory to the pause menu and one that does not both end here). */
async function closeAll(r: Recorder): Promise<void> {
  for (let k = 0; k < 4; k++) {
    const s = await r.look('(closing)');
    r.seen.pop();
    if (!s.waits && s.rows.length === 0) return;
    await r.press(KEYS.back);
  }
}

/** What to do inside one screen of the menu: move around, change values, choose rows. */
async function sub(r: Recorder, inside: Seen, label: string): Promise<void> {
  const n = inside.rows.length;
  if (n === 0) return;
  if (/^settings/i.test(label)) {
    // every row: left, right, choose, and each one's words afterwards
    for (let i = 0; i < n; i++) {
      await r.look(`settings row ${i + 1} (${inside.rows[i]!.label})`);
      // (the camera zoom was a list of four sizes that the arrows went round, and is a slider now: not compared, see DECISIONS)
      if (/zoom/i.test(inside.rows[i]!.label)) {
        await r.press(KEYS.down);
        continue;
      }
      await r.press(KEYS.right);
      await r.look(`settings row ${i + 1}: right`);
      await r.press(KEYS.left);
      await r.press(KEYS.left);
      await r.look(`settings row ${i + 1}: left, left`);
      await r.press(KEYS.right);
      // (E on a volume or the camera zoom is not tried: it used to mute and to cycle, and a slider does neither; see DECISIONS)
      if (!/^controls$|volume|zoom/i.test(inside.rows[i]!.label)) {
        await r.press(KEYS.ok);
        await r.look(`settings row ${i + 1}: chosen`);
      }
      await r.press(KEYS.down);
    }
    // Controls: its rows, and Esc goes back to Settings
    await r.press(KEYS.up);
    await r.press(KEYS.ok);
    const controls = await r.look('controls: opened');
    await r.press(KEYS.down);
    await r.look('controls: down');
    await r.press(KEYS.back);
    await r.look('controls: Esc goes to settings');
    void controls;
    return;
  }
  if (/^(save|load)/i.test(label)) {
    // (the first row of Load is the autosave, which is empty here and inert; the first row of the new Load is the first save there is)
    if (/^save/i.test(label)) {
      await r.press(KEYS.ok);
      await r.look(`${label}: first row chosen`);
    }
    await r.press(KEYS.down);
    await r.look(`${label}: down`);
    return;
  }
  if (/^inventory/i.test(label)) {
    await r.press(KEYS.right);
    await r.look('inventory: quick slot, right');
    await r.press(KEYS.left);
    await r.look('inventory: quick slot, left');
    await r.press(KEYS.ok);
    await r.look('inventory: use');
    return;
  }
  await r.press(KEYS.down);
  await r.look(`${label}: down`);
  // (choosing a place or a lantern takes the player to another scene, which starts the game again: that is not played here)
  if (/travel|map/i.test(label)) return;
  await r.press(KEYS.ok);
  await r.look(`${label}: chosen`);
}
