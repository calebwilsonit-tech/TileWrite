/**
 * Inline formatting for the game's text (conversations, choices, messages): `[b]bold[/b]`, `[i]italic[/i]`, `[u]underline[/u]`,
 * `[s]strike[/s]` and `[color=red]coloured[/color]` (a name or #rrggbb). Tags nest. Write `[[` for a literal `[`. Anything that is
 * not one of these tags is plain text, so a line like "Press [E] to talk" reads as written.
 */

export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** CSS colour (#rrggbb). */
  color?: string;
}

export const NAMED_COLORS: Record<string, string> = {
  red: '#ff6b6b',
  orange: '#ffa94d',
  yellow: '#ffe066',
  gold: '#ffd98a',
  green: '#69db7c',
  blue: '#74b9ff',
  purple: '#c3a6ff',
  pink: '#ff9ecf',
  gray: '#b0b3bd',
  white: '#ffffff',
  black: '#101216',
};

const TAG = /\[(\/?)(b|i|u|s|color)(?:=([#A-Za-z0-9]+))?\]/g;

export function resolveColor(value: string): string | null {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  return NAMED_COLORS[value.toLowerCase()] ?? null;
}

interface Style {
  bold: number;
  italic: number;
  underline: number;
  strike: number;
  colors: string[];
}

/** The text cut into pieces that each have one look. Unbalanced or unknown tags are left as ordinary text. */
export function parseRichText(text: string): TextSpan[] {
  const out: TextSpan[] = [];
  const st: Style = { bold: 0, italic: 0, underline: 0, strike: 0, colors: [] };
  const push = (raw: string): void => {
    const t = raw.replace(/\[\[/g, '[');
    if (t === '') return;
    const span: TextSpan = { text: t };
    if (st.bold > 0) span.bold = true;
    if (st.italic > 0) span.italic = true;
    if (st.underline > 0) span.underline = true;
    if (st.strike > 0) span.strike = true;
    if (st.colors.length > 0) span.color = st.colors[st.colors.length - 1];
    const last = out[out.length - 1];
    if (last && last.bold === span.bold && last.italic === span.italic && last.underline === span.underline && last.strike === span.strike && last.color === span.color) last.text += span.text;
    else out.push(span);
  };
  let at = 0;
  for (const m of text.matchAll(TAG)) {
    const index = m.index!;
    // "[[b]" is a literal "[b]", not a tag
    if (index > 0 && text[index - 1] === '[') continue;
    const closing = m[1] === '/';
    const name = m[2]!;
    const arg = m[3];
    if (name === 'color' && !closing) {
      const c = arg ? resolveColor(arg) : null;
      if (!c) continue; // an unknown colour: leave the tag as text
      push(text.slice(at, index));
      st.colors.push(c);
    } else {
      if (!closing && arg !== undefined) continue; // [b=1] is not a tag
      push(text.slice(at, index));
      const key = name === 'b' ? 'bold' : name === 'i' ? 'italic' : name === 'u' ? 'underline' : name === 's' ? 'strike' : 'colors';
      if (key === 'colors') {
        if (closing) st.colors.pop();
      } else st[key] += closing ? (st[key] > 0 ? -1 : 0) : 1;
    }
    at = index + m[0].length;
  }
  push(text.slice(at));
  return out;
}

/** The words with the tags taken out. */
export function plainText(text: string): string {
  return parseRichText(text)
    .map((s) => s.text)
    .join('');
}

/** Mistakes in the tags of a text, in plain English (a tag that is never closed, a closing tag with no opening one). */
export function richTextProblems(text: string): string[] {
  const out: string[] = [];
  const open: Record<string, number> = { b: 0, i: 0, u: 0, s: 0, color: 0 };
  for (const m of text.matchAll(TAG)) {
    const index = m.index!;
    if (index > 0 && text[index - 1] === '[') continue;
    const name = m[2]!;
    if (m[1] === '/') {
      if (open[name]! === 0) out.push(`There is a closing [/${name}] with no [${name}] before it.`);
      else open[name]!--;
    } else if (name === 'color') {
      if (!m[3] || !resolveColor(m[3])) out.push(`[color=${m[3] ?? ''}] is not a colour: use a name (${Object.keys(NAMED_COLORS).join(', ')}) or #rrggbb.`);
      else open.color!++;
    } else if (m[3] === undefined) open[name]!++;
  }
  for (const [name, n] of Object.entries(open)) if (n > 0) out.push(`[${name}] is never closed: add [/${name}].`);
  return out;
}
