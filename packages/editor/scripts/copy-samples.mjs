// Copies the finished sample games (templates/<id>/) next to the built editor files, so "Open the sample" can find them.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(here, '..', '..', '..', 'templates');
const to = path.resolve(here, '..', 'dist', 'samples');
fs.rmSync(to, { recursive: true, force: true });
if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true });
process.stdout.write(`samples: ${fs.existsSync(to) ? fs.readdirSync(to).join(', ') || '(none)' : '(none)'}\n`);
