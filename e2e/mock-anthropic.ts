import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** A stand-in for the Anthropic Messages API (streaming), so the assistant can be tested without a key or network. */

export type MockBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export interface MockReply {
  content?: MockBlock[];
  stop?: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
  usage?: { input: number; output: number; cacheWrite?: number; cacheRead?: number };
  /** Answer with an HTTP error instead. */
  status?: number;
  message?: string;
}

export interface MockRequest {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  status: number;
}

let counter = 0;

export class MockAnthropic {
  readonly requests: MockRequest[] = [];
  private queue: MockReply[] = [];
  /** Answer 400 to any request that asks for the server-side fallback beta. */
  rejectFallbacks = false;
  private constructor(private readonly server: http.Server) {}

  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** The replies are used in order, one per model call. */
  enqueue(...replies: MockReply[]): void {
    this.queue.push(...replies);
  }

  get pending(): number {
    return this.queue.length;
  }

  static async start(): Promise<MockAnthropic> {
    const server = http.createServer();
    const mock = new MockAnthropic(server);
    server.on('request', (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => mock.handle(req, res, Buffer.concat(chunks).toString('utf8')));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return mock;
  }

  async close(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  private fail(res: http.ServerResponse, status: number, message: string, rec: MockRequest): void {
    rec.status = status;
    const type = status === 401 ? 'authentication_error' : status === 429 ? 'rate_limit_error' : status === 400 ? 'invalid_request_error' : 'api_error';
    res.writeHead(status, { 'content-type': 'application/json', 'retry-after-ms': '1' });
    res.end(JSON.stringify({ type: 'error', error: { type, message } }));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, raw: string): void {
    const rec: MockRequest = { path: req.url ?? '', headers: req.headers, body: raw ? JSON.parse(raw) : {}, status: 200 };
    this.requests.push(rec);
    if (req.method !== 'POST' || !rec.path.startsWith('/v1/messages')) return this.fail(res, 404, 'not found', rec);
    if (this.rejectFallbacks && rec.body.fallbacks) return this.fail(res, 400, 'fallbacks is not enabled for this organization (beta)', rec);
    const reply = this.queue.shift();
    if (!reply) return this.fail(res, 500, 'the mock has no reply queued', rec);
    if (reply.status) return this.fail(res, reply.status, reply.message ?? `mock error ${reply.status}`, rec);

    const content = reply.content ?? [];
    const stop = reply.stop ?? (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn');
    const u = reply.usage ?? { input: 1200, output: 150, cacheWrite: 0, cacheRead: 0 };
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (event: string, data: unknown): void => void res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('message_start', {
      type: 'message_start',
      message: {
        id: `msg_mock${++counter}`,
        type: 'message',
        role: 'assistant',
        model: rec.body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: u.input, output_tokens: 1, cache_creation_input_tokens: u.cacheWrite ?? 0, cache_read_input_tokens: u.cacheRead ?? 0 },
      },
    });
    content.forEach((b, index) => {
      if (b.type === 'text') {
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
        const mid = Math.max(1, Math.floor(b.text.length / 2));
        for (const part of [b.text.slice(0, mid), b.text.slice(mid)]) if (part) send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } });
      } else if (b.type === 'thinking') {
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
        send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.thinking } });
        send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: b.signature ?? 'sig' } });
      } else {
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
        const json = JSON.stringify(b.input);
        const mid = Math.floor(json.length / 2);
        for (const part of [json.slice(0, mid), json.slice(mid)]) send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: part } });
      }
      send('content_block_stop', { type: 'content_block_stop', index });
    });
    send('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: u.output } });
    send('message_stop', { type: 'message_stop' });
    res.end();
  }
}
