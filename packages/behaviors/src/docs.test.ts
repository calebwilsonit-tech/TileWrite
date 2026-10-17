import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACTIONS, CONDITIONS, behaviorList } from './index';
import { behavioursMarkdown, eventBlocksMarkdown } from './docs';

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs');

function check(file: string, text: string): void {
  const target = path.join(docs, file);
  if (process.env.UPDATE_DOCS === '1') fs.writeFileSync(target, text, 'utf8');
  const have = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
  expect(have, `${file} is out of date: run  UPDATE_DOCS=1 npx vitest run packages/behaviors/src/docs.test.ts`).toBe(text);
}

describe('reference docs', () => {
  it('docs/behaviours.md describes every behaviour the editor offers, and is up to date', () => {
    const text = behavioursMarkdown();
    for (const b of behaviorList().filter((x) => !x.hidden)) {
      expect(text, b.id).toContain(`### ${b.name}`);
      expect(text, b.id).toContain(`\`${b.id}\``);
      for (const f of b.fields) expect(text, `${b.id}.${f.key}`).toContain(`\`${f.key}\``);
    }
    check('behaviours.md', text);
  });

  it('docs/event-blocks.md describes every condition and action, and is up to date', () => {
    const text = eventBlocksMarkdown();
    for (const d of [...CONDITIONS, ...ACTIONS]) expect(text, d.id).toContain(`#### ${d.label}`);
    check('event-blocks.md', text);
  });
});
