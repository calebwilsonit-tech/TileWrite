import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '@tilewright/assistant';
import { cleanAttachments } from './attachments';

const b64 = (n: number): string => Buffer.alloc(n, 7).toString('base64');
const none = (): null => null;

describe('what is sent with a question', () => {
  it('takes pictures and PDFs, and says why anything else was left out', () => {
    const r = cleanAttachments(
      [
        { name: 'a.png', mediaType: 'image/png', data: b64(100) },
        { name: 'doc.pdf', mediaType: 'application/pdf', data: b64(5000) },
        { name: 'x.exe', mediaType: 'application/octet-stream', data: b64(10) },
        { name: 'bad', mediaType: 'image/png', data: 'not base64!!' },
        null,
      ],
      none,
    );
    expect(r.attachments.map((a) => [a.name, a.mediaType])).toEqual([['a.png', 'image/png'], ['doc.pdf', 'application/pdf']]);
    expect(r.notes).toHaveLength(2);
    expect(r.notes[0]).toContain('x.exe');
  });

  it('makes a picture that is too big smaller instead of dropping it, and drops (saying so) one that cannot be', () => {
    const big = { name: 'big.jpg', mediaType: 'image/jpeg', data: b64(MAX_ATTACHMENT_BYTES + 1000) };
    const shrunk = cleanAttachments([big], () => new Uint8Array(1000));
    expect(shrunk.attachments).toHaveLength(1);
    expect(shrunk.attachments[0]).toMatchObject({ name: 'big.jpg', mediaType: 'image/png' });
    expect(Buffer.from(shrunk.attachments[0]!.data, 'base64').length).toBe(1000);
    const stuck = cleanAttachments([big], none);
    expect(stuck.attachments).toEqual([]);
    expect(stuck.notes[0]).toMatch(/big\.jpg.*could not be made smaller/);
  });

  it('keeps a PDF to its own, bigger limit', () => {
    const ok = cleanAttachments([{ name: 'a.pdf', mediaType: 'application/pdf', data: b64(MAX_ATTACHMENT_BYTES * 2) }], none);
    expect(ok.attachments).toHaveLength(1);
    const tooBig = cleanAttachments([{ name: 'b.pdf', mediaType: 'application/pdf', data: b64(13 * 1024 * 1024) }], none);
    expect(tooBig.attachments).toEqual([]);
    expect(tooBig.notes[0]).toMatch(/13\.0 MB/);
  });

  it('carries at most six, and says which were left out', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_v, i) => ({ name: `p${i}.png`, mediaType: 'image/png', data: b64(10) }));
    const r = cleanAttachments(many, none);
    expect(r.attachments).toHaveLength(MAX_ATTACHMENTS);
    expect(r.notes).toHaveLength(2);
    expect(r.notes[1]).toContain('p7.png');
  });
});
