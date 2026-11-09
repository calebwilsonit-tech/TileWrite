// The door between a game and the computer, for a game exported to run in a web browser (itch.io, a website).
// The desktop game gets this door from its Electron preload script; here it is made in the page itself:
//   - the game's own files (data/...) are fetched from beside the page; data/files.json lists them, because a web server cannot list folders;
//   - saves (saves/...) live in the browser's storage, kept per game name so a new upload of the game keeps them;
//   - full screen is the browser's own; "quit" shows a goodbye card, since a page cannot close its tab.
// It must run before anything takes the door (see renderer/project/api.ts), so web.ts imports it first.

type Entry = { name: string; dir: boolean };

const DATA = 'data';
const SAVES = 'saves';
const testMode = new URLSearchParams(location.search).has('test');

// ---------- browsers keep sound off until the player clicks or presses a key: let every sound system start then ----------
const Ctx = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
if (Ctx) {
  (window as unknown as { AudioContext: typeof AudioContext }).AudioContext = class extends Ctx {
    constructor(options?: AudioContextOptions) {
      super(options);
      const wake = (): void => {
        if (this.state === 'suspended') void this.resume().catch(() => undefined);
      };
      for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, wake, { capture: true });
      wake();
    }
  };
}

// ---------- "Click to play": the click lets sound start, and on itch.io it gives the game the keyboard ----------
let started!: () => void;
const clicked = new Promise<void>((resolve) => (started = resolve));
function cover(): void {
  if (testMode) {
    started();
    return;
  }
  const el = document.createElement('div');
  el.setAttribute('data-testid', 'web-start');
  el.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#0b0c10;color:#e6e8ee;z-index:200000;cursor:pointer;font-family:system-ui,sans-serif;user-select:none';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:30px;font-weight:700;letter-spacing:0.04em';
  title.textContent = document.title || 'Game';
  void game().then((m) => (title.textContent = m.name));
  const go = document.createElement('div');
  go.style.cssText = 'padding:12px 30px;border:2px solid #e6e8ee;border-radius:8px;font-size:20px';
  go.textContent = '▶  Click to play';
  el.append(title, go);
  const start = (): void => {
    el.remove();
    window.removeEventListener('keydown', start);
    window.focus();
    started();
  };
  el.addEventListener('pointerdown', start);
  window.addEventListener('keydown', start);
  document.body.appendChild(el);
}

// ---------- the game's files ----------
let index: Promise<Set<string>> | null = null;
const files = (): Promise<Set<string>> =>
  (index ??= fetch(`${DATA}/files.json`)
    .then((r) => (r.ok ? (r.json() as Promise<string[]>) : []))
    .then((list) => new Set(list.map((f) => `${DATA}/${f}`))));
let manifest: Promise<{ name: string; version: string }> | null = null;
const game = (): Promise<{ name: string; version: string }> =>
  (manifest ??= fetch(`${DATA}/game.json`)
    .then((r) => r.json() as Promise<{ name?: string; version?: string }>)
    .then((m) => {
      document.title = m.name ?? document.title;
      return { name: m.name ?? 'Game', version: m.version ?? '1.0.0' };
    })
    .catch(() => ({ name: 'Game', version: '1.0.0' })));

/** A path as the player gives it ("data/scenes/a.json", maybe with backslashes or "./"), made plain. */
const clean = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');
const isSave = (p: string): boolean => p === SAVES || p.startsWith(`${SAVES}/`);
const url = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

async function fetchData(p: string): Promise<Response> {
  const r = await fetch(url(p));
  if (!r.ok) throw new Error(`The game file "${p}" could not be loaded (${r.status}).`);
  return r;
}

// ---------- saves, in the browser's storage ----------
const key = async (p: string): Promise<string> => `tilewright:${(await game()).name}:${p}`;
const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null; // (storage turned off, or a private window in some browsers)
  }
};
const memory = new Map<string, string>(); // used when the browser keeps no storage: saves last until the tab closes
const getSave = async (p: string): Promise<string | null> => {
  const k = await key(p);
  return storage()?.getItem(k) ?? memory.get(k) ?? null;
};
const setSave = async (p: string, text: string): Promise<void> => {
  const k = await key(p);
  try {
    const s = storage();
    if (s) s.setItem(k, text);
    else memory.set(k, text);
  } catch {
    memory.set(k, text); // (storage full)
  }
};
const toBase64 = (b: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (t: string): Uint8Array => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
const BINARY = 'base64:';

async function children(dir: string): Promise<Entry[]> {
  const out = new Map<string, boolean>();
  const add = (full: string): void => {
    if (!full.startsWith(`${dir}/`)) return;
    const rest = full.slice(dir.length + 1);
    const slash = rest.indexOf('/');
    out.set(slash < 0 ? rest : rest.slice(0, slash), slash >= 0 || out.get(rest) === true);
  };
  if (isSave(dir)) {
    const prefix = await key('');
    const s = storage();
    const keys = [...(s ? Array.from({ length: s.length }, (_, i) => s.key(i) ?? '') : []), ...memory.keys()];
    for (const k of keys) if (k.startsWith(prefix)) add(k.slice(prefix.length));
  } else for (const f of await files()) add(f);
  return [...out].map(([name, isDir]) => ({ name, dir: isDir }));
}

const door = {
  platform: 'web',
  fs: {
    async read(file: string): Promise<string> {
      await clicked;
      const p = clean(file);
      if (isSave(p)) {
        const t = await getSave(p);
        if (t === null) throw new Error(`ENOENT: no save at "${p}".`);
        return t.startsWith(BINARY) ? new TextDecoder().decode(fromBase64(t.slice(BINARY.length))) : t;
      }
      return (await fetchData(p)).text();
    },
    async readBinary(file: string): Promise<Uint8Array> {
      await clicked;
      const p = clean(file);
      if (isSave(p)) {
        const t = await getSave(p);
        if (t === null) throw new Error(`ENOENT: no save at "${p}".`);
        return t.startsWith(BINARY) ? fromBase64(t.slice(BINARY.length)) : new TextEncoder().encode(t);
      }
      return new Uint8Array(await (await fetchData(p)).arrayBuffer());
    },
    async write(file: string, text: string): Promise<void> {
      const p = clean(file);
      if (!isSave(p)) throw new Error('A game in a browser can only write its saves.');
      await setSave(p, text);
    },
    async writeBinary(file: string, bytes: Uint8Array): Promise<void> {
      const p = clean(file);
      if (!isSave(p)) throw new Error('A game in a browser can only write its saves.');
      await setSave(p, BINARY + toBase64(bytes));
    },
    async exists(file: string): Promise<boolean> {
      const p = clean(file);
      if (isSave(p)) return (await getSave(p)) !== null || (await children(p)).length > 0;
      const all = await files();
      return all.has(p) || [...all].some((f) => f.startsWith(`${p}/`));
    },
    async remove(file: string): Promise<void> {
      const p = clean(file);
      if (!isSave(p)) return;
      const k = await key(p);
      storage()?.removeItem(k);
      memory.delete(k);
    },
    async list(dir: string): Promise<Entry[]> {
      await clicked;
      return children(clean(dir));
    },
  },
  game: {
    async info() {
      await clicked;
      const m = await game();
      return { name: m.name, version: m.version, dataDir: DATA, savesDir: SAVES, logsDir: 'logs', platform: 'web', testMode };
    },
    async crash(text: string): Promise<string> {
      try {
        storage()?.setItem(await key('crash-report.txt'), text);
        return "this browser's storage for the game (use Copy the details to send it)";
      } catch {
        return '';
      }
    },
    async quit(): Promise<void> {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#0b0c10;color:#e6e8ee;z-index:200000;font-family:system-ui,sans-serif';
      const t = document.createElement('div');
      t.style.cssText = 'font-size:26px';
      t.textContent = 'Thanks for playing!';
      const again = document.createElement('button');
      again.textContent = 'Play again';
      again.style.cssText = 'font:inherit;font-size:18px;padding:10px 24px;border-radius:8px;border:2px solid #e6e8ee;background:transparent;color:inherit;cursor:pointer';
      again.addEventListener('click', () => location.reload());
      el.append(t, again);
      document.body.appendChild(el);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    },
    async toggleFullscreen(): Promise<void> {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      else await document.documentElement.requestFullscreen().catch(() => undefined);
    },
    async setFullscreen(on: boolean): Promise<void> {
      if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen().catch(() => undefined);
      if (!on && document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    },
    async setSize(): Promise<void> {
      // a page cannot size the browser window: the game fills whatever space the page has
    },
  },
};

let handedOver = false;
(window as unknown as { tilewright: unknown }).tilewright = testMode
  ? { ...door, testHooks: true }
  : {
      testHooks: false,
      platform: 'web',
      unlock: () => {
        if (handedOver) return null;
        handedOver = true;
        return door;
      },
    };

void game(); // (the page's title is the game's name, on the "Click to play" card too)
if (document.body) cover();
else window.addEventListener('DOMContentLoaded', cover);
