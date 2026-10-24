import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../project/api';
import { DEFAULT_HUB, HubClient, hubAddressProblem, type HubItem } from '../library/hub';
import { PACK_KIND_LABELS, type PackKind } from '../library/pack';
import { libraryChanged } from '../library/changes';
import { openLibrary, thumbnailOf } from '../library/session';
import type { Library } from '../library/store';

const KINDS: PackKind[] = ['tile', 'tileset', 'prop', 'attachment', 'character', 'animation', 'ui', 'structure', 'behaviour', 'sound'];
const LICENCES: Record<string, string> = {
  'CC0-1.0': 'CC0 (public domain)',
  'CC-BY-4.0': 'CC-BY (credit the author)',
  'CC-BY-NC-4.0': 'CC-BY-NC (credit, not for sale)',
  'free-for-any-game': 'Free to use in any game',
  custom: 'Custom (read the description)',
};

const read = (key: string, fallback = ''): string => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* settings that cannot be kept are asked for again */
  }
};

/** The community Asset Hub: find packs other people shared, add them to your library, and share your own. */
export function HubPanel() {
  const [address, setAddress] = useState(() => read('tilewright.hub', DEFAULT_HUB));
  const [hubName, setHubName] = useState('');
  const [signedIn, setSignedIn] = useState('');
  const [status, setStatus] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [licence, setLicence] = useState('');
  const [sort, setSort] = useState<'new' | 'rating' | 'downloads' | 'name'>('new');
  const [items, setItems] = useState<HubItem[]>([]);
  const [mine, setMine] = useState<HubItem[]>([]);
  const [open, setOpen] = useState<HubItem | null>(null);
  const [codeOk, setCodeOk] = useState(false);
  const [reason, setReason] = useState('');
  const [lib, setLib] = useState<Library | null>(null);
  const [pick, setPick] = useState('');
  const [notes, setNotes] = useState('');
  const client = useRef<HubClient | null>(null);

  const make = (): HubClient => {
    if (!client.current || client.current.address !== address) {
      client.current = new HubClient(address, (r) => api().hubRequest(r));
      client.current.token = read(`tilewright.hub.token.${address}`);
    }
    return client.current;
  };
  const guard = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  const refresh = async (): Promise<void> => {
    const c = make();
    setItems((await c.search({ q, kind, licence, sort })).items);
    if (c.token) setMine(await c.mine().catch(() => []));
  };
  useEffect(() => {
    void openLibrary().then(setLib).catch(() => undefined);
  }, []);

  const connect = (): Promise<void> =>
    guard(async () => {
      const problem = hubAddressProblem(address);
      if (problem) return setStatus(problem);
      write('tilewright.hub', address);
      client.current = null;
      const c = make();
      const h = await c.health();
      setHubName(h.name);
      setStatus(`Connected to ${h.name}.`);
      if (c.token) {
        try {
          await c.mine();
          setSignedIn(read(`tilewright.hub.user.${address}`));
        } catch {
          c.token = '';
        }
      }
      await refresh();
    });

  const auth = (create: boolean): Promise<void> =>
    guard(async () => {
      const c = make();
      const who = create ? await c.register(name, password) : await c.login(name, password);
      write(`tilewright.hub.token.${address}`, c.token);
      write(`tilewright.hub.user.${address}`, who);
      setSignedIn(who);
      setPassword('');
      setStatus(`Signed in as ${who}.`);
      await refresh();
    });

  const get = (item: HubItem): Promise<void> =>
    guard(async () => {
      const l = lib ?? (await openLibrary());
      const got = await make().download(item.id);
      const saved = await l.save(got.pack, { thumb: item.thumb || thumbnailOf(got.pack), note: `From the hub (version ${got.item.version})`, origin: { hub: address, id: item.id, version: got.item.version } });
      setLib(l);
      libraryChanged();
      setStatus(`Added "${saved.name}" to your library. Open the Library panel and press Add to project to use it.`);
    });

  const mineLib = useMemo(() => lib?.index.items ?? [], [lib, status]);

  return (
    <div className="panel hub-panel" data-testid="hub-panel">
      <p className="hint">The Asset Hub is a place where people share asset packs of tiles, props, characters, structures and more. Everything you take stays free to use under the licence its author chose. This computer only talks to the address you type here.</p>
      <div className="row">
        <input data-testid="hub-address" aria-label="Hub address" value={address} onChange={(e) => setAddress(e.target.value)} />
        <button data-testid="hub-connect" onClick={() => void connect()}>
          Connect
        </button>
      </div>
      {status && (
        <p className="hint" data-testid="hub-status">
          {status}
        </p>
      )}

      {hubName && (
        <>
          <h3>Your account</h3>
          {signedIn ? (
            <p data-testid="hub-user">
              Signed in as <strong>{signedIn}</strong>{' '}
              <button
                data-testid="hub-signout"
                onClick={() => {
                  make().token = '';
                  write(`tilewright.hub.token.${address}`, '');
                  setSignedIn('');
                  setMine([]);
                }}
              >
                Sign out
              </button>
            </p>
          ) : (
            <div className="row">
              <input data-testid="hub-name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <input data-testid="hub-password" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button data-testid="hub-signin" onClick={() => void auth(false)}>
                Sign in
              </button>
              <button data-testid="hub-signup" onClick={() => void auth(true)}>
                Make an account
              </button>
            </div>
          )}

          <h3>Find something</h3>
          <div className="row">
            <input data-testid="hub-search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void guard(refresh)} />
            <select data-testid="hub-kind" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All kinds</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {PACK_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <select data-testid="hub-licence" aria-label="Licence" value={licence} onChange={(e) => setLicence(e.target.value)}>
              <option value="">Any licence</option>
              {Object.entries(LICENCES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select data-testid="hub-sort" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="new">Newest</option>
              <option value="rating">Best rated</option>
              <option value="downloads">Most taken</option>
              <option value="name">Name</option>
            </select>
            <button data-testid="hub-find" onClick={() => void guard(refresh)}>
              Search
            </button>
          </div>
          <div className="library-grid" data-testid="hub-results">
            {items.length === 0 && <span className="hint">Nothing found yet.</span>}
            {items.map((i) => (
              <div key={i.id} className={`library-card${open?.id === i.id ? ' on' : ''}`} data-testid={`hub-item-${i.id}`}>
                <button className="library-thumb" onClick={() => { setOpen(i); setCodeOk(false); }}>
                  {i.thumb ? <img src={i.thumb} alt="" width={48} height={48} style={{ imageRendering: 'pixelated' }} /> : <span>{PACK_KIND_LABELS[i.kind as PackKind] ?? i.kind}</span>}
                </button>
                <strong>{i.name}</strong>
                <span className="hint">
                  by {i.author} - {LICENCES[i.licence] ?? i.licence}
                </span>
                <span className="hint">
                  {i.ratings > 0 ? `${i.rating} / 5 (${i.ratings})` : 'not rated'} - {i.downloads} taken{i.code ? ' - HAS CODE' : ''}
                </span>
              </div>
            ))}
          </div>

          {open && (
            <div className="library-details" data-testid="hub-details">
              <h3>{open.name}</h3>
              <p>{open.description || '(no description)'}</p>
              <p className="hint">
                Made by {open.author}. Licence: {LICENCES[open.licence] ?? open.licence}. {['CC-BY-4.0', 'CC-BY-NC-4.0'].includes(open.licence) ? 'Games that use it list the author in a credits file automatically. ' : ''}
                {open.licence === 'CC-BY-NC-4.0' ? 'It may not be used in a game that is sold.' : ''}
              </p>
              {open.code && (
                <div className="warn" data-testid="hub-code-warning">
                  <p>This asset pack contains code (scripts or plugins). A moderator approved it, but code can still do things you do not want: read it before you use it.</p>
                  <label className="field">
                    <input type="checkbox" data-testid="hub-code-ok" checked={codeOk} onChange={(e) => setCodeOk(e.target.checked)} /> <span>I understand it contains code and I want it in my library.</span>
                  </label>
                </div>
              )}
              <div className="row">
                <button data-testid="hub-get" disabled={open.code && !codeOk} onClick={() => void get(open)}>
                  Add to my library
                </button>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} data-testid={`hub-rate-${n}`} disabled={!signedIn} title={signedIn ? 'Rate it' : 'Sign in to rate'} onClick={() => void guard(async () => { setOpen(await make().rate(open.id, n)); await refresh(); })}>
                    {n}
                  </button>
                ))}
              </div>
              <div className="row">
                <input data-testid="hub-report-reason" placeholder="Something wrong with it? Say what." value={reason} onChange={(e) => setReason(e.target.value)} />
                <button
                  data-testid="hub-report"
                  disabled={!signedIn}
                  onClick={() => void guard(async () => {
                    await make().report(open.id, reason);
                    setReason('');
                    setStatus('Thank you. A moderator will look at it.');
                  })}
                >
                  Report
                </button>
              </div>
            </div>
          )}

          <h3>Share something of yours</h3>
          {!signedIn ? (
            <p className="hint">Sign in to share. The asset pack goes up with your account name as its author, under the licence you chose when you saved it to your library.</p>
          ) : (
            <>
              <div className="row">
                <select data-testid="hub-publish-item" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">(choose an item from your library)</option>
                  {mineLib.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} - {PACK_KIND_LABELS[i.kind]}
                      {i.licence ? '' : ' (no licence yet)'}
                    </option>
                  ))}
                </select>
                <input data-testid="hub-notes" placeholder="What is new in this version?" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <button
                  data-testid="hub-publish"
                  disabled={!pick}
                  onClick={() => void guard(async () => {
                    const l = lib ?? (await openLibrary());
                    const item = l.item(pick);
                    if (!item) return setStatus('That item is no longer in your library.');
                    const pack = await l.readPack(pick);
                    const done = await make().publish({ ...pack, ...(item.thumb ? ({ thumb: item.thumb } as object) : {}) } as typeof pack, notes);
                    setStatus(done.status === 'pending' ? `"${done.name}" was uploaded. It contains code, so it waits for a moderator before anyone can see it.` : `"${done.name}" is now on the hub (version ${done.version}).`);
                    setNotes('');
                    await refresh();
                  })}
                >
                  Publish
                </button>
              </div>
              {mine.length > 0 && (
                <ul className="library-versions" data-testid="hub-mine">
                  {mine.map((m) => (
                    <li key={m.id}>
                      {m.name} v{m.version} - {m.status === 'approved' ? 'on the hub' : m.status === 'pending' ? 'waiting for a moderator' : m.status === 'rejected' ? `refused: ${m.moderationNote}` : 'hidden while a moderator looks at reports'}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
      <p className="hint">Running your own hub, or moderating one? See docs/HUB_HOSTING.md.</p>
    </div>
  );
}
