import { activate, clearScripts, defaultImporter, installScriptGlobals, loadScript, tsTranspiler, type ScriptEntity, type ScriptGame, type Transpiler } from '@tilewright/behaviors';

export interface ScriptProblemEntry {
  /** Script name (file without the extension). */
  script: string;
  line: number;
  message: string;
}

export interface BreakHit {
  script: string;
  line: number;
  me: ScriptEntity;
  game: ScriptGame;
}

export interface ManagerHooks {
  log(kind: 'log' | 'warn' | 'error', text: string): void;
  onBreak(hit: BreakHit): void;
}

let transpiler: Promise<Transpiler> | null = null;

/** The TypeScript compiler is large, so it is only loaded the first time a script needs compiling. */
export function getTranspiler(): Promise<Transpiler> {
  transpiler ??= import('typescript').then((m) => tsTranspiler((('default' in m && m.default ? m.default : m) as unknown) as Parameters<typeof tsTranspiler>[0]));
  return transpiler;
}

export interface ReloadResult {
  problems: ScriptProblemEntry[];
  /** Breakpoint lines that could not be placed, by script. */
  unplaced: Record<string, number[]>;
  /** Names of the scripts now registered as behaviours. */
  loaded: string[];
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Compile every script and register it as a behaviour (replacing what was there), so the Add menu, the
 * Inspector and the running game all see the new code at once. Reloads are queued so they never overlap.
 */
export function reloadScripts(sources: ReadonlyMap<string, string>, breakpoints: Readonly<Record<string, number[]>>, hooks: ManagerHooks): Promise<ReloadResult> {
  const run = async (): Promise<ReloadResult> => {
    if (sources.size === 0) {
      clearScripts();
      return { problems: [], unplaced: {}, loaded: [] };
    }
    const t = await getTranspiler();
    const importer = defaultImporter();
    clearScripts();
    installScriptGlobals({ log: hooks.log });
    const problems: ScriptProblemEntry[] = [];
    const unplaced: Record<string, number[]> = {};
    const loaded: string[] = [];
    const seen = new Map<string, string>();
    for (const [name, source] of sources) {
      const file = `assets/scripts/${name}.script.ts`;
      const r = await loadScript(file, source, t, importer, breakpoints[name] ?? []);
      for (const p of r.problems) problems.push({ script: name, line: p.line, message: p.message });
      if (r.unplaced.length > 0) unplaced[name] = r.unplaced;
      if (!r.loaded) continue;
      const display = r.loaded.def.name?.trim() || name;
      if (seen.has(display)) {
        problems.push({ script: name, line: 0, message: `Two scripts are both called "${display}" (${seen.get(display)} and ${name}). Give one a different name.` });
        continue;
      }
      seen.set(display, name);
      activate(r.loaded, { log: hooks.log, onBreak: (hit) => hooks.onBreak({ script: hit.script, line: hit.line, me: hit.me, game: hit.game }) });
      loaded.push(display);
    }
    return { problems, unplaced, loaded };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

// ---------- watch expressions ----------

const compiled = new Map<string, (me: ScriptEntity | undefined, game: ScriptGame | undefined) => unknown>();

/** Evaluate an expression with `me` and `game` in reach (the debugger's watch window). Returns text for display. */
export async function evaluateWatch(expression: string, me: ScriptEntity | undefined, game: ScriptGame | undefined): Promise<string> {
  const text = expression.trim();
  if (!text) return '';
  try {
    let fn = compiled.get(text);
    if (!fn) {
      const t = await getTranspiler();
      const out = t.transpile(`export default (me: any, game: any) => (${text});`, 'watch.ts');
      if (out.problems.length > 0) return `(${out.problems[0]!.message})`;
      const mod = await defaultImporter()(out.js);
      fn = mod.default as (me: ScriptEntity | undefined, game: ScriptGame | undefined) => unknown;
      compiled.set(text, fn);
    }
    const v = fn(me, game);
    if (v === undefined) return 'undefined';
    if (typeof v === 'object' && v !== null) {
      try {
        return JSON.stringify(v, (_k, x) => (typeof x === 'function' ? undefined : x), 1)?.slice(0, 400) ?? String(v);
      } catch {
        return String(v);
      }
    }
    return String(v);
  } catch (e) {
    return `(${e instanceof Error ? e.message : String(e)})`;
  }
}
