import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { preflightGamePart, type PreflightWorker } from './preflight';

/** A worker that runs its source for real (in a context with `postMessage`), but is not a thread: loops are cut short by a time limit. */
function realish(source: string): PreflightWorker {
  const w: PreflightWorker = { postMessage: () => undefined, terminate: () => undefined, onmessage: null, onerror: null };
  const ctx = vm.createContext({ postMessage: (m: unknown) => w.onmessage?.({ data: m }), Proxy, Symbol, Object });
  queueMicrotask(() => {
    try {
      vm.runInContext(source, ctx, { timeout: 300 });
    } catch {
      /* a loop that never ends is cut short here; the preflight itself gives up on its own clock */
    }
  });
  return w;
}

describe('trying out the game part of a plugin from outside before it is started', () => {
  it('lets a plugin that starts normally through', async () => {
    const code = `module.exports.default = require('@tilewright/plugin-sdk').definePlugin({ id: 'a' }, { install(api) { api.system('x', () => {}); } });`;
    expect(await preflightGamePart('A', code, realish, 500)).toBeNull();
  });

  it('lets a plugin through that fails in the worker (it touches the page), because that proves nothing', async () => {
    expect(await preflightGamePart('A', `document.createElement('div');`, realish, 500)).toBeNull();
  });

  it('refuses a plugin with a loop at the top of its file', async () => {
    const answer = await preflightGamePart('Spinner', `while (true) {}`, realish, 150);
    expect(answer).toMatch(/"Spinner" did not finish starting/);
  });

  it('refuses a plugin whose install never returns', async () => {
    const code = `module.exports.default = require('@tilewright/plugin-sdk').definePlugin({ id: 'a' }, { install() { for (;;) {} } });`;
    expect(await preflightGamePart('Looper', code, realish, 150)).toMatch(/did not finish/);
  });
});
