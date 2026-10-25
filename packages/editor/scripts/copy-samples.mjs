// Copies the finished sample games the plugins ship next to the built editor files, so "Open the sample" can find them.
// Where a plugin keeps them is its manifest's `samples` field (a folder in the plugin's folder, each sample a project folder inside it).
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
    const manifestFile = path.join(plugins, plugin, 'plugin.json');
    if (!fs.existsSync(manifestFile)) continue;
    const folder = JSON.parse(fs.readFileSync(manifestFile, 'utf8')).samples;
    if (typeof folder !== 'string' || folder === '') continue;
    const samples = path.join(plugins, plugin, folder);
    if (!fs.existsSync(samples)) {
      process.stdout.write(`warning: the plugin "${plugin}" says its samples are in "${folder}", which is not there\n`);
      continue;
    }
    for (const name of fs.readdirSync(samples)) {
      fs.cpSync(path.join(samples, name), path.join(to, name), { recursive: true });
      copied.push(name);
    }
  }
}
process.stdout.write(`samples: ${copied.join(', ') || '(none)'}\n`);
