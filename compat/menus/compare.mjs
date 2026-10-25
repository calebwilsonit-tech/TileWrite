// Compares two recordings of the game's own menus (see e2e/menus-scenario.ts) and says what a player would notice that is different:
// whether the game waits, the title, the rows (their words, their values, which one has the focus) and the player's settings.
//
//   node compat/menus/compare.mjs old.json new.json      prints every difference, and says which ones are explained
//
// The differences that are meant are listed, each with its reason, in intended.json. A difference that is not listed fails the
// check (e2e/menus-record.spec.ts runs it against the recording of the older build kept in this folder).
import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Dates and times in the values are blanked first. */
const clean = (s) => String(s ?? '').replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/g, '<time>').replace(/\b\d+ min\b/g, '<n> min');

/** Every difference as { step, note }. */
export function compareRecordings(a, b) {
  const out = [];
  const byStep = new Map(b.map((s) => [s.step, s]));
  for (const o of a) {
    const n = byStep.get(o.step);
    if (!n) {
      out.push({ step: o.step, note: 'step only in the older build' });
      continue;
    }
    if (o.waits !== n.waits) out.push({ step: o.step, note: `the game waits: ${o.waits} -> ${n.waits}` });
    if (o.title !== n.title) out.push({ step: o.step, note: `title: "${o.title}" -> "${n.title}"` });
    const ol = o.rows.map((r) => r.label);
    const nl = n.rows.map((r) => r.label);
    const lost = ol.filter((x) => !nl.includes(x));
    const gained = nl.filter((x) => !ol.includes(x));
    if (lost.length) out.push({ step: o.step, note: `rows gone: ${lost.join(', ')}` });
    if (gained.length) out.push({ step: o.step, note: `rows new: ${gained.join(', ')}` });
    for (const r of o.rows) {
      const m = n.rows.find((x) => x.label === r.label);
      if (m && clean(m.detail) !== clean(r.detail)) out.push({ step: o.step, note: `"${r.label}" says [${clean(r.detail)}] -> [${clean(m.detail)}]` });
    }
    const of = o.rows.findIndex((r) => r.focused);
    const nf = n.rows.findIndex((r) => r.focused);
    const ofl = of >= 0 ? o.rows[of].label : '(none)';
    const nfl = nf >= 0 ? n.rows[nf].label : '(none)';
    if (ofl !== nfl) out.push({ step: o.step, note: `focus: ${ofl} -> ${nfl}` });
    for (const k of new Set([...Object.keys(o.settings ?? {}), ...Object.keys(n.settings ?? {})])) {
      const x = JSON.stringify(o.settings?.[k]);
      const y = JSON.stringify(n.settings?.[k]);
      if (x !== y) out.push({ step: o.step, note: `setting ${k}: ${x} -> ${y}` });
    }
    for (const k of new Set([...Object.keys(o.vars ?? {}), ...Object.keys(n.vars ?? {})])) {
      const x = JSON.stringify(o.vars?.[k]);
      const y = JSON.stringify(n.vars?.[k]);
      if (x !== y) out.push({ step: o.step, note: `variable ${k}: ${x} -> ${y}` });
    }
  }
  for (const n of b) if (!a.some((o) => o.step === n.step)) out.push({ step: n.step, note: 'step only in the new build' });
  return out;
}

/** The differences that are meant: [{ step: regex, note: regex, why }]. */
export function intended() {
  return JSON.parse(fs.readFileSync(path.join(here, 'intended.json'), 'utf8')).map((e) => ({ ...e, step: new RegExp(e.step), note: new RegExp(e.note) }));
}

/** Split differences into the ones that are explained (with the reason) and the ones that are not. */
export function sortOut(diffs) {
  const rules = intended();
  const explained = [];
  const unexplained = [];
  for (const d of diffs) {
    const rule = rules.find((r) => r.step.test(d.step) && r.note.test(d.note));
    if (rule) explained.push({ ...d, why: rule.why });
    else unexplained.push(d);
  }
  return { explained, unexplained };
}

export const readRecording = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const say = (text) => process.stdout.write(text + String.fromCharCode(10));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [oldFile, newFile] = process.argv.slice(2);
  if (!oldFile || !newFile) {
    say('usage: node compat/menus/compare.mjs old.json new.json');
    process.exit(2);
  }
  const a = readRecording(oldFile);
  const b = readRecording(newFile);
  const { explained, unexplained } = sortOut(compareRecordings(a, b));
  say(`${a.length} steps in the older build, ${b.length} in the new; ${explained.length} differences are meant, ${unexplained.length} are not explained.`);
  for (const d of unexplained) say(`  NOT EXPLAINED  ${d.step}: ${d.note}`);
  for (const d of explained) say(`  meant          ${d.step}: ${d.note}   (${d.why})`);
  process.exit(unexplained.length === 0 ? 0 : 1);
}
