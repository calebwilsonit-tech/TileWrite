import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Hub, MemoryStore, createHubServer } from '../../../../hub-server/src';
import { HubClient, HubProblem, hubAddressProblem, type HubRequest } from './hub';
import { PACK_FORMAT, PACK_VERSION, type Pack } from './pack';

const pack = (over: Partial<Pack> = {}): Pack => ({ format: PACK_FORMAT, formatVersion: PACK_VERSION, name: 'Meadow', kind: 'tileset', description: 'Soft grass', author: '', licence: 'CC-BY-4.0', tags: ['grass'], createdAt: '', files: [{ path: 'assets/sprites/m.sprite.json', encoding: 'utf8', data: '{}' }], tiles: [], autotile: [], uiPrefabs: [], code: false, ...over });

describe('the hub client', () => {
  let server: Server;
  let address = '';
  const request: HubRequest = async (r) => {
    const res = await fetch(r.url, { method: r.method, headers: { 'Content-Type': 'application/json', ...(r.token ? { Authorization: `Bearer ${r.token}` } : {}) }, body: r.body });
    return { status: res.status, text: await res.text(), version: res.headers.get('x-item-version') ?? '' };
  };
  beforeAll(async () => {
    server = createHubServer(new Hub(new MemoryStore(), { adminToken: 'c'.repeat(32) }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('checks the address, then signs up, publishes, finds, downloads and rates', async () => {
    expect(hubAddressProblem('hub')).toContain('not a web address');
    expect(hubAddressProblem('http://hub.example.com')).toContain('https://');
    expect(hubAddressProblem('http://localhost:8787')).toBeNull();
    expect(hubAddressProblem('https://hub.example.com')).toBeNull();
    const ada = new HubClient(address, request);
    expect((await ada.health()).licences['CC0-1.0']).toContain('public domain');
    expect(await ada.register('Ada', 'correct horse')).toBe('Ada');
    const item = await ada.publish(pack(), 'first');
    expect(item).toMatchObject({ name: 'Meadow', author: 'Ada', status: 'approved' });
    const bob = new HubClient(address, request);
    await bob.register('Bob', 'password123');
    const found = await bob.search({ q: 'grass', kind: 'tileset' });
    expect(found.items.map((i) => i.id)).toEqual([item.id]);
    const got = await bob.download(item.id);
    expect(got.pack).toMatchObject({ name: 'Meadow', author: 'Ada', licence: 'CC-BY-4.0' });
    expect((await bob.rate(item.id, 5)).rating).toBe(5);
    expect((await bob.search({ sort: 'downloads' })).items[0]!.downloads).toBe(1);
  });

  it('says what went wrong in words', async () => {
    const anon = new HubClient(address, request);
    await expect(anon.publish(pack())).rejects.toThrow('Sign in first');
    await expect(anon.login('Nobody', 'whatever1')).rejects.toThrow('wrong');
    await expect(anon.download('missing-1')).rejects.toThrow('no such item');
    const bad = new HubClient('http://hub.example.com', request);
    await expect(bad.health()).rejects.toBeInstanceOf(HubProblem);
    const notAHub = new HubClient(address, async () => ({ status: 200, text: '<html>', version: '' }));
    await expect(notAHub.health()).rejects.toThrow('not understood');
  });
});
