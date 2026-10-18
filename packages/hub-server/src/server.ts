import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Hub, HubError, emptyState, type HubOptions, type HubStore, type State } from './hub';
import { LICENCE_LABELS, LIMITS } from './pack';

export const HUB_API = '/api/v1';
export const HUB_NAME = 'Tilewright Asset Hub';

/** Keeps everything under one folder: hub.json for the lists, packs/<item>/v<n>.json for the files. */
export class FileStore implements HubStore {
  constructor(private readonly dir: string) {
    mkdirSync(path.join(dir, 'packs'), { recursive: true });
  }
  load(): State {
    const file = path.join(this.dir, 'hub.json');
    if (!existsSync(file)) return emptyState();
    return { ...emptyState(), ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<State>) };
  }
  save(state: State): void {
    const file = path.join(this.dir, 'hub.json');
    writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${file}.tmp`, file);
  }
  putPack(itemId: string, version: number, text: string): void {
    const dir = path.join(this.dir, 'packs', itemId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `v${version}.json`), text);
  }
  getPack(itemId: string, version: number): string | null {
    const file = path.join(this.dir, 'packs', itemId, `v${version}.json`);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }
  removePacks(itemId: string): void {
    rmSync(path.join(this.dir, 'packs', itemId), { recursive: true, force: true });
  }
}

export interface ServerOptions extends HubOptions {
  /** Requests per minute from one address to the sign-in and sign-up routes. */
  authPerMinute?: number;
}

function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'application/json; charset=utf-8' : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<{ text: string; size: number }> {
  const chunks: Buffer[] = [];
  let size = 0;
  const limit = LIMITS.packBytes + 64 * 1024;
  for await (const c of req) {
    const b = c as Buffer;
    size += b.length;
    if (size > limit) throw new HubError(413, `That is too large: the hub keeps packs up to ${LIMITS.packBytes / 1048576} MB.`);
    chunks.push(b);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), size };
}

/** Build the HTTP server around a hub (not started: call listen). */
export function createHubServer(hub: Hub, opts: ServerOptions = {}): Server {
  const hits = new Map<string, number[]>();
  const tooMany = (req: IncomingMessage): boolean => {
    const ip = req.socket.remoteAddress ?? '?';
    const t = Date.now();
    const list = (hits.get(ip) ?? []).filter((x) => t - x < 60_000);
    list.push(t);
    hits.set(ip, list);
    return list.length > (opts.authPerMinute ?? 30);
  };

  return createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === 'OPTIONS') return send(res, 204, '');
        const url = new URL(req.url ?? '/', 'http://hub');
        const p = url.pathname;
        const actor = hub.actor(req.headers.authorization);
        const method = req.method ?? 'GET';
        const body = async (): Promise<{ json: Record<string, unknown>; size: number }> => {
          const { text, size } = await readBody(req);
          try {
            const json = JSON.parse(text || '{}') as unknown;
            if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('not an object');
            return { json: json as Record<string, unknown>, size };
          } catch {
            throw new HubError(400, 'The request body is not valid JSON.');
          }
        };
        if (p === '/' || p === '') return send(res, 200, { name: HUB_NAME, api: HUB_API });
        if (!p.startsWith(HUB_API)) throw new HubError(404, 'Not found.');
        const route = p.slice(HUB_API.length);
        const m = (re: RegExp): RegExpExecArray | null => re.exec(route);

        if (route === '/health' && method === 'GET') return send(res, 200, { ok: true, name: HUB_NAME, licences: LICENCE_LABELS, limits: LIMITS });
        if (route === '/accounts' && method === 'POST') {
          if (tooMany(req)) throw new HubError(429, 'Too many tries. Please wait a minute.');
          const { json } = await body();
          return send(res, 201, hub.register(String(json.name ?? ''), String(json.password ?? '')));
        }
        if (route === '/login' && method === 'POST') {
          if (tooMany(req)) throw new HubError(429, 'Too many tries. Please wait a minute.');
          const { json } = await body();
          return send(res, 200, hub.login(String(json.name ?? ''), String(json.password ?? '')));
        }
        if (route === '/items' && method === 'GET') {
          const q = url.searchParams;
          return send(res, 200, hub.list(actor, { q: q.get('q') ?? '', kind: q.get('kind') ?? '', tag: q.get('tag') ?? '', licence: q.get('licence') ?? '', sort: (q.get('sort') as 'new') ?? 'new', limit: Number(q.get('limit') ?? 40), offset: Number(q.get('offset') ?? 0) }));
        }
        if (route === '/items' && method === 'POST') {
          const { json, size } = await body();
          return send(res, 201, hub.publish(actor, json.pack, size, String(json.notes ?? '')));
        }
        if (route === '/mine' && method === 'GET') return send(res, 200, { items: hub.mine(actor) });
        let r: RegExpExecArray | null;
        if ((r = m(/^\/items\/([a-z0-9-]+)$/)) && method === 'GET') return send(res, 200, hub.get(actor, r[1]!));
        if ((r = m(/^\/items\/([a-z0-9-]+)$/)) && method === 'DELETE') return send(res, 200, (hub.remove(actor, r[1]!), { removed: true }));
        if ((r = m(/^\/items\/([a-z0-9-]+)\/pack$/)) && method === 'GET') {
          const v = url.searchParams.get('version');
          const { text, item } = hub.download(actor, r[1]!, v ? Number(v) : undefined);
          return send(res, 200, text, { 'X-Item-Version': String(item.version) });
        }
        if ((r = m(/^\/items\/([a-z0-9-]+)\/rate$/)) && method === 'POST') return send(res, 200, hub.rate(actor, r[1]!, Number((await body()).json.stars)));
        if ((r = m(/^\/items\/([a-z0-9-]+)\/report$/)) && method === 'POST') return send(res, 201, hub.report(actor, r[1]!, String((await body()).json.reason ?? '')));
        if (route === '/admin/queue' && method === 'GET') return send(res, 200, hub.moderationQueue(actor));
        if ((r = m(/^\/admin\/items\/([a-z0-9-]+)\/approve$/)) && method === 'POST') return send(res, 200, hub.approve(actor, r[1]!));
        if ((r = m(/^\/admin\/items\/([a-z0-9-]+)\/reject$/)) && method === 'POST') return send(res, 200, hub.reject(actor, r[1]!, String((await body()).json.note ?? '')));
        if ((r = m(/^\/admin\/reports\/([a-z0-9]+)\/dismiss$/)) && method === 'POST') return send(res, 200, (hub.dismissReport(actor, r[1]!), { dismissed: true }));
        throw new HubError(404, 'Not found.');
      } catch (e) {
        if (e instanceof HubError) return send(res, e.status, { error: e.message });
        send(res, 500, { error: 'Something went wrong on the hub.' });
      }
    })();
  });
}
