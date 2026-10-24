// Builds the Windows installer and zip with electron-builder, without the downloads that keep timing out.
//
// - Electron itself is not downloaded: package.json points `electronDist` at the copy this repository already runs on.
// - The small tool archives electron-builder needs (the NSIS installer maker and its resources) are fetched here first with
//   curl, which resumes a partly downloaded file and retries when the connection stalls. They are put where electron-builder
//   looks before it downloads anything (<cache>/<release>/<file>), and checked against the same sha256 it uses.
// - If electron-builder still fails (a tool it needs that is not in the list below), it is started again: whatever it had
//   finished is kept in its cache, so each try carries on from where the last one stopped.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const BASE = 'https://github.com/electron-userland/electron-builder-binaries/releases/download';
const TOOLS = [
  { release: 'nsis-3.0.4.1', file: 'nsis-3.0.4.1.7z', sha256: '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa' },
  { release: 'nsis-resources-3.4.1', file: 'nsis-resources-3.4.1.7z', sha256: '593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103' },
  { release: 'winCodeSign-2.6.0', file: 'winCodeSign-2.6.0.7z', sha256: 'cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4' },
];
const BUILD_TRIES = Number(process.env.DIST_TRIES ?? 5);
const DOWNLOAD_TRIES = Number(process.env.DIST_DOWNLOAD_TRIES ?? 40);

const say = (text) => process.stdout.write(`[dist-win] ${text}\n`);

function cacheDir() {
  const fromEnv = process.env.ELECTRON_BUILDER_CACHE?.trim();
  if (fromEnv && path.parse(fromEnv).root) return fromEnv;
  const local = process.env.LOCALAPPDATA?.trim();
  return local ? path.join(local, 'electron-builder', 'Cache') : path.join(os.homedir(), '.cache', 'electron-builder');
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Download one file with curl, carrying on from the part that is already there, until it is complete and correct. */
function fetchTool({ release, file, sha256: want }) {
  const dest = path.join(cacheDir(), release, file);
  if (fs.existsSync(dest) && sha256(dest) === want) return true;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const url = `${BASE}/${release}/${file}`;
  for (let attempt = 1; attempt <= DOWNLOAD_TRIES; attempt++) {
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    say(`${file}: try ${attempt}${have > 0 ? `, carrying on from ${(have / 1048576).toFixed(1)} MB` : ''}`);
    const r = spawnSync(
      'curl',
      ['-L', '-C', '-', '--fail', '--connect-timeout', '30', '--speed-limit', '2000', '--speed-time', '45', '--retry', '5', '--retry-delay', '3', '-o', part, url],
      { stdio: 'inherit' },
    );
    if (r.error) {
      say(`curl could not be started (${r.error.message}); electron-builder will download ${file} itself.`);
      return false;
    }
    if (r.status === 0 && fs.existsSync(part)) {
      if (sha256(part) === want) {
        fs.renameSync(part, dest);
        say(`${file}: done`);
        return true;
      }
      say(`${file}: the file is not the one expected (checksum), starting it again`);
      fs.rmSync(part, { force: true });
    }
    // exit 33 means the server would not resume from there: start the file over
    if (r.status === 33) fs.rmSync(part, { force: true });
  }
  say(`${file}: gave up after ${DOWNLOAD_TRIES} tries; electron-builder will try itself.`);
  return false;
}

function runBuilder() {
  return new Promise((resolve) => {
    const child = spawn('npx', ['electron-builder', '--win', '--publish', 'never', ...process.argv.slice(2)], { stdio: 'inherit', shell: true });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

for (const tool of TOOLS) fetchTool(tool);

let code = 1;
for (let attempt = 1; attempt <= BUILD_TRIES; attempt++) {
  say(`electron-builder, try ${attempt} of ${BUILD_TRIES}`);
  code = await runBuilder();
  if (code === 0) break;
  say('It stopped. Starting again; what it already fetched is kept.');
  for (const tool of TOOLS) fetchTool(tool);
}
if (code === 0) say(`Done. The installer and zip are in ${path.resolve('release')}`);
else say('The build did not finish. Run `npm run dist:win` again to carry on.');
process.exit(code);
