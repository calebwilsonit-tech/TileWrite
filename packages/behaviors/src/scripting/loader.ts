import type { ScriptDef } from './api';
import { registerScript, running, type ScriptHooks } from './script';

/** A problem found while turning a script's text into something that runs. */
export interface ScriptProblem {
  /** 1-based line in the author's source (0 if unknown). */
  line: number;
  message: string;
}

/** Something that can turn TypeScript into JavaScript (the editor and the exporter supply one built on the `typescript` package). */
export interface Transpiler {
  transpile(source: string, fileName: string): { js: string; map?: string; problems: ScriptProblem[] };
}

/** Wraps the `typescript` module (passed in, so this package does not depend on it). */
export function tsTranspiler(ts: {
  transpileModule(source: string, options: Record<string, unknown>): { outputText: string; sourceMapText?: string; diagnostics?: readonly { start?: number; messageText: unknown; file?: { text: string } }[] };
  ScriptTarget: Record<string, number>;
  ModuleKind: Record<string, number>;
  flattenDiagnosticMessageText?(m: unknown, nl: string): string;
}): Transpiler {
  return {
    transpile(source, fileName) {
      const out = ts.transpileModule(source, {
        fileName,
        reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: true, inlineSources: false, removeComments: false },
      });
      const problems: ScriptProblem[] = (out.diagnostics ?? []).map((d) => {
        const before = d.start !== undefined && d.file ? d.file.text.slice(0, d.start) : '';
        const line = d.start !== undefined ? before.split('\n').length : 0;
        const message = ts.flattenDiagnosticMessageText ? ts.flattenDiagnosticMessageText(d.messageText, '\n') : String(d.messageText);
        return { line, message };
      });
      return { js: out.outputText.replace(/\/\/# sourceMappingURL=.*$/m, ''), map: out.sourceMapText, problems };
    },
  };
}

// ---------- source maps (so errors point at the author's lines) ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** For each line of generated code (index 0 = line 1), the line in the original source (1-based), or 0. */
export function lineMapOf(mapText: string | undefined): number[] {
  if (!mapText) return [];
  let map: { mappings?: string };
  try {
    map = JSON.parse(mapText) as { mappings?: string };
  } catch {
    return [];
  }
  const out: number[] = [];
  let srcLine = 0;
  for (const line of (map.mappings ?? '').split(';')) {
    let first = 0;
    if (line !== '') {
      const seg = line.split(',')[0]!;
      const nums: number[] = [];
      let shift = 0;
      let value = 0;
      for (const ch of seg) {
        const d = B64.indexOf(ch);
        value += (d & 31) << shift;
        if (d & 32) shift += 5;
        else {
          nums.push(value & 1 ? -(value >> 1) : value >> 1);
          value = 0;
          shift = 0;
        }
      }
      if (nums.length >= 3) {
        srcLine += nums[2]!;
        first = srcLine + 1;
      }
    }
    out.push(first);
  }
  return out;
}

// ---------- breakpoints ----------

const BP_NAME = '__bp';

/** Put a breakpoint call at the start of each chosen line (the line count stays the same). */
export function instrument(source: string, lines: readonly number[]): string {
  const want = new Set(lines);
  return source
    .split('\n')
    .map((text, i) => (want.has(i + 1) ? text.replace(/^(\s*)/, `$1${BP_NAME}(${i + 1}); `) : text))
    .join('\n');
}

// ---------- loading ----------

export type Importer = (moduleText: string) => Promise<{ default?: unknown }>;

/** Imports JavaScript text as a module: a blob in the editor, a data URL elsewhere. */
export function defaultImporter(): Importer {
  if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    return async (text) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
      try {
        return await import(/* @vite-ignore */ url);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
  }
  return (text) => import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(text, 'utf8').toString('base64')}`);
}

function prelude(file: string): string {
  return `const defineScript = (d) => d; const console = globalThis.__twConsole ?? globalThis.console; const ${BP_NAME} = (l) => globalThis.__twBreak?.(${JSON.stringify(file)}, l);\n`;
}

export interface LoadedScript {
  file: string;
  def: ScriptDef;
  /** Generated line -> author's line. */
  lines: number[];
}

export interface LoadResult {
  loaded?: LoadedScript;
  problems: ScriptProblem[];
  /** Breakpoint lines that could not be placed (the line is not the start of a statement). */
  unplaced: number[];
}

/** Compile and load one script. Never throws: problems are returned in plain English. */
export async function loadScript(file: string, source: string, transpiler: Transpiler, importer: Importer, breakpoints: readonly number[] = []): Promise<LoadResult> {
  const base = transpiler.transpile(source, file);
  if (base.problems.length > 0) return { problems: base.problems, unplaced: [] };
  let use = base;
  const unplaced: number[] = [];
  if (breakpoints.length > 0) {
    const ok = breakpoints.filter((l) => transpiler.transpile(instrument(source, [l]), file).problems.length === 0);
    unplaced.push(...breakpoints.filter((l) => !ok.includes(l)));
    if (ok.length > 0) {
      const t = transpiler.transpile(instrument(source, ok), file);
      if (t.problems.length === 0) use = t;
      else unplaced.push(...ok);
    }
  }
  try {
    const mod = await importer(prelude(file) + use.js);
    const def = mod.default as ScriptDef | undefined;
    if (!def || typeof def !== 'object') {
      return { problems: [{ line: 0, message: 'A script must end with `export default defineScript({ ... })`.' }], unplaced };
    }
    return { loaded: { file, def, lines: lineMapOf(use.map) }, problems: [], unplaced };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const m = /:(\d+):\d+/.exec(err.stack ?? '');
    const lines = lineMapOf(use.map);
    const raw = m ? Number(m[1]) - 1 : 0; // the prelude is one line
    return { problems: [{ line: raw > 0 ? (lines[raw - 1] ?? 0) : 0, message: `The script could not start: ${err.message}` }], unplaced };
  }
}

/** The messages scripts print and the breakpoints they hit go to these hooks. Call once when the game starts. */
export function installScriptGlobals(hooks: ScriptHooks): void {
  const say = (kind: 'log' | 'warn' | 'error') => (...args: unknown[]): void => hooks.log(kind, args.map((a) => (typeof a === 'string' ? a : safe(a))).join(' '));
  const g = globalThis as Record<string, unknown>;
  g.__twConsole = { log: say('log'), info: say('log'), debug: say('log'), warn: say('warn'), error: say('error') };
  g.__twBreak = (file: string, line: number): void => breakpointHit(file, line);
}

function safe(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function breakpointHit(file: string, line: number): void {
  const cur = running.current;
  if (cur && cur.file === file) cur.hooks.onBreak?.({ script: cur.script, file, line, me: cur.me, game: cur.game });
}

/** Register a loaded script as a behaviour; its errors and breakpoints are mapped back to the author's lines. */
export function activate(loaded: LoadedScript, hooks: ScriptHooks): ReturnType<typeof registerScript> {
  return registerScript(loaded.file, loaded.def, { ...hooks, mapLine: (file, line) => loaded.lines[line - 2] ?? line });
}
