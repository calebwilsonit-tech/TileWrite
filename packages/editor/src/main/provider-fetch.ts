/**
 * A picture provider (a plugin that makes pictures for the assistant) needs the person's key for its service. The key stays in
 * this process, like the assistant's own: the provider asks for a request to be made and writes `{{key}}` where the key goes, and
 * the request is made here with the key put in, to a host the plugin was allowed to reach. What comes back is the answer, with the
 * key blanked out of it in case the service repeats it. No code in the page ever holds the key.
 */

const PROVIDER = /^[A-Za-z0-9_.-]{1,80}$/;
const MAX_ANSWER = 20 * 1024 * 1024;

export interface ProviderFetchRequest {
  provider: string;
  /** The plugin that offers the provider. */
  plugin: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}

export interface ProviderFetchDeps {
  /** The saved key of a provider, or null. */
  key(provider: string): Promise<string | null>;
  /** What the person allowed the plugin (read from this computer, not from the page); null when it is not installed. */
  permissions(plugin: string): Promise<string[] | null>;
  fetch: typeof fetch;
}

const LOCAL = ['localhost', '127.0.0.1', '[::1]', '::1'];

export async function providerFetch(deps: ProviderFetchDeps, req: ProviderFetchRequest): Promise<{ status: number; body: Uint8Array }> {
  if (typeof req.provider !== 'string' || !PROVIDER.test(req.provider)) throw new Error('That is not a picture provider.');
  if (typeof req.url !== 'string') throw new Error('That is not an address.');
  const marker = '{{key}}';
  // where the request goes is read from the address as written: the key may not be part of it
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(req.url)?.[0] ?? '';
  if (origin.includes(marker) || origin.includes('@')) {
    throw new Error('The key can only be put in the path, the query, a header or the body, never in the part of the address that says where it goes.');
  }
  let parsed: URL;
  try {
    parsed = new URL(req.url.split(marker).join('KEY'));
  } catch {
    throw new Error('That is not an address.');
  }
  const local = LOCAL.includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) throw new Error('A picture provider can only use https:// addresses (http:// only for this computer).');
  const permissions = await deps.permissions(req.plugin);
  if (!permissions) throw new Error('A picture provider can only be asked for by a plugin that is installed.');
  if (!(permissions.includes('network') || permissions.includes(`network:${parsed.hostname}`))) {
    throw new Error(`The plugin was not allowed to use the network for ${parsed.hostname}. It needs the "network" or "network:${parsed.hostname}" permission.`);
  }
  const key = await deps.key(req.provider);
  if (!key) throw new Error(`There is no key saved for "${req.provider}". Add it in the assistant's settings (Picture providers).`);
  const put = (s: string): string => s.split(marker).join(key);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers ?? {})) headers[k] = put(String(v));
  const body = typeof req.body === 'string' ? put(req.body) : req.body;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  try {
    const res = await deps.fetch(put(req.url), { method: req.method ?? 'GET', headers, ...(body !== undefined ? { body: body as BodyInit } : {}), signal: ctl.signal, redirect: 'error' });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_ANSWER) throw new Error('The answer is more than 20 MB, which is too much for a picture.');
    // in case the service repeats what it was sent, the key is blanked out of the answer when it reads as text
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const answer = text.includes(key) ? new TextEncoder().encode(text.split(key).join('***')) : bytes;
    return { status: res.status, body: answer };
  } catch (e) {
    throw new Error(ctl.signal.aborted ? 'The service did not answer in time.' : (e as Error).message, { cause: e });
  } finally {
    clearTimeout(timer);
  }
}
