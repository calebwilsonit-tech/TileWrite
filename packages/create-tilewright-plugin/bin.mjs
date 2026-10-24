#!/usr/bin/env node
// npm create tilewright-plugin my-plugin   (or: node bin.mjs my-plugin --sdk ../path/to/tilewright/packages/plugin-sdk)
import path from 'node:path';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('-'));
const sdkAt = args.indexOf('--sdk');
if (!name) {
  console.error('Say what to call the plugin:  npm create tilewright-plugin my-plugin');
  process.exit(1);
}
// the scaffolding is TypeScript so the editor's tests can use it; node 22+ runs it directly
const { scaffold } = await import('./src/scaffold.ts');
const made = scaffold(path.resolve(name), { sdk: sdkAt >= 0 ? args[sdkAt + 1] : undefined });
console.log(`Made ${made.dir}\n\n${made.files.map((f) => `  ${f}`).join('\n')}\n\nNext:\n  cd ${name}\n  npm install\n  npm run build   # makes plugin.cjs and editor.cjs\n  npm test\n\nThen in Tilewright: Project settings -> Plugins -> Open a folder for development, and choose this folder.`);
