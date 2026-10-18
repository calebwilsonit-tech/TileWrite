import path from 'node:path';
import { Hub } from './hub';
import { FileStore, HUB_NAME, createHubServer } from './server';

/**
 * Start the hub:  node hub.mjs  [--port 8787] [--data ./hub-data] [--host 127.0.0.1]
 * Moderators' secret: set HUB_ADMIN_TOKEN in the environment (a long random text). Without it nobody can approve packs with code.
 */
const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

const port = Number(arg('port', process.env.PORT ?? '8787'));
const host = arg('host', process.env.HOST ?? '127.0.0.1');
const dataDir = path.resolve(arg('data', process.env.HUB_DATA ?? './hub-data'));
const adminToken = process.env.HUB_ADMIN_TOKEN;

if (!adminToken) process.stderr.write('Note: HUB_ADMIN_TOKEN is not set, so nobody can moderate. Packs with code will stay pending.\n');
if (adminToken && adminToken.length < 24) process.stderr.write('Warning: HUB_ADMIN_TOKEN is short. Use at least 24 random characters.\n');

const hub = new Hub(new FileStore(dataDir), { adminToken });
const server = createHubServer(hub);
server.listen(port, host, () => {
  process.stdout.write(`${HUB_NAME} is listening on http://${host}:${port} (data in ${dataDir})\n`);
});
