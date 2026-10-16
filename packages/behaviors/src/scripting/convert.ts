import type { EventRow } from '@tilewright/runtime';
import { describeRow, type Names } from '../events/sheet';

const q = (v: unknown): string => JSON.stringify(v);
const indent = (text: string, n: number): string => text.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

function rowCode(row: EventRow, names: Names | undefined, subject: string, counter: { n: number }): string {
  const comment = `// ${describeRow(row, names)}${row.comment ? ` (${row.comment})` : ''}`;
  if (!row.enabled) return `${comment}\n// (this row is switched off)`;
  // a "for each" row looks at one object at a time, under its own name
  const mine = row.forEach ? `each${++counter.n}` : subject;
  const conds = row.conditions.map((c) => `${c.negate ? '!' : ''}game.test(${q(c.type)}, ${q(c.params)}, ${mine})`);
  const truth = row.conditions.length === 0 ? 'true' : `[${conds.join(', ')}].${row.mode === 'any' ? 'some' : 'every'}(Boolean)`;
  const acts = row.actions.map((a) => `game.do(${q(a.type)}, ${q(a.params)}, ${mine});`).join('\n');
  const key = row.forEach ? `${q(`row:${row.id}@`)} + ${mine}.id` : q(`row:${row.id}`);
  const body: string[] = [];
  body.push(`const truth = ${truth};`);
  body.push(`const fire = ${row.once ? `truth && !me.state[${key}]` : 'truth'};`);
  body.push(`me.state[${key}] = truth;`);
  if (row.actions.length > 0) {
    body.push(row.repeat > 1 ? `if (fire) {\n  for (let i = 0; i < ${row.repeat}; i++) {\n${indent(acts, 4)}\n  }\n}` : `if (fire) {\n${indent(acts, 2)}\n}`);
  }
  const kids = row.children.map((k) => rowCode(k, names, mine, counter)).join('\n\n');
  if (kids) body.push(`if (truth) {\n${indent(kids, 2)}\n}`);
  const block = body.join('\n');
  if (row.forEach) return `${comment}\nfor (const ${mine} of game.findAll(${q(row.forEach)}, ${subject})) {\n${indent(block, 2)}\n}`;
  return `${comment}\n{\n${indent(block, 2)}\n}`;
}
/**
 * The scene's event sheet written as a script, for people who want to see how it works in code or carry on in code.
 * It runs the same conditions and actions through `game.test` and `game.do`, so it behaves exactly like the sheet
 * (attach the script to any object and clear the sheet).
 */
export function eventsToScript(rows: readonly EventRow[], names?: Names, name = 'Event sheet'): string {
  const counter = { n: 0 };
  const body = rows.length === 0 ? '// (the event sheet has no rows)' : rows.map((r) => rowCode(r, names, 'picked', counter)).join('\n\n');
  return [
    '/**',
    ' * Made from the scene\'s event sheet with "Convert to code".',
    ' * Each row is "when these conditions hold, do these actions". `game.test(...)` checks a condition and',
    ' * `game.do(...)` runs an action, the same ones event rows use, so you can change any of it freely.',
    ' * To use it: attach this script to any object (Behaviours -> Add), then delete the event rows.',
    ' */',
    'export default defineScript({',
    `  name: ${q(name)},`,
    '  update(me, game) {',
    '    // "picked" is the object a "for each" row is looking at (nothing outside such a row)',
    '    const picked = undefined as ScriptEntity | undefined;',
    '',
    indent(body, 4),
    '  },',
    '});',
    '',
  ].join('\n');
}