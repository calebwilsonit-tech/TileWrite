// Builds the plugin SDK as a package that can be published: `npm run build -w @tilewright/plugin-sdk` makes packages/plugin-sdk/dist/,
// which is the package itself (publish that folder: `npm publish packages/plugin-sdk/dist`). The engine's own packages (runtime, behaviors,
// playbot and the pieces that moved into plugins) are inside it, so the only things it asks for are pixi.js and zod, with real versions.
//
//   node packages/plugin-sdk/scripts/build.mjs [--out <folder>]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const root = path.resolve(pkgDir, '..', '..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const { build } = require('esbuild');

const outAt = process.argv.indexOf('--out');
const out = path.resolve(outAt >= 0 ? process.argv[outAt + 1] : path.join(pkgDir, 'dist'));
const workspace = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const entries = { index: 'src/index.ts', legacy: 'src/legacy.ts', testing: 'src/testing.ts' };

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// ---- the code: one bundle per entry, sharing what they share; the engine's packages are inside ----
await build({
  entryPoints: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, path.join(pkgDir, v)])),
  outdir: out,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  external: ['pixi.js', 'zod', 'vitest', 'esbuild', 'react', 'node:*'],
  logLevel: 'warning',
});

// ---- the types: declarations of the same files, with the engine's package names turned into paths inside the package ----
const dirOf = (name) => (name === 'runtime' || name === 'behaviors' || name === 'playbot' || name === 'plugin-sdk' ? path.join(root, 'packages', name) : path.join(root, 'packages', 'plugins', name.replace(/^plugin-/, '')));
function resolveSpecifier(spec) {
  const m = /^@tilewright\/([a-z-]+)(\/.*)?$/.exec(spec);
  if (!m) return null;
  const dir = dirOf(m[1]);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const key = m[2] ? `.${m[2]}` : '.';
  const target = pj.exports?.[key] ?? (key === '.' ? pj.main : undefined);
  if (typeof target !== 'string') throw new Error(`cannot find ${spec}`);
  return path.join(dir, target).replace(/\.tsx?$/, '');
}
// the engine's packages are read from their sources (as part of this program, so their declarations are made too)
const paths = {};
for (const name of ['runtime', 'behaviors', 'playbot', 'plugin-sdk', ...fs.readdirSync(path.join(root, 'packages', 'plugins')).map((d) => `plugin-${d}`)]) {
  const dir = dirOf(name);
  if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  for (const [key, target] of Object.entries(pj.exports ?? { '.': pj.main })) if (typeof target === 'string') paths[`@tilewright/${name}${key === '.' ? '' : key.slice(1)}`] = [path.join(dir, target)];
}
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const typesDir = path.join(out, 'types');
const program = ts.createProgram(
  ['index', 'legacy', 'testing'].map((k) => path.join(pkgDir, entries[k])).concat(path.join(pkgDir, 'src/editor-ui.ts')),
  { ...parsed.options, noEmit: false, declaration: true, emitDeclarationOnly: true, declarationMap: false, incremental: false, composite: false, tsBuildInfoFile: undefined, outDir: typesDir, rootDir: root, paths, skipLibCheck: true, allowImportingTsExtensions: false },
);
const emitted = program.emit(undefined, undefined, undefined, true);
const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
if (errors.length > 0) {
  process.stderr.write(`${errors.slice(0, 5).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')}\n`);
  process.exit(1);
}
if (emitted.emitSkipped) throw new Error('the declarations were not made');
function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (p.endsWith('.d.ts')) yield p;
  }
}
for (const f of files(typesDir)) {
  const text = fs.readFileSync(f, 'utf8');
  const fixed = text.replace(/(from |import\()(['"])(@tilewright\/[^'"]+)\2/g, (m, pre, q, spec) => {
    const target = resolveSpecifier(spec);
    if (!target) return m;
    let rel = path.relative(path.dirname(f), path.join(typesDir, path.relative(root, target))).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return `${pre}${q}${rel}${q}`;
  });
  if (fixed !== text) fs.writeFileSync(f, fixed);
}

// ---- the package ----
const typeOf = (src) => `./types/packages/plugin-sdk/${src.replace(/\.ts$/, '.d.ts')}`;
const manifest = {
  name: workspace.name,
  version: workspace.version,
  description: workspace.description,
  license: 'MIT',
  type: 'module',
  main: './index.js',
  types: typeOf(entries.index),
  exports: {
    '.': { types: typeOf(entries.index), import: './index.js' },
    './legacy': { types: typeOf(entries.legacy), import: './legacy.js' },
    './testing': { types: typeOf(entries.testing), import: './testing.js' },
    './editor-ui': { types: typeOf('src/editor-ui.ts') },
  },
  files: ['*.js', 'types', 'README.md'],
  dependencies: { 'pixi.js': workspace.publishDependencies['pixi.js'], zod: workspace.publishDependencies.zod },
  peerDependencies: { react: '>=19', vitest: '>=3' },
  peerDependenciesMeta: { react: { optional: true }, vitest: { optional: true } },
};
fs.writeFileSync(path.join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(
  path.join(out, 'README.md'),
  `# ${workspace.name}\n\nThe API for writing Tilewright plugins: \`definePlugin\`, the plugin api and the shapes of everything a plugin can add, and helpers for the engine's own data.\nSee docs/plugins in the Tilewright repository. \`${workspace.name}/legacy\` is the whole engine as the SDK used to export it (deprecated).\n\n\`${workspace.name}/testing\` has the helpers for testing a plugin against a small running game.\n`,
);
process.stdout.write(`built ${pathToFileURL(out).href}\n`);
