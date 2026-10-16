// Dev runner: Vite dev server for the renderer + Electron pointed at it.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

execSync('npm run build:main', { stdio: 'inherit' });

const server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)) });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async () => {
  await server.close();
  process.exit(0);
});
