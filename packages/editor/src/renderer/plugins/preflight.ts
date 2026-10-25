/**
 * Before the game part of a plugin from outside is started in the editor's own window, it is tried out in a worker with a pretend
 * plugin SDK that does nothing. Code that never returns (a loop at the top of the file, or in `install`) hangs only that worker,
 * which is stopped after a few seconds, and the plugin is refused with a plain message instead of freezing the editor.
 * Errors in the worker prove nothing (the worker has no page, so a plugin that touches the page at the top of its file fails there
 * and works in the real thing); only a worker that does not finish counts.
 */

const PRETEND = `
const hush = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : hush), apply: () => hush, construct: () => hush });
const sdk = new Proxy({}, { get: (_t, k) => (k === 'definePlugin' ? (manifest, parts) => Object.assign({ manifest }, parts) : hush) });
const module = { exports: {} };
const exports = module.exports;
const require = (name) => (name === '@tilewright/plugin-sdk' ? sdk : hush);
`;

export interface PreflightWorker {
  postMessage(m: unknown): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

/** Null when the plugin starts (or fails in a way that says nothing); a plain message when it does not finish in time. */
export function preflightGamePart(name: string, code: string, makeWorker: (source: string) => PreflightWorker, limitMs = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    let worker: PreflightWorker;
    const finish = (answer: string | null): void => {
      clearTimeout(timer);
      worker?.terminate();
      resolve(answer);
    };
    const timer = setTimeout(
      () => finish(`The plugin "${name}" did not finish starting within ${Math.round(limitMs / 1000)} seconds (something at the top of its file, or its install, never ends), so it was not started.`),
      limitMs,
    );
    const source = `${PRETEND}
try {
  ${code}
  const made = module.exports.default || module.exports;
  if (made && typeof made.install === 'function') made.install(hush);
} catch (e) {}
postMessage('done');
`;
    try {
      worker = makeWorker(source);
    } catch {
      finish(null);
      return;
    }
    worker.onmessage = () => finish(null);
    worker.onerror = () => finish(null);
  });
}

/** The real thing, in the editor: a worker made from a blob. */
export function browserWorker(source: string): PreflightWorker {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const w = new Worker(url, { name: 'plugin preflight' });
  URL.revokeObjectURL(url);
  return w as unknown as PreflightWorker;
}
