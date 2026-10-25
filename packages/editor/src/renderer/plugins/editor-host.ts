import { host, type EditorHost } from '@tilewright/behaviors';
import { store } from '../app/store';
import { assetFs } from '../project/assetFs';
import { api, joinPath } from '../project/api';

/** A path inside the project folder: relative, no ".." and no drive. */
function inside(dir: string, rel: string): string {
  const parts = rel.split(/[\\/]/).filter((p) => p !== '' && p !== '.');
  if (rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel) || parts.includes('..') || parts.length === 0) throw new Error(`"${rel}" is not a place inside the project folder.`);
  return joinPath(dir, ...parts);
}

/** What the editor really does when a plugin asks (the plugin host checks the plugin's permissions before any of this is reached). */
export function createEditorHost(): EditorHost {
  const dir = (): string => {
    const p = store.state.project;
    if (!p) throw new Error('There is no project open.');
    return p.dir;
  };
  return {
    notify: (kind, text) => store.notify(kind, text),
    project: () => {
      const p = store.state.project;
      return p ? { name: p.project.name, dir: p.dir } : null;
    },
    entities: () => (store.doc?.entities ?? []).map((e) => ({ id: e.id, name: e.name, tags: [...e.tags], components: structuredClone(e.components) })),
    readFile: (rel) => assetFs.read(inside(dir(), rel)),
    writeFile: (rel, text) => assetFs.write(inside(dir(), rel), text),
    clipboard: { read: () => navigator.clipboard.readText(), write: (text) => navigator.clipboard.writeText(text) },
    runProgram: (command, args, plugin) => api().plugins.runProgram(plugin ?? '', command, args),
  };
}

/** Called once when the editor starts. */
export function connectPluginHost(): void {
  host.editorHost = createEditorHost();
}
