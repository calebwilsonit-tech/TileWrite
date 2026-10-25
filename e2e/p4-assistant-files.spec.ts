import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { MockAnthropic, type MockBlock } from './mock-anthropic';

/**
 * Round 2, section 7: Claude reading the project. Every kind of file the engine and an artist make comes back as something Claude
 * can use: PDFs as documents, BMP, PSD, SVG and big pictures as PNG that fits (with their size, frames and colours in words),
 * scenes, screens and conversations as text AND a drawn picture, sounds as measurements and a waveform, and a search over it all.
 */

const KEY = 'sk-ant-api03-TESTKEY-0123456789abcdef';
const tool = (id: string, name: string, input: unknown): MockBlock => ({ type: 'tool_use', id, name, input });

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const idle = (page: Page) => expect(page.getByTestId('assistant-working')).toHaveCount(0, { timeout: 30_000 });

async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId('assistant-input').fill(text);
  await page.getByTestId('assistant-send').click();
}

interface Result {
  id: string;
  error: boolean;
  text: string;
  kinds: string[];
  blocks: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
}
function results(body: Body): Result[] {
  const last = body.messages.at(-1);
  return (last.content as any[]).map((b) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const parts = typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : (b.content as any[]); // eslint-disable-line @typescript-eslint/no-explicit-any
    return { id: b.tool_use_id, error: b.is_error === true, text: parts.map((c) => c.text ?? '').join('\n'), kinds: parts.map((c) => c.type), blocks: parts };
  });
}

// ---- files made in node ----

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc = (b: Buffer): number => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}
/** A flat-colour PNG of any size (it compresses to almost nothing, so a very large picture is a small file). */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function bmp24(width: number, height: number, rgb: [number, number, number]): Buffer {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const data = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([rgb[2], rgb[1], rgb[0]], y * rowBytes + x * 3);
  const head = Buffer.alloc(54);
  head.write('BM', 0);
  head.writeUInt32LE(54 + data.length, 2);
  head.writeUInt32LE(54, 10);
  head.writeUInt32LE(40, 14);
  head.writeInt32LE(width, 18);
  head.writeInt32LE(height, 22);
  head.writeUInt16LE(1, 26);
  head.writeUInt16LE(24, 28);
  head.writeUInt32LE(data.length, 34);
  return Buffer.concat([head, data]);
}
function psd(width: number, height: number, rgb: [number, number, number]): Buffer {
  const head = Buffer.alloc(26);
  head.write('8BPS', 0);
  head.writeUInt16BE(1, 4);
  head.writeUInt16BE(3, 12);
  head.writeUInt32BE(height, 14);
  head.writeUInt32BE(width, 18);
  head.writeUInt16BE(8, 22);
  head.writeUInt16BE(3, 24);
  const planes = rgb.map((v) => Buffer.alloc(width * height, v));
  return Buffer.concat([head, Buffer.alloc(12), Buffer.from([0, 0]), ...planes]);
}
function pdf(pages: number, lines: string[]): Buffer {
  const content = `BT /F1 12 Tf 72 700 Td ${lines.map((l) => `(${l}) Tj 0 -20 Td`).join(' ')} ET`;
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count ${pages} >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\ntrailer\n<< >>\n%%EOF`);
}
function wav(seconds: number, rate = 8000): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 16000 * (i / rate > 0.25 ? 1 : 0)), 44 + i * 2);
  return b;
}

test('Round 2 section 7: Claude reads PDFs, every kind of picture, scenes, screens, conversations and sounds, and searches the project', async () => {
  test.setTimeout(240_000);
  const mock = await MockAnthropic.start();
  const { page, app, workDir, errors } = await launchEditor(undefined, { TILEWRIGHT_ASSISTANT_BASE_URL: mock.url });
  await createProjectViaUi(page, 'Reading', 'empty-iso');
  const dir = path.join(workDir, 'Reading');
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('key-input').fill(KEY);
  await page.getByTestId('key-save').click();
  await expect(page.getByTestId('key-saved')).toBeVisible();

  fs.mkdirSync(path.join(dir, 'assets', 'art'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'audio'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets', 'dialogues'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'art', 'banner.bmp'), bmp24(40, 20, [200, 40, 40]));
  fs.writeFileSync(path.join(dir, 'assets', 'art', 'mockup.psd'), psd(24, 12, [20, 160, 60]));
  fs.writeFileSync(path.join(dir, 'assets', 'art', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#3060d0"/></svg>');
  fs.writeFileSync(path.join(dir, 'assets', 'art', 'huge.png'), png(4000, 3000, [30, 90, 200]));
  fs.writeFileSync(path.join(dir, 'docs', 'design.pdf'), pdf(3, ['The Last Chronicle', 'Chapter one']));
  fs.writeFileSync(path.join(dir, 'assets', 'audio', 'chime.wav'), wav(1));
  fs.writeFileSync(
    path.join(dir, 'assets', 'dialogues', 'gate.dialogue.json'),
    JSON.stringify({ name: 'Gate', start: 'a', nodes: [{ id: 'a', type: 'line', speaker: 'Guard', text: 'Halt!', next: 'b' }, { id: 'b', type: 'end' }] }),
  );

  mock.enqueue(
    {
      content: [
        tool('r1', 'read_project_file', { path: 'assets/art/banner.bmp' }),
        tool('r2', 'read_project_file', { path: 'assets/art/mockup.psd' }),
        tool('r3', 'read_project_file', { path: 'assets/art/logo.svg' }),
        tool('r4', 'read_project_file', { path: 'assets/art/huge.png' }),
        tool('r5', 'read_project_file', { path: 'docs/design.pdf' }),
        tool('r6', 'read_project_file', { path: 'assets/audio/chime.wav' }),
        tool('r7', 'read_project_file', { path: 'scenes/main.scene.json' }),
        tool('r8', 'read_project_file', { path: 'assets/dialogues/gate.dialogue.json' }),
        tool('r9', 'read_project_file', { path: 'project.json' }),
        tool('s1', 'search_project', { query: 'halt' }),
        tool('s2', 'search_project', { kind: 'sounds' }),
        tool('s3', 'search_project', { query: 'logo', where: 'names' }),
        tool('s4', 'search_project', { query: '(', regex: true }),
      ],
    },
    { content: [{ type: 'text', text: 'I read it all.' }] },
  );
  await send(page, 'Look at everything in my project.');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('I read it all');
  await idle(page);
  const r = results(mock.requests.at(-1)!.body);
  const by = (id: string) => r.find((x) => x.id === id)!;

  // BMP, PSD and SVG come back as PNG, with their size and colours in words
  for (const id of ['r1', 'r2', 'r3']) {
    expect(by(id).kinds, id).toContain('image');
    expect(by(id).blocks.find((b) => b.type === 'image').source.media_type, id).toBe('image/png');
  }
  expect(by('r1').text).toContain('BMP picture, 40 x 20 pixels');
  expect(by('r1').text).toContain('#c82828');
  expect(by('r2').text).toContain('Photoshop (PSD) picture, 24 x 12 pixels');
  expect(by('r2').text).toContain('flattened picture');
  expect(by('r3').text).toContain('SVG picture, 32 x 32 pixels');
  expect(by('r3').text).toContain('#3060d0');
  expect(by('r3').text).toContain('<rect');
  // a very big picture is made smaller, and said to be
  expect(by('r4').kinds).toContain('image');
  expect(by('r4').text).toContain('4000 x 3000');
  expect(by('r4').text).toContain('reduced to 1568 x 1176');
  // a PDF goes to the API as a document
  expect(by('r5').kinds).toContain('document');
  expect(by('r5').blocks.find((b) => b.type === 'document').source.media_type).toBe('application/pdf');
  expect(by('r5').text).toContain('3 pages');
  // a sound: levels, a waveform picture, and still no claim to have heard it
  expect(by('r6').kinds).toContain('image');
  expect(by('r6').text).toContain('1.00 s');
  expect(by('r6').text).toMatch(/peak -\d+\.\d dBFS/);
  expect(by('r6').text).toContain('Silence at the start: 0.25 s');
  expect(by('r6').text).toContain('I cannot listen to sound');
  // a scene, a conversation and the project's tiles come with a picture drawn from the file, and the file's own text
  expect(by('r7').kinds[0]).toBe('image');
  expect(by('r7').text).toContain('Map ');
  expect(by('r7').text).toContain('"schemaVersion"');
  expect(by('r8').kinds[0]).toBe('image');
  expect(by('r8').text).toContain('Graph "Gate": 2 boxes, 1 arrow');
  expect(by('r9').kinds[0]).toBe('image');
  expect(by('r9').text).toContain('The tiles');

  // the search
  expect(by('s1').text).toContain('assets/dialogues/gate.dialogue.json');
  expect(by('s1').text).toContain('Halt!');
  expect(by('s2').text).toContain('assets/audio/chime.wav');
  expect(by('s3').text).toContain('assets/art/logo.svg');
  expect(by('s3').text).not.toContain('Text containing');
  expect(by('s4').error).toBe(true);
  expect(by('s4').text).toContain('not a valid pattern');
  await page.screenshot({ path: shot('p4-assistant-files.png') });

  // ---- attaching: a PSD and a PDF go along with the question, a big picture is made smaller instead of refused ----
  mock.enqueue({ content: [{ type: 'text', text: 'Got them.' }] });
  await page.getByTestId('assistant-file').setInputFiles([
    { name: 'mockup.psd', mimeType: 'application/octet-stream', buffer: psd(16, 16, [10, 20, 30]) },
    { name: 'brief.pdf', mimeType: 'application/pdf', buffer: pdf(1, ['A short brief']) },
    { name: 'big.png', mimeType: 'image/png', buffer: png(5000, 4000, [1, 2, 3]) },
  ]);
  await expect(page.getByTestId('attachments').locator('.attachment')).toHaveCount(3);
  await send(page, 'Use these.');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Got them');
  const sent = mock.requests.at(-1)!.body.messages.at(-1).content as { type: string; text?: string; source?: { media_type: string } }[];
  expect(sent.map((b) => b.type)).toEqual(['text', 'image', 'text', 'document', 'text', 'image', 'text']);
  expect(sent[1]!.source!.media_type).toBe('image/png'); // the PSD, as a PNG
  expect(sent[3]!.source!.media_type).toBe('application/pdf');
  expect(sent[5]!.source!.media_type).toBe('image/png'); // the big one, made smaller
  expect(errors).toEqual([]);
  await app.close();
  await mock.close();
});
