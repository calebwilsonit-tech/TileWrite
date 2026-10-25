import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDF_LIMITS, extractPdfText, pdfFacts, pdfFitsAsDocument } from './pdf';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const inflate = (b: Uint8Array): Uint8Array => new Uint8Array(inflateSync(b));

/** A small PDF: a page tree of `pages` pages and the given content streams (plain, or deflated). */
function pdf(contents: string[], opts: { pages?: number; deflated?: boolean; encrypted?: boolean } = {}): Uint8Array {
  const parts: (string | Uint8Array)[] = ['%PDF-1.4\n', `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count ${opts.pages ?? contents.length} >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`];
  contents.forEach((c, i) => {
    const body = opts.deflated ? new Uint8Array(deflateSync(enc(c))) : enc(c);
    parts.push(`${i + 4} 0 obj\n<< ${opts.deflated ? '/Filter /FlateDecode ' : ''}/Length ${body.length} >>\nstream\n`, body, '\nendstream\nendobj\n');
  });
  parts.push(opts.encrypted ? 'trailer\n<< /Encrypt 9 0 R >>\n%%EOF' : 'trailer\n<< >>\n%%EOF');
  const chunks = parts.map((p) => (typeof p === 'string' ? enc(p) : p));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

describe('PDFs', () => {
  it('count their pages and say when they are locked', () => {
    expect(pdfFacts(pdf(['BT ET'], { pages: 7 }))).toEqual({ isPdf: true, pages: 7, encrypted: false });
    expect(pdfFacts(pdf(['BT ET'], { encrypted: true })).encrypted).toBe(true);
    expect(pdfFacts(enc('not a pdf at all'))).toEqual({ isPdf: false, pages: 0, encrypted: false });
  });

  it('go to the API whole when they fit, and say why when they do not', () => {
    expect(pdfFitsAsDocument({ isPdf: true, pages: 10, encrypted: false }, 1000)).toBeNull();
    expect(pdfFitsAsDocument({ isPdf: true, pages: PDF_LIMITS.pages + 1, encrypted: false }, 1000)).toMatch(/101 pages/);
    expect(pdfFitsAsDocument({ isPdf: true, pages: 3, encrypted: false }, PDF_LIMITS.bytes + 1)).toMatch(/MB/);
    expect(pdfFitsAsDocument({ isPdf: true, pages: 3, encrypted: true }, 1000)).toMatch(/password/);
    expect(pdfFitsAsDocument({ isPdf: false, pages: 0, encrypted: false }, 10)).toMatch(/not a PDF/);
  });

  it('give back their text, from plain and from deflated streams', () => {
    const page = 'BT /F1 12 Tf 72 700 Td (The Last Chronicle) Tj 0 -20 Td (Chapter one: the tower \\(north\\)) Tj ET\nBT 72 640 Td [(Wor) -300 (ld) 20 (map)] TJ ET';
    for (const deflated of [false, true]) {
      const r = extractPdfText(pdf([page], { deflated }), inflate);
      expect(r.readable).toBe(true);
      expect(r.text).toContain('The Last Chronicle');
      expect(r.text).toContain('Chapter one: the tower (north)');
      expect(r.text).toContain('Wor ldmap');
    }
  });

  it('say so when there is almost no text (a scan, or fonts with their own codes)', () => {
    const r = extractPdfText(pdf(['q 100 0 0 100 0 0 cm /Im0 Do Q']), inflate);
    expect(r.readable).toBe(false);
    expect(extractPdfText(enc('%PDF-1.4 garbage'), inflate).text).toBe('');
  });
});
