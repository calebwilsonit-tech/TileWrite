// Draws the Tilewright logo and writes it where electron-builder looks: build/icon.svg, build/icon.png (512) and build/icon.ico
// (16 to 256). The picture is made by the code below, so it can be changed here and drawn again with `node scripts/make-icon.mjs`.
// The SVG is turned into pictures by Electron itself (already installed), so no extra tool is needed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'build');
fs.mkdirSync(out, { recursive: true });

// A block seen from a corner, its top cut into four tiles. Everything is computed from the corner points of the top diamond.
const T = [256, 96];
const R = [396, 166];
const B = [256, 236];
const L = [116, 166];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const C = mid(T, B);
const down = 170;
const pt = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
const poly = (pts, fill, extra = '') => `<polygon points="${pts.map(pt).join(' ')}" fill="${fill}" ${extra}/>`;
const shrink = (pts, k) => {
  const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  return pts.map((p) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]);
};
const tiles = [
  [T, mid(T, R), C, mid(T, L)],
  [mid(T, R), R, mid(R, B), C],
  [C, mid(R, B), B, mid(B, L)],
  [mid(T, L), C, mid(B, L), L],
];
const tileColours = ['#ffd36b', '#ffc04d', '#f5a93a', '#ffc04d'];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2f66"/><stop offset="1" stop-color="#14162f"/></linearGradient>
    <linearGradient id="left" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fb5a8"/><stop offset="1" stop-color="#1a7f8c"/></linearGradient>
    <linearGradient id="right" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f8f94"/><stop offset="1" stop-color="#125968"/></linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <g transform="translate(0 ${(256 - (T[1] + (B[1] + down)) / 2).toFixed(1)})">
    ${poly([L, B, [B[0], B[1] + down], [L[0], L[1] + down]], 'url(#left)')}
    ${poly([B, R, [R[0], R[1] + down], [B[0], B[1] + down]], 'url(#right)')}
    ${poly([T, R, B, L], '#0f1530')}
    ${tiles.map((t, i) => poly(shrink(t, 0.93), tileColours[i], 'stroke="#fff3c9" stroke-opacity="0.55" stroke-width="3" stroke-linejoin="round"')).join('\n    ')}
  </g>
</svg>
`;
fs.writeFileSync(path.join(out, 'icon.svg'), svg);

// Electron draws the SVG at each size.
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const drawer = path.join(out, '.draw-icon.cjs');
fs.writeFileSync(
  drawer,
  `const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const out = ${JSON.stringify(out)};
const svg = fs.readFileSync(path.join(out, 'icon.svg'), 'utf8');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const size of ${JSON.stringify(sizes)}) {
    const win = new BrowserWindow({ show: false, width: size, height: size, useContentSize: true, frame: false, transparent: true, webPreferences: { offscreen: false } });
    const html = '<html><body style="margin:0;background:transparent;overflow:hidden">' + svg.replace('width="512" height="512"', 'width="' + size + '" height="' + size + '"') + '</body></html>';
    const page = path.join(out, '.draw-' + size + '.html');
    fs.writeFileSync(page, html);
    await win.loadFile(page);
    fs.rmSync(page, { force: true });
    await new Promise((r) => setTimeout(r, 250));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    fs.writeFileSync(path.join(out, 'icon-' + size + '.png'), img.toPNG());
    win.destroy();
  }
  app.quit();
});
`,
);
const electron = path.join(here, '..', '..', '..', 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const r = spawnSync(electron, [drawer], { stdio: 'inherit' });
fs.rmSync(drawer, { force: true });
if (r.status !== 0) throw new Error('Electron could not draw the logo.');

// icon.png is the big one; icon.ico holds the PNGs (a Windows icon may hold PNG pictures from Vista on).
fs.copyFileSync(path.join(out, 'icon-512.png'), path.join(out, 'icon.png'));
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = icoSizes.map((s) => fs.readFileSync(path.join(out, `icon-${s}.png`)));
const head = Buffer.alloc(6);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(icoSizes.length, 4);
let offset = 6 + 16 * icoSizes.length;
const entries = icoSizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s === 256 ? 0 : s, 0);
  e.writeUInt8(s === 256 ? 0 : s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([head, ...entries, ...pngs]));
for (const s of sizes) if (s !== 512) fs.rmSync(path.join(out, `icon-${s}.png`), { force: true });
fs.rmSync(path.join(out, 'icon-512.png'), { force: true });
process.stdout.write(`Logo written to ${out}\n`);
