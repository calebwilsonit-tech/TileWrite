import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The tests make throwaway projects, user-data folders and (for the export test) whole copies of the game runtime,
 * hundreds of megabytes each. Remove them before and after a run so repeated runs cannot fill the disk.
 */
export default function clean(): void {
  const tmp = os.tmpdir();
  for (const name of fs.readdirSync(tmp)) {
    if (!/^tilewright-(e2e|game)-/.test(name)) continue;
    try {
      fs.rmSync(path.join(tmp, name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      /* something still has it open: the next run removes it */
    }
  }
}
