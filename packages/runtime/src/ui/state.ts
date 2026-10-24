import type { Assets, SceneRuntime } from '../core/simulation';
import { evalValue } from '../data/expr';
import type { ValueSource } from '../data/values';
import { roleOfScreen, screenBlocksInput, screenPauses, type UiScreen } from './model';

/** Which interface screens are open, and the yes/no questions widgets ask ("visible when gold >= 10"). Plain data and plain functions, so the game, the playbot and the tests share them. */

type Host = { runtime: SceneRuntime; assets: Assets };

/** A screen by name or id; "role:pause" means the screen that plays the Pause part. */
export const screenNamed = (assets: Assets, name: string): UiScreen | undefined => (name.startsWith('role:') ? assets.ui.screens.find((s) => roleOfScreen(s) === name.slice(5)) : assets.ui.screens.find((s) => s.name === name || s.id === name));

/** The screen that plays a role (a project's own before one a plugin offers, which the game adds with a lower priority: see `withDefaultScreens`). */
export const screenForRole = (assets: Assets, role: string): UiScreen | undefined => assets.ui.screens.find((s) => roleOfScreen(s) === role);

/** Open the screen that plays a role. False when there is none. */
export function openRole(h: Host, role: string): boolean {
  const s = screenForRole(h.assets, role);
  return s ? openScreen(h, s.name) : false;
}

/** Is a screen that plays this role open? */
export const roleOpen = (h: Host, role: string): boolean => h.runtime.ui.stack.some((n) => { const s = screenNamed(h.assets, n); return s !== undefined && roleOfScreen(s) === role; });

/** Work out from the open screens whether the game waits and whether the game's own buttons are off. */
export function sync(h: Host): void {
  const open = h.runtime.ui.stack.map((n) => screenNamed(h.assets, n));
  h.runtime.ui.modal = open.some((s) => s !== undefined && screenPauses(s));
  h.runtime.ui.blocking = open.some((s) => s !== undefined && screenBlocksInput(s));
}

/** Open a screen on top of the others. False when there is no screen by that name. */
export function openScreen(h: Host, name: string): boolean {
  const s = screenNamed(h.assets, name);
  if (!s) return false;
  const st = h.runtime.ui.stack;
  if (st[st.length - 1] !== s.name) {
    const i = st.indexOf(s.name);
    if (i >= 0) st.splice(i, 1);
    st.push(s.name);
  }
  sync(h);
  return true;
}

export function closeScreen(h: Host, name: string): void {
  const s = screenNamed(h.assets, name);
  h.runtime.ui.stack = h.runtime.ui.stack.filter((n) => n !== (s?.name ?? name));
  sync(h);
}

/** Close the screen on top (go back to the one under it). */
export function backScreen(h: Host): void {
  h.runtime.ui.stack.pop();
  sync(h);
}

export function toggleScreen(h: Host, name: string): void {
  const s = screenNamed(h.assets, name);
  if (s && h.runtime.ui.stack.includes(s.name)) closeScreen(h, name);
  else openScreen(h, name);
}

/** Close everything and open the screens that open when the game starts. */
export function openStartScreens(h: Host): void {
  h.runtime.ui.stack = [];
  // a heads-up display goes underneath, and a modal screen (the title) on top, whatever order they were made in
  const start = h.assets.ui.screens.filter((s) => s.opensOnStart);
  for (const s of [...start.filter((x) => !screenBlocksInput(x)), ...start.filter((x) => screenBlocksInput(x))]) h.runtime.ui.stack.push(s.name);
  sync(h);
}

export function topScreen(h: Host): UiScreen | undefined {
  const n = h.runtime.ui.stack[h.runtime.ui.stack.length - 1];
  return n === undefined ? undefined : screenNamed(h.assets, n);
}

// ---------- questions ----------

const OPS = /^(.*?)(>=|<=|!=|==|=|>|<)(.*)$/s;

const asNumberish = (v: ReturnType<typeof evalValue>): number | string | boolean => v;

function clause(src: ValueSource, raw: string): boolean {
  let text = raw.trim();
  let negate = false;
  while (text.startsWith('!')) {
    negate = !negate;
    text = text.slice(1).trim();
  }
  // "25%" means 0.25 (so "{hp} / {max} < 25%" reads naturally)
  const fixed = (t: string): string => t.replace(/(\d+(?:\.\d+)?)%(?!\s*[\d({])/g, (_, n: string) => String(Number(n) / 100));
  const m = OPS.exec(text);
  let result: boolean;
  if (!m) {
    const v = evalValue(src, fixed(text));
    // a name that is not known stays in braces, and counts as no
    result = v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && v !== '' && v !== 'false' && v !== '0' && !/\{[^{}]+\}/.test(v));
  } else {
    const a = asNumberish(evalValue(src, fixed(m[1]!.trim())));
    const b = asNumberish(evalValue(src, fixed(m[3]!.trim())));
    const op = m[2]!;
    const numeric = typeof a === 'number' && typeof b === 'number';
    const l = numeric ? a : String(a);
    const r = numeric ? b : String(b);
    switch (op) {
      case '>':
        result = l > r;
        break;
      case '>=':
        result = l >= r;
        break;
      case '<':
        result = l < r;
        break;
      case '<=':
        result = l <= r;
        break;
      case '!=':
        result = l !== r;
        break;
      default:
        result = l === r;
    }
  }
  return negate ? !result : result;
}

/** Does this hold? "{gold} >= 10", "{Player.health.hp} / {Player.health.max} < 25%", "{hasKey} && {door} = open". Empty means yes. */
export function evalUiCondition(src: ValueSource, text: string): boolean {
  if (text.trim() === '') return true;
  return text.split('||').some((or) => or.split('&&').every((and) => clause(src, and)));
}
