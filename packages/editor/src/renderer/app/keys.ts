/** Keyboard shortcut specs like "Ctrl+Shift+Z" or "F5" or "R". */

export interface KeySpec {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function normKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function parseKeySpec(spec: string): KeySpec {
  // "+" itself is a key: "+" alone, or "Ctrl++"
  if (spec === '+' || spec.endsWith('++')) {
    const mods = new Set(spec.slice(0, spec.length - 1).split('+').map((m) => m.trim().toLowerCase()));
    return { ctrl: mods.has('ctrl') || mods.has('cmd'), shift: mods.has('shift'), alt: mods.has('alt'), key: '+' };
  }
  const parts = spec.split('+').map((p) => p.trim());
  const key = normKey(parts[parts.length - 1] ?? '');
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  return { ctrl: mods.has('ctrl') || mods.has('cmd'), shift: mods.has('shift'), alt: mods.has('alt'), key };
}

export function eventKeySpec(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): KeySpec {
  return { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, key: normKey(e.key) };
}

export function formatKeySpec(s: KeySpec): string {
  return [s.ctrl ? 'Ctrl' : '', s.alt ? 'Alt' : '', s.shift ? 'Shift' : '', s.key].filter(Boolean).join('+');
}

/** Does this key press match the spec? Shift only matters if the spec asks for it, except for letters. */
export function matches(spec: string, e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  const want = parseKeySpec(spec);
  const got = eventKeySpec(e);
  if (want.key !== got.key) return false;
  if (want.ctrl !== got.ctrl || want.alt !== got.alt) return false;
  // symbols like "+" need shift on many layouts, so only enforce shift for named keys and letters
  if (got.key.length === 1 && !/[A-Z0-9]/.test(got.key)) return true;
  return want.shift === got.shift;
}

/** A key press that is only a modifier cannot be a shortcut. */
export function isModifierOnly(key: string): boolean {
  return key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta';
}

/** Shortcut specs that two commands share (so the editor can warn about conflicts). */
export function findConflicts(bindings: Record<string, string>): [string, string][] {
  const byKey = new Map<string, string>();
  const out: [string, string][] = [];
  for (const [id, spec] of Object.entries(bindings)) {
    if (!spec) continue;
    const k = formatKeySpec(parseKeySpec(spec));
    const other = byKey.get(k);
    if (other) out.push([other, id]);
    else byKey.set(k, id);
  }
  return out;
}
