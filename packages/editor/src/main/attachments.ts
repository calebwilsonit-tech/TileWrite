import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_PDF_ATTACHMENT_BYTES, type Attachment } from '@tilewright/assistant';

/**
 * What the window sends with a question: pictures and PDFs. The window already makes pictures small enough and turns other
 * formats into PNG; this is the second look, in the main process, where nothing is trusted. A picture that is still too big is
 * made smaller (`shrink`, which is Electron's own image code) instead of being dropped without a word; what cannot be kept is
 * listed so Claude can tell the person.
 */

const PICTURES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export interface CleanedAttachments {
  attachments: Attachment[];
  /** One line for each that was left out, and why. */
  notes: string[];
}

export function cleanAttachments(raw: unknown, shrink: (bytes: Uint8Array, mediaType: string) => Uint8Array | null): CleanedAttachments {
  const out: Attachment[] = [];
  const notes: string[] = [];
  if (!Array.isArray(raw)) return { attachments: out, notes };
  for (const a of raw) {
    const r = a as Partial<Attachment> | null;
    if (!r || typeof r.data !== 'string' || typeof r.name !== 'string') continue;
    const name = r.name.slice(0, 80);
    const type = String(r.mediaType);
    if (![...PICTURES, 'application/pdf'].includes(type) || !/^[A-Za-z0-9+/]+=*$/.test(r.data)) {
      notes.push(`"${name}" is not a picture or a PDF the assistant can take, so it was not sent.`);
      continue;
    }
    if (out.length >= MAX_ATTACHMENTS) {
      notes.push(`"${name}" was not sent: a message can carry at most ${MAX_ATTACHMENTS} files.`);
      continue;
    }
    const size = r.data.length * 0.75;
    if (type === 'application/pdf') {
      if (size > MAX_PDF_ATTACHMENT_BYTES) notes.push(`"${name}" is a PDF of ${(size / 1024 / 1024).toFixed(1)} MB, more than the ${MAX_PDF_ATTACHMENT_BYTES / 1024 / 1024} MB that can be sent, so it was not sent.`);
      else out.push({ name, mediaType: 'application/pdf', data: r.data });
      continue;
    }
    if (size <= MAX_ATTACHMENT_BYTES) {
      out.push({ name, mediaType: type as Attachment['mediaType'], data: r.data });
      continue;
    }
    const smaller = shrink(Buffer.from(r.data, 'base64'), type);
    if (smaller && smaller.length <= MAX_ATTACHMENT_BYTES) out.push({ name, mediaType: 'image/png', data: Buffer.from(smaller).toString('base64') });
    else notes.push(`"${name}" is ${(size / 1024 / 1024).toFixed(1)} MB and could not be made smaller (the limit is ${(MAX_ATTACHMENT_BYTES / 1024 / 1024).toFixed(1)} MB), so it was not sent.`);
  }
  return { attachments: out, notes };
}
