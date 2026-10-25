import { describe, expect, it } from 'vitest';
import { cleanToolOutput } from './agent';

describe('what a tool hands back', () => {
  it('lets text, pictures and PDFs through', () => {
    const out = cleanToolOutput({
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        { type: 'document', title: 'rules.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' } },
      ],
    });
    expect(out.content).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'document', title: 'rules.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' } },
    ]);
    expect(cleanToolOutput({ content: 'plain', isError: true })).toEqual({ content: 'plain', isError: true });
  });

  it('drops anything else, and keeps the weight of the files in bounds', () => {
    const out = cleanToolOutput({
      content: [
        { type: 'tool_use', name: 'x' },
        { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: 'AAAA' } },
        { type: 'text', text: 'kept' },
      ],
    });
    expect(out.content).toEqual([{ type: 'text', text: 'kept' }]);
    const big = 'A'.repeat(15 * 1024 * 1024);
    const two = cleanToolOutput({ content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: big } }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: big } }] });
    expect((two.content as { type: string }[]).map((b) => b.type)).toEqual(['document', 'text']);
    expect(cleanToolOutput(undefined)).toMatchObject({ isError: true });
    expect(cleanToolOutput({ content: [] })).toEqual({ content: 'The tool returned nothing Claude can read.' });
  });
});
