import { parsePack, type Pack } from './pack';

/** Talking to an asset hub (see packages/hub-server). The requests are made by the main process; this is only the shapes and the checks. */

export type HubRequest = (req: { method: string; url: string; token?: string; body?: string }) => Promise<{ status: number; text: string; version: string }>;

export interface HubItem {
  id: string;
  name: string;
  kind: string;
  author: string;
  licence: string;
  description: string;
  tags: string[];
  code: boolean;
  status: 'approved' | 'pending' | 'hidden' | 'rejected';
  version: number;
  downloads: number;
  rating: number;
  ratings: number;
  thumb: string;
  fileCount: number;
  updatedAt: string;
  moderationNote: string;
}

export interface HubSearch {
  q?: string;
  kind?: string;
  licence?: string;
  sort?: 'new' | 'rating' | 'downloads' | 'name';
}

export class HubProblem extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export const DEFAULT_HUB = 'http://localhost:8787';

/** What a person is told before a hub address is used. Null when it is fine. */
export function hubAddressProblem(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return 'That is not a web address. A hub address looks like https://hub.example.com';
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return 'Use an address that starts with https:// (http:// is only for a hub on this computer).';
  return null;
}

export class HubClient {
  token = '';
  constructor(
    readonly address: string,
    private readonly request: HubRequest,
  ) {}

  private async call<T>(method: string, route: string, body?: unknown): Promise<{ json: T; version: string; text: string }> {
    const problem = hubAddressProblem(this.address);
    if (problem) throw new HubProblem(problem);
    const res = await this.request({ method, url: `${this.address.replace(/\/+$/, '')}/api/v1${route}`, ...(this.token ? { token: this.token } : {}), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let json: unknown = {};
    try {
      json = JSON.parse(res.text || '{}');
    } catch {
      if (res.status < 400) throw new HubProblem('The hub sent something that is not understood. Is this really an asset hub?', res.status);
    }
    if (res.status >= 400) throw new HubProblem((json as { error?: string }).error ?? `The hub answered with an error (${res.status}).`, res.status);
    return { json: json as T, version: res.version, text: res.text };
  }

  async health(): Promise<{ name: string; licences: Record<string, string> }> {
    const { json } = await this.call<{ ok: boolean; name: string; licences: Record<string, string> }>('GET', '/health');
    if (!json.ok) throw new HubProblem('That address did not answer like an asset hub.');
    return json;
  }

  async register(name: string, password: string): Promise<string> {
    const { json } = await this.call<{ token: string; account: { name: string } }>('POST', '/accounts', { name, password });
    this.token = json.token;
    return json.account.name;
  }

  async login(name: string, password: string): Promise<string> {
    const { json } = await this.call<{ token: string; account: { name: string } }>('POST', '/login', { name, password });
    this.token = json.token;
    return json.account.name;
  }

  async search(q: HubSearch = {}): Promise<{ total: number; items: HubItem[] }> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) params.set(k, v);
    return (await this.call<{ total: number; items: HubItem[] }>('GET', `/items?${params.toString()}`)).json;
  }

  async mine(): Promise<HubItem[]> {
    return (await this.call<{ items: HubItem[] }>('GET', '/mine')).json.items;
  }

  /** The pack file, checked the way a file from anywhere else is. */
  async download(id: string): Promise<{ pack: Pack; item: HubItem }> {
    const meta = await this.call<HubItem>('GET', `/items/${id}`);
    const file = await this.call<unknown>('GET', `/items/${id}/pack`);
    const r = parsePack(file.json);
    if (!r.ok) throw new HubProblem(`The asset pack from the hub is not usable: ${r.error}`);
    return { pack: r.pack, item: meta.json };
  }

  async publish(pack: Pack, notes = ''): Promise<HubItem> {
    return (await this.call<HubItem>('POST', '/items', { pack, notes })).json;
  }

  async rate(id: string, stars: number): Promise<HubItem> {
    return (await this.call<HubItem>('POST', `/items/${id}/rate`, { stars })).json;
  }

  async report(id: string, reason: string): Promise<void> {
    await this.call('POST', `/items/${id}/report`, { reason });
  }
}
