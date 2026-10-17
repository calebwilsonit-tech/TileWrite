import { behaviorList, type BehaviorDef, type FieldSpec } from './framework';
import { ACTIONS, CONDITIONS, type ActionDef, type ConditionDef, type ParamSpec } from './events/sheet';

/**
 * The reference pages for every behaviour and every event block, written from the registries themselves, so what the
 * docs say can never drift from what the editor offers (a test compares them with the files in `docs/`).
 */

const PHASES: Record<string, string> = {
  control: 'moves things (runs first)',
  source: 'makes signals',
  logic: 'combines signals',
  actuator: 'reacts to signals (runs last)',
};

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function show(v: unknown): string {
  if (typeof v === 'string') return v === '' ? '(empty)' : `"${v}"`;
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}

function range(f: { min?: number; max?: number; options?: { value: string; label: string }[] }): string {
  if (f.options && f.options.length > 0) return f.options.map((o) => `\`${o.value}\``).join(', ');
  if (f.min !== undefined && f.max !== undefined) return `${f.min} to ${f.max}`;
  if (f.min !== undefined) return `at least ${f.min}`;
  if (f.max !== undefined) return `at most ${f.max}`;
  return '';
}

function settingsTable(def: BehaviorDef): string[] {
  if (def.fields.length === 0) return ['This behaviour has no settings.'];
  const rows = def.fields.map((f: FieldSpec) => {
    const d = (def.defaults as Record<string, unknown>)[f.key];
    return `| ${cell(f.label)} | \`${f.key}\` | ${f.type} | ${cell(show(d))} | ${cell(range(f))}${f.help ? `${range(f) ? '. ' : ''}${cell(f.help)}` : ''} |`;
  });
  return ['| Setting | Key | Kind | Starts as | Choices and notes |', '| --- | --- | --- | --- | --- |', ...rows];
}

export function behavioursMarkdown(): string {
  const all = behaviorList().filter((b) => !b.hidden);
  const categories = [...new Set(all.map((b) => b.category))].sort((a, b) => a.localeCompare(b));
  const out: string[] = [
    '# Behaviours',
    '',
    '<!-- Generated from the behaviour registry by packages/behaviors/src/docs.test.ts. Run `UPDATE_DOCS=1 npx vitest run packages/behaviors/src/docs.test.ts` after changing a behaviour. -->',
    '',
    'A behaviour is ready-made logic you add to an object in the Inspector (**Behaviours -> Add**). Its settings appear as fields; its signals can be joined to other objects with the Wire tool. Each behaviour has an id (the key under which it is saved) shown in `code`.',
    '',
    `There are ${all.length} behaviours. Behaviours made by scripts (see [code-window.md](code-window.md)) appear in the same list under "Scripts".`,
    '',
    ...categories.map((c) => `- [${c}](#${c.toLowerCase().replace(/[^a-z0-9]+/g, '-')}) (${all.filter((b) => b.category === c).map((b) => b.name).join(', ')})`),
    '',
  ];
  for (const category of categories) {
    out.push(`## ${category}`, '');
    for (const def of all.filter((b) => b.category === category).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`### ${def.name}`, '', `Id: \`${def.id}\`. Each update it ${PHASES[def.phase] ?? def.phase}.`, '', def.description, '', ...settingsTable(def), '');
      if (def.inputs.length > 0) out.push(`Receives: ${def.inputs.map((s) => `**${s.label}** (\`${s.name}\`${s.help ? `, ${s.help}` : ''})`).join('; ')}.`, '');
      if (def.outputs.length > 0) out.push(`Sends: ${def.outputs.map((s) => `**${s.label}** (\`${s.name}\`${s.help ? `, ${s.help}` : ''})`).join('; ')}.`, '');
      const needs = Object.keys(def.requires);
      if (needs.length > 0) out.push(`Adds automatically: ${needs.map((n) => `\`${n}\``).join(', ')}.`, '');
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function paramTable(params: ParamSpec[]): string[] {
  if (params.length === 0) return ['No parameters.'];
  return [
    '| Parameter | Key | Kind | Starts as | Choices and notes |',
    '| --- | --- | --- | --- | --- |',
    ...params.map((p) => `| ${cell(p.label)} | \`${p.key}\` | ${p.type} | ${cell(show(p.default))} | ${cell(range(p))}${p.help ? `${range(p) ? '. ' : ''}${cell(p.help)}` : ''} |`),
  ];
}

export function eventBlocksMarkdown(): string {
  const section = (title: string, blurb: string, defs: (ConditionDef | ActionDef)[]): string[] => {
    const cats = [...new Set(defs.map((d) => d.category))];
    const lines: string[] = [`## ${title}`, '', blurb, ''];
    for (const c of cats) {
      lines.push(`### ${c}`, '');
      for (const d of defs.filter((x) => x.category === c)) lines.push(`#### ${d.label}`, '', `Id: \`${d.id}\`.`, '', ...paramTable(d.params), '');
    }
    return lines;
  };
  const out = [
    '# Event blocks',
    '',
    '<!-- Generated from the event registries by packages/behaviors/src/docs.test.ts. Run `UPDATE_DOCS=1 npx vitest run packages/behaviors/src/docs.test.ts` after changing a block. -->',
    '',
    'An event sheet is a list of rows, each reading like a sentence: **when** its conditions hold, **do** its actions. Rows can have sub-events that run only while the row holds. Objects are chosen as "the player", "anything tagged ...", or a particular object. See [logic.md](logic.md).',
    '',
    `There are ${CONDITIONS.length} conditions and ${ACTIONS.length} actions.`,
    '',
    ...section('Conditions', 'What a row waits for.', CONDITIONS),
    ...section('Actions', 'What a row does.', ACTIONS),
  ];
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
