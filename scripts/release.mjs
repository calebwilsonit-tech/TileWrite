// Makes a release of Tilewright when the engine is in a stable state: checks, a new version number, a tag, the Windows installer, and a note of
// which build it is, so "what is installed" and "what is the newest stable one" can be told apart (see scripts/installed.mjs).
//
//   npm run release -- patch            0.1.0 -> 0.1.1     (a fix)
//   npm run release -- minor            0.1.0 -> 0.2.0     (something new)
//   npm run release -- major            0.1.0 -> 1.0.0
//   npm run release -- 0.3.0            exactly that
//   options: --no-push (keep the commit and tag local)  --skip-tests (only for a hurry; the release says so)  --no-installer (tag, do not build)
//
// It refuses when you are not on main, are behind origin, have changes that are not a line-ending difference, or a check fails.
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const bump = args.find((a) => !a.startsWith('--'));
const say = (t) => process.stdout.write(`[release] ${t}\n`);
const stop = (t) => {
  process.stderr.write(`[release] stopped: ${t}\n`);
  process.exit(1);
};
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const run = (cmd, a) => {
  const r = spawnSync(cmd, a, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
};

if (!bump) stop('say what kind: patch, minor, major, or a number such as 0.3.0');
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') stop('releases are made from main');
git('fetch', '--quiet', 'origin');
if (Number(git('rev-list', '--count', 'HEAD..origin/main')) > 0) stop('main is behind origin: pull first');
// changes that are only line endings do not count
const dirty = git('status', '--porcelain', '--untracked-files=no')
  .split('\n')
  .filter(Boolean)
  .map((l) => l.slice(3))
  .filter((f) => {
    try {
      execFileSync('git', ['diff', '--ignore-cr-at-eol', '--quiet', '--', f], { cwd: root });
      return false;
    } catch {
      return true;
    }
  });
if (dirty.length) stop(`there are changes that are not committed: ${dirty.slice(0, 5).join(', ')}`);

const rootPkgFile = path.join(root, 'package.json');
const editorPkgFile = path.join(root, 'packages', 'editor', 'package.json');
const current = JSON.parse(fs.readFileSync(rootPkgFile, 'utf8')).version;
const [maj, min, pat] = current.split('.').map(Number);
const next = /^\d+\.\d+\.\d+$/.test(bump) ? bump : bump === 'major' ? `${maj + 1}.0.0` : bump === 'minor' ? `${maj}.${min + 1}.0` : bump === 'patch' ? `${maj}.${min}.${pat + 1}` : '';
if (!next) stop(`"${bump}" is not patch, minor, major or a number`);
if (git('tag', '--list', `v${next}`)) stop(`v${next} already exists`);

if (!flag('--skip-tests')) {
  say('checking: types');
  if (!run('npm', ['run', 'typecheck'])) stop('the type check failed');
  say('checking: tests');
  if (!run('npx', ['vitest', 'run'])) stop('the tests failed');
} else say('checks skipped (--skip-tests)');

// the version number, in both package files
for (const f of [rootPkgFile, editorPkgFile]) {
  const text = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, text.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`));
}
// what changed since the last release
let last = '';
try {
  last = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*');
} catch {
  last = '';
}
const changes = git('log', '--no-merges', '--pretty=format:- %s', last ? `${last}..HEAD` : 'HEAD')
  .split('\n')
  .filter((l) => l && !/^- Release v/.test(l));
const date = new Date().toISOString().slice(0, 10);
const section = `## ${next} (${date})${flag('--skip-tests') ? ' (checks skipped)' : ''}\n\n${changes.join('\n') || '- no changes'}\n\n`;
const logFile = path.join(root, 'CHANGELOG.md');
const old = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').replace(/^# Changelog\s*\n+/, '') : '';
fs.writeFileSync(logFile, `# Changelog\n\n${section}${old}`);

git('add', 'package.json', 'packages/editor/package.json', 'CHANGELOG.md');
git('commit', '-m', `Release v${next}`);
git('tag', '-a', `v${next}`, '-m', `Tilewright ${next}\n\n${changes.join('\n')}`);
const commit = git('rev-parse', '--short', 'HEAD');
say(`v${next} tagged at ${commit}`);

if (!flag('--no-installer')) {
  say('building the Windows installer (this takes a few minutes)');
  if (!run('npm', ['run', 'dist:win'])) stop(`the installer did not build (v${next} is tagged locally: fix it and run "npm run dist:win")`);
  const dir = path.join(root, 'packages', 'editor', 'release');
  const installer = path.join(dir, `Tilewright-${next}-win.exe`);
  if (!fs.existsSync(installer)) stop(`${installer} was not made`);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
  fs.writeFileSync(path.join(dir, 'RELEASE.json'), JSON.stringify({ version: next, commit, installer: path.basename(installer), sha256, builtAt: new Date().toISOString() }, null, 2) + '\n');
  say(`installer: ${installer}`);
}
if (flag('--no-push')) say('not pushed (--no-push): git push origin main --follow-tags');
else {
  git('push', 'origin', 'main');
  git('push', 'origin', `v${next}`);
  say('pushed main and the tag');
}
say('done: run the installer, then "npm run installed" to check it is the one installed');
