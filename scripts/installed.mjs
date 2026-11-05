// Says which Tilewright is installed on this machine, and whether it is the newest stable release or behind it.
//   npm run installed          exit code 0: the installed one is current; 1: it is behind (or not installed)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => {
  try {
    return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const out = (t) => process.stdout.write(t + '\n');
const candidates = [
  process.env.TILEWRIGHT_INSTALLED,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Tilewright'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Tilewright'),
].filter(Boolean);
const dir = candidates.find((d) => fs.existsSync(path.join(d, 'resources')));
if (!dir) {
  out('Tilewright is not installed here (looked in Program Files and AppData\\Local\\Programs).');
  process.exit(1);
}
let info = null;
try {
  info = JSON.parse(fs.readFileSync(path.join(dir, 'resources', 'build-info.json'), 'utf8'));
} catch {
  /* an install from before builds were numbered */
}
const latest = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*').replace(/^v/, '');
out(`installed in ${dir}`);
if (!info) {
  out('  an older build with no version note (from before builds were numbered)');
  out(latest ? `  newest release: ${latest}: install it` : '  no release has been made yet: npm run release -- minor');
  process.exit(1);
}
out(`  version ${info.version}, commit ${info.commit || '?'}, ${info.release ? 'a release' : 'a build between releases'}, built ${String(info.builtAt).slice(0, 16).replace('T', ' ')}`);
const head = git('rev-parse', '--short', 'HEAD');
const sinceInstall = info.commit ? Number(git('rev-list', '--count', `${info.commit}..HEAD`, '--', 'packages') || 0) : 0;
const behindRelease = latest !== '' && info.version !== latest;
if (behindRelease) out(`  behind: the newest release is ${latest}`);
if (sinceInstall > 0) out(`  ${sinceInstall} commit${sinceInstall === 1 ? '' : 's'} to the engine since this build (it is at ${head} now)${info.release ? ': normal until the next release' : ': a new build is needed'}`);
const stale = behindRelease || (!info.release && sinceInstall > 0);
if (!stale) out('  up to date');
process.exit(stale ? 1 : 0);
