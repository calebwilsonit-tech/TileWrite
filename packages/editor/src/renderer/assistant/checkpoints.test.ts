import { describe, expect, it } from 'vitest';
import { deltaFrom, filesAt, type Checkpoint } from './checkpoints';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array | undefined): string | undefined => (b ? new TextDecoder().decode(b) : undefined);

describe('checkpoints inside a run', () => {
  const start = new Map([['a.json', bytes('one')], ['b.json', bytes('two')], ['c.json', bytes('three')]]);

  it('keep only the files that differ from the start of the run, and the ones that are gone', () => {
    const now = new Map([['a.json', bytes('one')], ['b.json', bytes('TWO')], ['d.json', bytes('new')]]);
    const delta = deltaFrom(start, now);
    expect([...delta.keys()].sort()).toEqual(['b.json', 'c.json', 'd.json']);
    expect(text(delta.get('b.json') ?? undefined)).toBe('TWO');
    expect(delta.get('c.json')).toBeNull();
  });

  it('give back the project as it was at the checkpoint, not as it was at the start and not as it is', () => {
    const afterStep1 = new Map([['a.json', bytes('one')], ['b.json', bytes('TWO')], ['c.json', bytes('three')], ['d.json', bytes('made in step 1')]]);
    const cp: Checkpoint = { id: 'c2', takenAt: 0, changed: deltaFrom(start, afterStep1) };
    const files = filesAt(start, cp);
    expect(text(files.get('b.json'))).toBe('TWO');
    expect(text(files.get('d.json'))).toBe('made in step 1');
    expect(text(files.get('a.json'))).toBe('one');
    expect(files.size).toBe(4);
    // a file removed by then is gone from it
    const removed: Checkpoint = { id: 'c3', takenAt: 0, changed: deltaFrom(start, new Map([['a.json', bytes('one')]])) };
    expect([...filesAt(start, removed).keys()]).toEqual(['a.json']);
    // the copy at the start is not touched
    expect(start.size).toBe(3);
    expect(text(start.get('b.json'))).toBe('two');
  });

  it('are empty when nothing has changed', () => {
    expect(deltaFrom(start, new Map(start)).size).toBe(0);
  });
});
