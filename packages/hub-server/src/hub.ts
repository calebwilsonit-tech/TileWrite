import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { LICENCES, checkIncomingPack, type IncomingPack } from './pack';

/**
 * The Asset Hub's rules, with no network in it: accounts, publishing, search, ratings, reports and moderation. The HTTP layer
 * only translates requests into these calls. Everything is kept in one State object that a Store saves.
 */

export class HubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type ItemStatus = 'approved' | 'pending' | 'hidden' | 'rejected';

export interface Account {
  id: string;
  name: string;
  salt: string;
  hash: string;
  createdAt: string;
}

export interface ItemVersion {
  n: number;
  publishedAt: string;
  notes: string;
  bytes: number;
}

export interface Item {
  id: string;
  name: string;
  kind: string;
  /** The publisher's account name: set by the hub, never by the pack file. */
  author: string;
  accountId: string;
  licence: string;
  description: string;
  tags: string[];
  /** The pack holds code (marked in the list, held back until a moderator approves it). */
  code: boolean;
  status: ItemStatus;
  versions: ItemVersion[];
  downloads: number;
  /** One rating from 1 to 5 per account. */
  ratings: Record<string, number>;
  /** A small picture (data URL) from the pack's first sprite, if the publisher sent one. */
  thumb: string;
  tileSize?: { w: number; h: number };
  fileCount: number;
  createdAt: string;
  updatedAt: string;
  /** Why a moderator refused it, shown to the publisher. */
  moderationNote: string;
}

export interface Report {
  id: string;
  itemId: string;
  by: string;
  reason: string;
  at: string;
  resolution: '' | 'dismissed' | 'hidden' | 'removed';
}

export interface State {
  accounts: Account[];
  /** Token hashes. */
  sessions: { token: string; accountId: string; expires: number }[];
  items: Item[];
  reports: Report[];
  /** When each account published lately (for the rate limit). */
  publishLog: Record<string, number[]>;
  counter: number;
}

export const emptyState = (): State => ({ accounts: [], sessions: [], items: [], reports: [], publishLog: {}, counter: 0 });

export interface HubStore {
  load(): State;
  save(state: State): void;
  putPack(itemId: string, version: number, text: string): void;
  getPack(itemId: string, version: number): string | null;
  removePacks(itemId: string): void;
}

export class MemoryStore implements HubStore {
  state = emptyState();
  readonly packs = new Map<string, string>();
  load(): State {
    return this.state;
  }
  save(state: State): void {
    this.state = state;
  }
  putPack(itemId: string, version: number, text: string): void {
    this.packs.set(`${itemId}/${version}`, text);
  }
  getPack(itemId: string, version: number): string | null {
    return this.packs.get(`${itemId}/${version}`) ?? null;
  }
  removePacks(itemId: string): void {
    for (const k of [...this.packs.keys()]) if (k.startsWith(`${itemId}/`)) this.packs.delete(k);
  }
}

export interface HubOptions {
  /** The moderators' secret; without one nobody can approve code packs. */
  adminToken?: string;
  now?: () => number;
  /** Publishes allowed per account per hour. */
  publishesPerHour?: number;
  /** Distinct reports that hide an item until a moderator looks. */
  reportsToHide?: number;
}

export interface Actor {
  /** Signed in account, if any. */
  account: Account | null;
  /** Has the moderators' token. */
  admin: boolean;
}

export interface ListQuery {
  q?: string;
  kind?: string;
  tag?: string;
  licence?: string;
  sort?: 'new' | 'rating' | 'downloads' | 'name';
  limit?: number;
  offset?: number;
}

export interface PublicItem {
  id: string;
  name: string;
  kind: string;
  author: string;
  licence: string;
  description: string;
  tags: string[];
  code: boolean;
  status: ItemStatus;
  version: number;
  versions: ItemVersion[];
  downloads: number;
  rating: number;
  ratings: number;
  thumb: string;
  tileSize?: { w: number; h: number };
  fileCount: number;
  updatedAt: string;
  moderationNote: string;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item';

export class Hub {
  state: State;
  private readonly now: () => number;

  constructor(
    private readonly store: HubStore,
    private readonly opts: HubOptions = {},
  ) {
    this.state = store.load();
    this.now = opts.now ?? Date.now;
  }

  private save(): void {
    this.store.save(this.state);
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  // ---------- accounts ----------

  register(name: string, password: string): { account: { id: string; name: string }; token: string } {
    const n = name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]{1,29}$/.test(n)) throw new HubError(400, 'Choose a name of 2 to 30 letters, numbers, spaces, - _ or . that starts with a letter or number.');
    if (password.length < 8) throw new HubError(400, 'Choose a password of at least 8 characters.');
    if (this.state.accounts.some((a) => a.name.toLowerCase() === n.toLowerCase())) throw new HubError(409, `The name "${n}" is taken.`);
    const salt = randomBytes(16).toString('hex');
    const account: Account = { id: `u${++this.state.counter}`, name: n, salt, hash: scryptSync(password, salt, 32).toString('hex'), createdAt: this.iso() };
    this.state.accounts.push(account);
    const token = this.newSession(account.id);
    this.save();
    return { account: { id: account.id, name: account.name }, token };
  }

  login(name: string, password: string): { account: { id: string; name: string }; token: string } {
    const a = this.state.accounts.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    const wrong = new HubError(401, 'The name or the password is wrong.');
    if (!a) throw wrong;
    const given = scryptSync(password, a.salt, 32);
    const have = Buffer.from(a.hash, 'hex');
    if (given.length !== have.length || !timingSafeEqual(given, have)) throw wrong;
    const token = this.newSession(a.id);
    this.save();
    return { account: { id: a.id, name: a.name }, token };
  }

  private newSession(accountId: string): string {
    const token = randomBytes(24).toString('base64url');
    const t = this.now();
    this.state.sessions = this.state.sessions.filter((s) => s.expires > t);
    this.state.sessions.push({ token: hashToken(token), accountId, expires: t + 30 * 24 * 3600 * 1000 });
    return token;
  }

  /** Who is asking, from the Authorization header value ("Bearer ..."). */
  actor(authorization: string | undefined): Actor {
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1]?.trim() ?? '';
    if (!token) return { account: null, admin: false };
    if (this.opts.adminToken && token.length === this.opts.adminToken.length && timingSafeEqual(Buffer.from(token), Buffer.from(this.opts.adminToken))) return { account: null, admin: true };
    const h = hashToken(token);
    const s = this.state.sessions.find((x) => x.token === h && x.expires > this.now());
    const account = s ? (this.state.accounts.find((a) => a.id === s.accountId) ?? null) : null;
    return { account, admin: false };
  }

  private needAccount(actor: Actor): Account {
    if (!actor.account) throw new HubError(401, 'Sign in first.');
    return actor.account;
  }

  private needAdmin(actor: Actor): void {
    if (!actor.admin) throw new HubError(403, 'Only moderators can do that.');
  }

  // ---------- publishing ----------

  publish(actor: Actor, packJson: unknown, size: number, notes = ''): PublicItem {
    const account = this.needAccount(actor);
    const check = checkIncomingPack(packJson, size);
    if (!check.ok || !check.pack) throw new HubError(400, check.problems.join(' '));
    const pack: IncomingPack = check.pack;
    const t = this.now();
    const lately = (this.state.publishLog[account.id] ?? []).filter((x) => t - x < 3600 * 1000);
    if (lately.length >= (this.opts.publishesPerHour ?? 10)) throw new HubError(429, 'You have published a lot in the last hour. Please wait a little before sharing more.');
    // the publisher's name is the author, whatever the file says
    const stamped = { ...pack, author: account.name };
    const text = JSON.stringify(stamped);
    let item = this.state.items.find((i) => i.accountId === account.id && i.name.toLowerCase() === pack.name.toLowerCase() && i.kind === pack.kind && i.status !== 'rejected');
    if (!item) {
      let id = `${slug(pack.name)}-${++this.state.counter}`;
      while (this.state.items.some((i) => i.id === id)) id = `${slug(pack.name)}-${++this.state.counter}`;
      item = {
        id,
        name: pack.name,
        kind: pack.kind,
        author: account.name,
        accountId: account.id,
        licence: pack.licence,
        description: pack.description,
        tags: pack.tags,
        code: check.hasCode,
        status: 'pending',
        versions: [],
        downloads: 0,
        ratings: {},
        thumb: typeof (packJson as { thumb?: unknown }).thumb === 'string' ? String((packJson as { thumb: string }).thumb).slice(0, 20_000) : '',
        fileCount: pack.files.length,
        createdAt: this.iso(),
        updatedAt: this.iso(),
        moderationNote: '',
      };
      this.state.items.push(item);
    }
    const n = (item.versions.at(-1)?.n ?? 0) + 1;
    item.versions.push({ n, publishedAt: this.iso(), notes: notes.slice(0, 500), bytes: size });
    item.licence = pack.licence;
    item.description = pack.description;
    item.tags = pack.tags;
    item.code = check.hasCode;
    item.fileCount = pack.files.length;
    if (pack.tileSize) item.tileSize = pack.tileSize;
    item.updatedAt = this.iso();
    // packs with code wait for a moderator; others are on the shelf at once (and can be reported)
    if (item.status !== 'hidden') item.status = check.hasCode ? 'pending' : 'approved';
    item.moderationNote = '';
    this.store.putPack(item.id, n, text);
    this.state.publishLog[account.id] = [...lately, t];
    this.save();
    return this.publicOf(item);
  }

  // ---------- reading ----------

  private publicOf(i: Item): PublicItem {
    const stars = Object.values(i.ratings);
    return {
      id: i.id,
      name: i.name,
      kind: i.kind,
      author: i.author,
      licence: i.licence,
      description: i.description,
      tags: i.tags,
      code: i.code,
      status: i.status,
      version: i.versions.at(-1)?.n ?? 0,
      versions: i.versions,
      downloads: i.downloads,
      rating: stars.length ? Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10 : 0,
      ratings: stars.length,
      thumb: i.thumb,
      ...(i.tileSize ? { tileSize: i.tileSize } : {}),
      fileCount: i.fileCount,
      updatedAt: i.updatedAt,
      moderationNote: i.moderationNote,
    };
  }

  private canSee(actor: Actor, i: Item): boolean {
    return i.status === 'approved' || actor.admin || actor.account?.id === i.accountId;
  }

  list(actor: Actor, q: ListQuery = {}): { total: number; items: PublicItem[] } {
    const words = (q.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    let items = this.state.items.filter((i) => i.status === 'approved');
    if (q.kind) items = items.filter((i) => i.kind === q.kind);
    if (q.tag) items = items.filter((i) => i.tags.some((t) => t.toLowerCase() === q.tag!.toLowerCase()));
    if (q.licence) items = items.filter((i) => i.licence === q.licence);
    if (words.length) items = items.filter((i) => words.every((w) => `${i.name} ${i.author} ${i.kind} ${i.description} ${i.tags.join(' ')}`.toLowerCase().includes(w)));
    const pub = items.map((i) => this.publicOf(i));
    const by = q.sort ?? 'new';
    pub.sort((a, b) => (by === 'rating' ? b.rating - a.rating || b.ratings - a.ratings : by === 'downloads' ? b.downloads - a.downloads : by === 'name' ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt)));
    const off = Math.max(0, q.offset ?? 0);
    const lim = Math.min(100, Math.max(1, q.limit ?? 40));
    void actor;
    return { total: pub.length, items: pub.slice(off, off + lim) };
  }

  /** What the signed-in person published (all states), so they can see a pack waiting for a moderator. */
  mine(actor: Actor): PublicItem[] {
    const a = this.needAccount(actor);
    return this.state.items.filter((i) => i.accountId === a.id).map((i) => this.publicOf(i));
  }

  get(actor: Actor, id: string): PublicItem {
    const i = this.state.items.find((x) => x.id === id);
    if (!i || !this.canSee(actor, i)) throw new HubError(404, 'There is no such item.');
    return this.publicOf(i);
  }

  /** The pack file itself. Counts as a download (not for its publisher or a moderator). */
  download(actor: Actor, id: string, version?: number): { text: string; item: PublicItem } {
    const i = this.state.items.find((x) => x.id === id);
    if (!i || !this.canSee(actor, i)) throw new HubError(404, 'There is no such item.');
    const n = version ?? i.versions.at(-1)?.n ?? 0;
    const text = this.store.getPack(id, n);
    if (text === null) throw new HubError(404, `Version ${n} of this item is not available.`);
    if (!actor.admin && actor.account?.id !== i.accountId) {
      i.downloads++;
      this.save();
    }
    return { text, item: this.publicOf(i) };
  }

  // ---------- ratings and reports ----------

  rate(actor: Actor, id: string, stars: number): PublicItem {
    const a = this.needAccount(actor);
    const i = this.state.items.find((x) => x.id === id);
    if (!i || i.status !== 'approved') throw new HubError(404, 'There is no such item.');
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HubError(400, 'Give 1 to 5 stars.');
    if (i.accountId === a.id) throw new HubError(403, 'You cannot rate your own item.');
    i.ratings[a.id] = stars;
    this.save();
    return this.publicOf(i);
  }

  report(actor: Actor, id: string, reason: string): { reported: true } {
    const a = this.needAccount(actor);
    const i = this.state.items.find((x) => x.id === id);
    if (!i) throw new HubError(404, 'There is no such item.');
    const text = reason.trim().slice(0, 500);
    if (text.length < 5) throw new HubError(400, 'Say what is wrong (a few words at least).');
    if (this.state.reports.some((r) => r.itemId === id && r.by === a.name && r.resolution === '')) throw new HubError(409, 'You have already reported this item; a moderator will look at it.');
    this.state.reports.push({ id: `r${++this.state.counter}`, itemId: id, by: a.name, reason: text, at: this.iso(), resolution: '' });
    const open = new Set(this.state.reports.filter((r) => r.itemId === id && r.resolution === '').map((r) => r.by));
    if (open.size >= (this.opts.reportsToHide ?? 3) && i.status === 'approved') i.status = 'hidden';
    this.save();
    return { reported: true };
  }

  // ---------- moderation ----------

  moderationQueue(actor: Actor): { pending: PublicItem[]; reports: (Report & { item: string })[] } {
    this.needAdmin(actor);
    return {
      pending: this.state.items.filter((i) => i.status === 'pending' || i.status === 'hidden').map((i) => this.publicOf(i)),
      reports: this.state.reports.filter((r) => r.resolution === '').map((r) => ({ ...r, item: this.state.items.find((i) => i.id === r.itemId)?.name ?? r.itemId })),
    };
  }

  approve(actor: Actor, id: string): PublicItem {
    this.needAdmin(actor);
    const i = this.state.items.find((x) => x.id === id);
    if (!i) throw new HubError(404, 'There is no such item.');
    i.status = 'approved';
    i.moderationNote = '';
    for (const r of this.state.reports) if (r.itemId === id && r.resolution === '') r.resolution = 'dismissed';
    this.save();
    return this.publicOf(i);
  }

  reject(actor: Actor, id: string, note: string): PublicItem {
    this.needAdmin(actor);
    const i = this.state.items.find((x) => x.id === id);
    if (!i) throw new HubError(404, 'There is no such item.');
    i.status = 'rejected';
    i.moderationNote = note.slice(0, 300) || 'A moderator did not accept this item.';
    for (const r of this.state.reports) if (r.itemId === id && r.resolution === '') r.resolution = 'hidden';
    this.save();
    return this.publicOf(i);
  }

  remove(actor: Actor, id: string): void {
    const i = this.state.items.find((x) => x.id === id);
    if (!i) throw new HubError(404, 'There is no such item.');
    if (!actor.admin && actor.account?.id !== i.accountId) throw new HubError(403, 'Only the publisher or a moderator can remove an item.');
    this.state.items = this.state.items.filter((x) => x.id !== id);
    for (const r of this.state.reports) if (r.itemId === id && r.resolution === '') r.resolution = 'removed';
    this.store.removePacks(id);
    this.save();
  }

  dismissReport(actor: Actor, reportId: string): void {
    this.needAdmin(actor);
    const r = this.state.reports.find((x) => x.id === reportId);
    if (!r) throw new HubError(404, 'There is no such report.');
    r.resolution = 'dismissed';
    this.save();
  }

  licences(): readonly string[] {
    return LICENCES;
  }
}
