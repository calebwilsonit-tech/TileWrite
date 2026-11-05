// Writes dist/build-info.json: which release this build is, from which commit, and when. The editor shows it, the installer carries it next to the
// app (resources/build-info.json) so `npm run installed` can say which build is installed, and a release (scripts/release.mjs) is a build whose
// tree was clean and whose checks passed ("release": true).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: path.join(here, '..'), encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const commit = git('rev-parse', '--short', 'HEAD');
// a tag on exactly this commit is a release (v0.1.0)
const tag = git('describe', '--tags', '--exact-match', '--match', 'v[0-9]*', 'HEAD');
const info = {
  version: pkg.version,
  commit,
  release: tag === `v${pkg.version}`,
  builtAt: new Date().toISOString(),
};
fs.mkdirSync(path.join(here, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(here, '..', 'dist', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
process.stdout.write(`build-info: ${info.version} (${commit || 'no git'})${info.release ? ' release' : ' development build'}\n`);
