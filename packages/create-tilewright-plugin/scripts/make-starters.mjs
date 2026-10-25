// Makes src/starters.generated.json: one starter plugin for every extension point, taken from the examples in packages/plugin-examples
// (which are complete, tested plugins). Run it after changing an example: `node packages/create-tilewright-plugin/scripts/make-starters.mjs`.
// The test in src/starters.test.ts fails when the generated file is out of date.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.resolve(here, '..', '..', 'plugin-examples', 'src');
const out = path.resolve(here, '..', 'src', 'starters.generated.json');

const FILES = ['game', 'ui', 'editor', 'tools'];
const read = (name) => fs.readFileSync(path.join(examples, `${name}.ts`), 'utf8').replace(/\r\n/g, '\n');

/** The index of the ")" that closes the "(" at `open`, skipping over strings. */
function closing(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  throw new Error('unbalanced');
}

// which example is for which point (the order of EXAMPLES)
const index = fs.readFileSync(path.join(examples, 'index.ts'), 'utf8');
const points = [...index.matchAll(/\{ point: '([^']+)', plugin: (\w+) \}/g)].map((m) => ({ point: m[1], ident: m[2] }));

const sections = new Map(); // ident -> { file, imports, body, others }
for (const file of FILES) {
  const text = read(file);
  const imports = text.split('\n').filter((l) => l.startsWith('import ') && !l.includes("from './"));
  const parts = text.split(/^\/\/ ---------- .* ----------$/m);
  // what a section declares that is not an example plugin (a helper another section may use)
  const helpers = parts.map((body) => [...body.matchAll(/^(?:export )?(?:const|function) (\w+)/gm)].map((m) => m[1]).filter((n) => !/Example$/.test(n) && n !== 'editorPart'));
  parts.forEach((body, i) => {
    for (const m of body.matchAll(/^export const (\w+)(?:: PluginDefinition\b| = editorPart\()/gm)) {
      // the other sections of the file whose helpers this one uses come along
      const others = parts.filter((_p, j) => j !== i && helpers[j].some((n) => new RegExp(`\\b${n}\\b`).test(body)));
      sections.set(m[1], { file, imports, body, others });
    }
  });
}

const starters = [];
for (const { point, ident } of points) {
  const s = sections.get(ident);
  if (!s) throw new Error(`no source for the example ${ident}`);
  let body = [...s.others.map((o) => o.trim()), s.body.trim()].join('\n\n');
  // the manifest every example builds with manifestOf(id, name, description) becomes the starter's own plugin.json
  let info = null;
  if (body.includes('editorPart(')) {
    // the editor-part examples are built with a small helper; the starter carries it, and takes its name and words from the first call
    const at = body.indexOf('editorPart(');
    const first = body.slice(at + 'editorPart('.length);
    const quoted = [...first.matchAll(/^\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)][0];
    if (!quoted) throw new Error(`cannot read the words of ${ident}`);
    info = [quoted[1], quoted[2], quoted[3]];
    body = "const editorPart = (_id: string, _name: string, _description: string, installEditor: NonNullable<PluginDefinition['installEditor']>): PluginDefinition => definePlugin(manifest, { install: () => undefined, installEditor });\n\n" + body;
  }
  for (let at = body.indexOf('manifestOf('); at >= 0; at = body.indexOf('manifestOf(')) {
    const end = closing(body, at + 'manifestOf'.length);
    if (!info) info = new Function(`return [${body.slice(at + 'manifestOf('.length, end)}]`)();
    body = body.slice(0, at) + 'manifest' + body.slice(end + 1);
  }
  const deps = {};
  if (s.imports.some((l) => l.includes("from 'zod'"))) deps.zod = '^4.6.7';
  const source = [...s.imports, "import manifest from '../plugin.json' with { type: 'json' };", '', body, '', `export default ${ident};`, ''].join('\n');
  starters.push({
    id: point.replace(/ \/ .*$/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
    point,
    title: info ? String(info[1]).replace(/^Example: /, '') : point,
    description: info ? String(info[2]) : '',
    deps,
    source,
  });
}

const ids = starters.map((s) => s.id);
if (new Set(ids).size !== ids.length) throw new Error(`two starters have the same id: ${ids.join(', ')}`);
const text = `${JSON.stringify(starters, null, 2)}
`;
if (process.argv.includes('--check')) {
  const have = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (have.replace(/\r\n/g, '\n') !== text) {
    process.stderr.write('src/starters.generated.json is out of date: run node packages/create-tilewright-plugin/scripts/make-starters.mjs\n');
    process.exit(1);
  }
} else {
  fs.writeFileSync(out, text);
  process.stdout.write(`${starters.length} starters\n`);
}
