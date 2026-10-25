/**
 * PDFs for Claude. The API reads a PDF itself (pages as text and as pictures) when it is sent as a document block, so that is
 * the way when the file fits; when it does not (too many pages, too big, locked), the text in it is pulled out here, as well as
 * it can be without the font tables, and the answer says so. Pure: bytes in, words out (the inflater is handed in).
 */

/** What the API takes in one document block (pages and bytes), kept under its limits with room for the rest of the conversation. */
export const PDF_LIMITS = { pages: 100, bytes: 12 * 1024 * 1024 } as const;

export interface PdfFacts {
  isPdf: boolean;
  /** 0 when the page count could not be found (the pages are inside a compressed object stream). */
  pages: number;
  encrypted: boolean;
}

const latin1 = (bytes: Uint8Array, from = 0, to = bytes.length): string => {
  let s = '';
  for (let i = from; i < to; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, Math.min(to, i + 0x8000)));
  return s;
};

export function pdfFacts(bytes: Uint8Array): PdfFacts {
  if (bytes.length < 8 || latin1(bytes, 0, 5) !== '%PDF-') return { isPdf: false, pages: 0, encrypted: false };
  const text = latin1(bytes);
  // the root of the page tree says how many pages in all: the largest /Count of a /Pages object
  let pages = 0;
  for (const m of text.matchAll(/\/Type\s*\/Pages\b[^]{0,400}?\/Count\s+(\d+)|\/Count\s+(\d+)[^]{0,400}?\/Type\s*\/Pages\b/g)) pages = Math.max(pages, Number(m[1] ?? m[2]));
  if (pages === 0) pages = [...text.matchAll(/\/Type\s*\/Page\b(?!s)/g)].length;
  return { isPdf: true, pages, encrypted: /\/Encrypt\b/.test(text) };
}

/** Can this PDF be sent to the API as it is? Otherwise the reason, in words for Claude. */
export function pdfFitsAsDocument(facts: PdfFacts, size: number): string | null {
  if (!facts.isPdf) return 'it is not a PDF file';
  if (facts.encrypted) return 'it is locked with a password';
  if (size > PDF_LIMITS.bytes) return `it is ${(size / 1024 / 1024).toFixed(1)} MB (the limit for reading a whole PDF is ${PDF_LIMITS.bytes / 1024 / 1024} MB)`;
  if (facts.pages > PDF_LIMITS.pages) return `it has ${facts.pages} pages (the limit for reading a whole PDF is ${PDF_LIMITS.pages})`;
  return null;
}

// ---- the text inside, as well as it can be got without the fonts' tables ----

function* streams(bytes: Uint8Array, inflate: (b: Uint8Array) => Uint8Array): Generator<Uint8Array> {
  const text = latin1(bytes);
  const re = /stream\r?\n/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    const head = text.slice(Math.max(0, m.index - 400), m.index);
    const dict = head.slice(head.lastIndexOf('<<'));
    let body = bytes.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) {
      try {
        body = inflate(body);
      } catch {
        continue; // damaged, or some other filter on top
      }
    } else if (/\/(DCTDecode|JPXDecode|LZWDecode|ASCII85Decode|CCITTFaxDecode|RunLengthDecode)/.test(dict)) continue;
    yield body;
    re.lastIndex = end;
  }
}

function unescapeString(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = s[++i];
    if (n === undefined) break;
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'b' || n === 'f') out += ' ';
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? '')) oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8) & 255);
    } else if (n === '\n' || n === '\r') {
      if (n === '\r' && s[i + 1] === '\n') i++;
    } else out += n;
  }
  return out;
}

/** The strings shown by one text object, with a line break where the text moves down. */
function textOfContent(content: string): string {
  const out: string[] = [];
  const tokens = /\((?:\\[^]|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\[|\]|-?\d*\.?\d+|\/[^\s/<>()[\]]+|[A-Za-z'"*]+/g;
  let inArray = false;
  let pending = '';
  const lastNumbers: number[] = [];
  const flush = (): void => {
    if (pending) out.push(pending);
    pending = '';
  };
  for (const m of content.matchAll(tokens)) {
    const t = m[0];
    if (t === '[') inArray = true;
    else if (t === ']') inArray = false;
    else if (t[0] === '(') pending += unescapeString(t.slice(1, -1));
    else if (t[0] === '<') {
      const hex = t.slice(1, -1).replace(/\s/g, '');
      // two bytes a character (most embedded fonts) are shown only when they are plain text; one byte a character always
      for (let i = 0; i + 1 < hex.length; i += 2) {
        const code = parseInt(hex.slice(i, i + 2), 16);
        if (code >= 32 && code < 127) pending += String.fromCharCode(code);
      }
    } else if (/^-?\d*\.?\d+$/.test(t)) {
      if (inArray) {
        if (Number(t) < -200) pending += ' '; // a gap in a line of text is a space
      } else {
        lastNumbers.push(Number(t));
        if (lastNumbers.length > 6) lastNumbers.shift();
      }
    } else if (t === 'Td' || t === 'TD' || t === 'T*' || t === "'" || t === '"' || t === 'ET') {
      const dy = t === 'Td' || t === 'TD' ? (lastNumbers.at(-1) ?? 0) : 1;
      if (t === 'ET' || dy !== 0) {
        flush();
        out.push('\n');
      }
      lastNumbers.length = 0;
    } else if (t === 'Tj' || t === 'TJ') {
      lastNumbers.length = 0;
    } else if (t === 'Tm') {
      flush();
      out.push('\n');
      lastNumbers.length = 0;
    }
  }
  flush();
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * The text of a PDF. Pages are not told apart (the page tree is not followed), and a font that maps its own codes to letters
 * (most PDFs made from word processors) may come out as gaps: the result says how much text it found so a thin result is
 * not mistaken for an empty document.
 */
export function extractPdfText(bytes: Uint8Array, inflate: (b: Uint8Array) => Uint8Array): { text: string; readable: boolean } {
  const parts: string[] = [];
  for (const body of streams(bytes, inflate)) {
    const s = latin1(body);
    if (!/\bBT\b/.test(s)) continue;
    for (const block of s.split(/\bBT\b/).slice(1)) {
      const t = textOfContent(block.slice(0, block.search(/\bET\b/) < 0 ? undefined : block.search(/\bET\b/) + 2));
      if (t.trim()) parts.push(t.trim());
    }
  }
  const text = parts.join('\n').replace(/[^\S\n]+/g, ' ').trim();
  return { text, readable: text.replace(/\s/g, '').length >= 20 };
}
