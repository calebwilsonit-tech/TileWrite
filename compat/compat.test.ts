/**
 * The compatibility corpus (Rule A of phase 3): every sample, template and project of the owner's must keep opening,
 * playing, saving and exporting exactly as before.
 *
 *   npm run compat                      compare every project with its baseline
 *   COMPAT_UPDATE=1 npm run compat      write the baselines (only for an intended, documented change)
 *   COMPAT_ONLY=Demo npm run compat     one project
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPAT, corpus, type CorpusEntry } from './harness/corpus';
import { differences } from './harness/diff';
import { buildReport } from './harness/report';
import { apiSurface } from './harness/scripts';

const update = process.env.COMPAT_UPDATE === '1';
const only = process.env.COMPAT_ONLY;

const baselineFile = (e: CorpusEntry): string => path.join(COMPAT, 'baselines', e.kind, `${e.id}.json`);

function compare(file: string, now: unknown): void {
  const text = `${JSON.stringify(now, null, 2)}\n`;
  if (update) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    return;
  }
  if (!fs.existsSync(file)) throw new Error(`There is no baseline yet at ${path.relative(COMPAT, file)}. Run \`COMPAT_UPDATE=1 npm run compat\` once, on a version you trust.`);
  const baseline = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  const diff = differences(baseline, JSON.parse(text));
  expect(diff, `${path.relative(COMPAT, file)} changed:\n${diff.join('\n')}`).toEqual([]);
}

describe('the scripting API only grows (Rule A.4)', () => {
  it('keeps every name it has ever had', () => {
    const file = path.join(COMPAT, 'baselines', 'script-api.json');
    const now = apiSurface();
    if (update || !fs.existsSync(file)) {
      // the baseline only ever grows: a name that was there stays in the list, so removing it later is caught
      const had: string[] = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as string[]) : [];
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify([...new Set([...had, ...now])].sort(), null, 2)}\n`, 'utf8');
      return;
    }
    const had = JSON.parse(fs.readFileSync(file, 'utf8')) as string[];
    const missing = had.filter((n) => !now.includes(n));
    expect(missing, 'These parts of the script API were removed or renamed. Keep the old name as an alias.').toEqual([]);
    // names added since are fine; they are written into the baseline the next time it is updated
  });
});

const entries = await corpus();

describe('the compatibility corpus', () => {
  for (const e of entries) {
    if (only && e.id !== only) continue;
    it(`${e.kind}: ${e.id} opens, plays, saves and exports as before`, async () => {
      const report = await buildReport(e.dir);
      compare(baselineFile(e), report);
    });
  }
});
