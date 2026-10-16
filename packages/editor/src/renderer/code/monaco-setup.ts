import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import apiSource from '@tilewright/behaviors/src/scripting/api.ts?raw';

/** Declarations for the scripting API, as global (ambient) types so scripts need no imports. */
export function engineTypes(): string {
  const body = apiSource.replace(/^export /gm, '');
  return `${body}\n/** Describe a script: its settings, signals, and what it does each update. Use as \`export default defineScript({ ... })\`. */\ndeclare function defineScript(def: ScriptDef): ScriptDef;\n/** Messages written here appear in the editor's Console. */\ndeclare const console: { log(...v: unknown[]): void; info(...v: unknown[]): void; warn(...v: unknown[]): void; error(...v: unknown[]): void };\n`;
}

let ready = false;

/** Set up Monaco once: its background workers, the TypeScript options, and the engine's API types. */
export function setupMonaco(): typeof monaco {
  if (ready) return monaco;
  ready = true;
  (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
    getWorker(_id: string, label: string): Worker {
      return label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker();
    },
  };
  const ts = monaco.typescript.typescriptDefaults;
  ts.setCompilerOptions({
    target: monaco.typescript.ScriptTarget.ESNext,
    module: monaco.typescript.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
    allowNonTsExtensions: true,
    lib: ['es2022'],
  });
  ts.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  ts.addExtraLib(engineTypes(), 'file:///tilewright/api.d.ts');
  (window as unknown as { __monaco: unknown }).__monaco = monaco; // for the end-to-end tests
  monaco.editor.defineTheme('tilewright-dark', { base: 'vs-dark', inherit: true, rules: [], colors: {} });
  return monaco;
}

export type Monaco = typeof monaco;
