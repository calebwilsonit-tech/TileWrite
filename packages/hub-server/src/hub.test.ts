import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileStore, Hub, HubError, MemoryStore, checkIncomingPack, createHubServer } from './index';

const pack = (over: Record<string, unknown> = {}) => ({
  format: 'tilewright-pack',
  formatVersion: 1,
  name: 'Meadow',
  kind: 'tileset',
  description: 'Soft green grass',
  author: 'someone else',
  licence: 'CC-BY-4.0',
  tags: ['grass'],
  files: [{ path: 'assets/sprites/meadow.sprite.json', encoding: 'utf8', data: '{}' }],
  tiles: [],
  code: false,
  ...over,
});
const size = (p: unknown): number => JSON.stringify(p).length;
const fail = (fn: () => unknown): HubError => {
  try {
    fn();
  } catch (e) {
    return e as HubError;
  }
  throw new Error('expected a failure');
};

function make(opts = {}) {
  const store = new MemoryStore();
  let t = Date.parse('2026-10-01T00:00:00Z');
  const hub = new Hub(store, { adminToken: 'a'.repeat(32), now: () => t, ...opts });
  const sign = (name: string) => hub.actor(`Bearer ${hub.register(name, 'password123').token}`);
  return { hub, store, sign, advance: (ms: number) => void (t += ms), admin: hub.actor(`Bearer ${'a'.repeat(32)}`) };
}

describe('checking a pack before it is kept', () => {
  it('accepts a good one and explains each way a pack can be refused', () => {
    expect(checkIncomingPack(pack(), 100).ok).toBe(true);
    expect(checkIncomingPack({ hello: 1 }, 10).problems[0]).toContain('not a valid asset pack');
    expect(checkIncomingPack(pack(), 20 * 1024 * 1024).problems[0]).toContain('MB');
    expect(checkIncomingPack(pack({ files: [{ path: '../evil.json', encoding: 'utf8', data: '' }] }), 10).problems.join(' ')).toContain('outside the assets folder');
    expect(checkIncomingPack(pack({ licence: 'whatever' }), 10).problems.join(' ')).toContain('Choose a licence');
    expect(checkIncomingPack(pack({ files: [{ path: 'assets/x.js', encoding: 'utf8', data: 'x' }] }), 10).problems.join(' ')).toContain('does not say it contains code');
    const code = checkIncomingPack(pack({ code: true, files: [{ path: 'assets/x.js', encoding: 'utf8', data: 'x'.repeat(300 * 1024) }] }), 400000);
    expect(code.problems.join(' ')).toContain('allows 256 KB of code');
    expect(checkIncomingPack(pack({ code: true, files: [{ path: 'assets/x.js', encoding: 'utf8', data: 'ok' }] }), 100)).toMatchObject({ ok: true, hasCode: true });
  });
});

describe('the hub', () => {
  it('accounts: names and passwords are checked, passwords are never kept, sign-in works', () => {
    const { hub } = make();
    expect(fail(() => hub.register('a', 'password123')).message).toContain('2 to 30');
    expect(fail(() => hub.register('Valid Name', 'short')).message).toContain('8 characters');
    const r = hub.register('Ada', 'correct horse');
    expect(fail(() => hub.register('ada', 'another one 1')).status).toBe(409);
    expect(JSON.stringify(hub.state)).not.toContain('correct horse');
    expect(hub.login('ADA', 'correct horse').account.name).toBe('Ada');
    expect(fail(() => hub.login('Ada', 'wrong password')).status).toBe(401);
    expect(hub.actor(`Bearer ${r.token}`).account?.name).toBe('Ada');
    expect(hub.actor('Bearer nonsense').account).toBeNull();
  });

  it('publishing: needs an account, the publisher is the author, packs are listed and found by search', () => {
    const { hub, sign } = make();
    expect(fail(() => hub.publish({ account: null, admin: false }, pack(), 100)).status).toBe(401);
    const ada = sign('Ada');
    const item = hub.publish(ada, pack(), size(pack()), 'first version');
    expect(item).toMatchObject({ author: 'Ada', status: 'approved', version: 1, licence: 'CC-BY-4.0', code: false });
    expect(JSON.parse(hub.download(ada, item.id).text).author).toBe('Ada'); // not "someone else"
    const again = hub.publish(ada, pack({ description: 'Greener' }), 100);
    expect(again.version).toBe(2);
    expect(hub.list(ada, {}).total).toBe(1);
    expect(hub.list(ada, { q: 'GREEN' }).items[0]!.id).toBe(item.id);
    expect(hub.list(ada, { q: 'banana' }).total).toBe(0);
    expect(hub.list(ada, { kind: 'prop' }).total).toBe(0);
    expect(hub.list(ada, { licence: 'CC0-1.0' }).total).toBe(0);
    expect(hub.list(ada, { tag: 'GRASS' }).total).toBe(1);
  });

  it('packs with code wait for a moderator, are marked, and only the publisher or a moderator can fetch them until then', () => {
    const { hub, sign, admin } = make();
    const ada = sign('Ada');
    const bob = sign('Bob');
    const p = pack({ name: 'Doors', kind: 'behaviour', code: true, files: [{ path: 'assets/scripts/door.ts', encoding: 'utf8', data: 'export default 1' }] });
    const item = hub.publish(ada, p, size(p));
    expect(item).toMatchObject({ status: 'pending', code: true });
    expect(hub.list(bob, {}).total).toBe(0);
    expect(fail(() => hub.get(bob, item.id)).status).toBe(404);
    expect(fail(() => hub.download(bob, item.id)).status).toBe(404);
    expect(hub.mine(ada)[0]!.status).toBe('pending');
    expect(hub.get(ada, item.id).status).toBe('pending');
    expect(fail(() => hub.approve(bob, item.id)).status).toBe(403);
    expect(hub.moderationQueue(admin).pending.map((i) => i.name)).toEqual(['Doors']);
    hub.approve(admin, item.id);
    expect(hub.list(bob, {}).items[0]).toMatchObject({ name: 'Doors', code: true });
    expect(hub.download(bob, item.id).item.downloads).toBe(1);
    // a second one is refused with a reason the publisher can read
    const q = pack({ name: 'Traps', kind: 'behaviour', code: true, files: [{ path: 'assets/scripts/t.ts', encoding: 'utf8', data: 'x' }] });
    const t = hub.publish(ada, q, size(q));
    hub.reject(admin, t.id, 'It reads files it should not.');
    expect(hub.mine(ada).find((i) => i.name === 'Traps')).toMatchObject({ status: 'rejected', moderationNote: 'It reads files it should not.' });
  });

  it('downloads count for other people, ratings are one per account and not your own', () => {
    const { hub, sign } = make();
    const ada = sign('Ada');
    const bob = sign('Bob');
    const cy = sign('Cy');
    const item = hub.publish(ada, pack(), 100);
    hub.download(ada, item.id);
    hub.download(bob, item.id);
    hub.download({ account: null, admin: false }, item.id);
    expect(hub.get(bob, item.id).downloads).toBe(2);
    expect(fail(() => hub.rate(ada, item.id, 5)).message).toContain('your own');
    hub.rate(bob, item.id, 5);
    hub.rate(cy, item.id, 2);
    hub.rate(bob, item.id, 4); // changes bob's rating, does not add one
    expect(hub.get(ada, item.id)).toMatchObject({ rating: 3, ratings: 2 });
    expect(fail(() => hub.rate(bob, item.id, 9)).status).toBe(400);
    expect(fail(() => hub.rate({ account: null, admin: false }, item.id, 3)).status).toBe(401);
  });

  it('reports: a few different people hide an item until a moderator looks; the moderator can bring it back or remove it', () => {
    const { hub, sign, admin } = make();
    const ada = sign('Ada');
    const item = hub.publish(ada, pack(), 100);
    const people = ['Bob', 'Cy', 'Di'].map(sign);
    expect(fail(() => hub.report(people[0]!, item.id, 'bad')).status).toBe(400);
    hub.report(people[0]!, item.id, 'This is stolen art');
    expect(fail(() => hub.report(people[0]!, item.id, 'Still stolen art')).status).toBe(409);
    hub.report(people[1]!, item.id, 'Not free to use at all');
    expect(hub.list(ada, {}).total).toBe(1);
    hub.report(people[2]!, item.id, 'Copied from a game');
    expect(hub.list(ada, {}).total).toBe(0);
    expect(hub.moderationQueue(admin).reports).toHaveLength(3);
    hub.approve(admin, item.id);
    expect(hub.list(ada, {}).total).toBe(1);
    expect(hub.moderationQueue(admin).reports).toHaveLength(0);
    expect(fail(() => hub.remove(people[0]!, item.id)).status).toBe(403);
    hub.remove(ada, item.id);
    expect(hub.list(ada, {}).total).toBe(0);
  });

  it('publishing is rate limited, and sessions expire', () => {
    const { hub, sign, advance } = make({ publishesPerHour: 2 });
    const ada = sign('Ada');
    hub.publish(ada, pack({ name: 'One' }), 100);
    hub.publish(ada, pack({ name: 'Two' }), 100);
    expect(fail(() => hub.publish(ada, pack({ name: 'Three' }), 100)).status).toBe(429);
    advance(3601 * 1000);
    expect(hub.publish(ada, pack({ name: 'Three' }), 100).name).toBe('Three');
    const token = hub.login('Ada', 'password123').token;
    advance(31 * 24 * 3600 * 1000);
    expect(hub.actor(`Bearer ${token}`).account).toBeNull();
  });
});

describe('the server', () => {
  let server: Server;
  let base = '';
  let dir = '';
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'hub-'));
    server = createHubServer(new Hub(new FileStore(dir), { adminToken: 'b'.repeat(32) }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });
  const call = async (method: string, route: string, body?: unknown, token = ''): Promise<{ status: number; json: any; headers: Headers }> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const res = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json(), headers: res.headers };
  };

  it('signs up, publishes, lists, downloads, rates and moderates over HTTP, and says what went wrong in words', async () => {
    expect((await call('GET', '/health')).json.licences['CC0-1.0']).toContain('public domain');
    const ada = (await call('POST', '/accounts', { name: 'Ada', password: 'correct horse' })).json.token as string;
    expect((await call('POST', '/items', { pack: pack() })).status).toBe(401);
    const made = await call('POST', '/items', { pack: pack(), notes: 'hello' }, ada);
    expect(made.status).toBe(201);
    const id = made.json.id as string;
    const list = await call('GET', '/items?q=grass');
    expect(list.json.items.map((i: { id: string }) => i.id)).toEqual([id]);
    const file = await call('GET', `/items/${id}/pack`);
    expect(file.json).toMatchObject({ format: 'tilewright-pack', author: 'Ada' });
    expect((await call('POST', `/items/${id}/rate`, { stars: 4 }, ada)).json.error).toContain('your own');
    const bob = (await call('POST', '/accounts', { name: 'Bob', password: 'password123' })).json.token as string;
    expect((await call('POST', `/items/${id}/rate`, { stars: 4 }, bob)).json.rating).toBe(4);
    expect((await call('POST', '/items', { pack: { nope: 1 } }, ada)).json.error).toContain('not a valid asset pack');
    expect((await call('GET', '/admin/queue', undefined, ada)).status).toBe(403);
    expect((await call('GET', '/admin/queue', undefined, 'b'.repeat(32))).status).toBe(200);
    expect((await call('GET', '/nothing')).status).toBe(404);
    expect(file.headers.get('access-control-allow-origin')).toBe('*');
  });
});
