#!/usr/bin/env node
// npm create tilewright-plugin my-plugin                       (the general starter: a behaviour, an event block and a panel)
// npm create tilewright-plugin my-plugin -- --starter widget   (the example for one extension point; --starters lists them)
// or: node bin.mjs my-plugin --sdk ../path/to/tilewright/packages/plugin-sdk
import path from 'node:path';
import process from 'node:process';

const say = (text) => process.stdout.write(`${text}
`);

const args = process.argv.slice(2);
// the scaffolding is TypeScript so the editor's tests can use it; node 22+ runs it directly
const { scaffold, STARTERS } = await import('./src/scaffold.ts');
if (args.includes('--starters')) {
  say(`One starter for every kind of thing a plugin can add (npm create tilewright-plugin my-plugin -- --starter <name>):\n\n${STARTERS.map((s) => `  ${s.id.padEnd(18)} ${s.title}: ${s.description}`).join('\n')}`);
  process.exit(0);
}
const valueOf = (flag) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
};
const skipped = new Set([valueOf('--sdk'), valueOf('--starter')].filter(Boolean));
const name = args.find((a) => !a.startsWith('-') && !skipped.has(a));
if (!name) {
  process.stderr.write(`${'Say what to call the plugin:  npm create tilewright-plugin my-plugin'}
`);
  process.exit(1);
}
let made;
try {
  made = scaffold(path.resolve(name), { sdk: valueOf('--sdk'), starter: valueOf('--starter') });
} catch (e) {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
say(`Made ${made.dir}\n\n${made.files.map((f) => `  ${f}`).join('\n')}\n\nNext:\n  cd ${name}\n  npm install\n  npm run build   # makes plugin.cjs${valueOf('--starter') ? '' : ' and editor.cjs'}\n  npm test\n\nThen in Tilewright: Project settings -> Plugins -> Open a folder for development, and choose this folder.`);
