// Copies the finished sample games the plugins ship (packages/plugins/<id>/samples/<name>/) next to the built editor files, so "Open the sample" can find them.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const plugins = path.resolve(here, '..', '..', 'plugins');
const to = path.resolve(here, '..', 'dist', 'samples');
fs.rmSync(to, { recursive: true, force: true });
const copied = [];
if (fs.existsSync(plugins)) {
  for (const plugin of fs.readdirSync(plugins)) {
    const samples = path.join(plugins, plugin, 'samples');
    if (!fs.existsSync(samples)) continue;
    for (const name of fs.readdirSync(samples)) {
      fs.cpSync(path.join(samples, name), path.join(to, name), { recursive: true });
      copied.push(name);
    }
  }
}
process.stdout.write(`samples: ${copied.join(', ') || '(none)'}\n`);
