import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOT } from './corpus';

const API_FILE = path.join(ROOT, 'packages', 'behaviors', 'src', 'scripting', 'api.ts');

/** The scripting API as the Code window gives it to scripts: global types, `defineScript` and `console`. */
export function engineTypes(): string {
  const body = fs.readFileSync(API_FILE, 'utf8').replace(/^export /gm, '');
  return `${body}\ndeclare function defineScript(def: ScriptDef): ScriptDef;\ndeclare const console: { log(...v: unknown[]): void; info(...v: unknown[]): void; warn(...v: unknown[]): void; error(...v: unknown[]): void };\n`;
}

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  strict: true,
  noEmit: true,
  allowNonTsExtensions: true,
  lib: ['lib.es2022.d.ts'],
  types: [],
  skipLibCheck: true,
};

/**
 * Type-check scripts exactly as the Code window does (strict, ES2022, the engine's API as ambient types).
 * Returns the problems per script, as "line N: message".
 */
export function typecheckScripts(scripts: ReadonlyMap<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (scripts.size === 0) return out;
  const files = new Map<string, string>([['/tilewright/api.d.ts', engineTypes()]]);
  for (const [name, source] of scripts) files.set(`/scripts/${name}.script.ts`, source);
  const base = ts.createCompilerHost(OPTIONS, true);
  const host: ts.CompilerHost = {
    ...base,
    getSourceFile: (f, lang, onError) => {
      const text = files.get(f.replace(/\\/g, '/'));
      return text !== undefined ? ts.createSourceFile(f, text, lang, true) : base.getSourceFile(f, lang, onError);
    },
    fileExists: (f) => files.has(f.replace(/\\/g, '/')) || base.fileExists(f),
    readFile: (f) => files.get(f.replace(/\\/g, '/')) ?? base.readFile(f),
  };
  const roots = [...files.keys()];
  const program = ts.createProgram(roots, OPTIONS, host);
  for (const name of [...scripts.keys()].sort((a, b) => a.localeCompare(b))) {
    const sf = program.getSourceFile(`/scripts/${name}.script.ts`);
    if (!sf) continue;
    const diags = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
    out[name] = diags.map((d) => {
      const line = d.start !== undefined ? sf.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
      return `line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    });
  }
  return out;
}

/** Every name the scripting API offers: `Interface.member` for each interface, plus the type names themselves. */
export function apiSurface(): string[] {
  const sf = ts.createSourceFile('api.ts', fs.readFileSync(API_FILE, 'utf8'), ts.ScriptTarget.ESNext, true);
  const names: string[] = [];
  sf.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node)) {
      names.push(node.name.text);
      for (const m of node.members) {
        const n = m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : '';
        if (n) names.push(`${node.name.text}.${n}`);
      }
    } else if (ts.isTypeAliasDeclaration(node)) names.push(node.name.text);
  });
  return names.sort();
}
