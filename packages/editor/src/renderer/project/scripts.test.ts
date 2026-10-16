import { describe, expect, it } from 'vitest';
import type { AssetFs } from '../studio/assets';
import { SCRIPT_TEMPLATES, deleteScript, listScripts, loadScripts, saveScript, scriptPath } from './scripts';

function memoryFs(): AssetFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(f) {
      const v = files.get(f);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    async write(f, t) {
      files.set(f, t);
    },
    async writeBinary() {},
    async exists(f) {
      return files.has(f);
    },
    async remove(f) {
      files.delete(f);
    },
    async list(dir) {
      return [...files.keys()].filter((k) => k.startsWith(dir + '/')).map((k) => ({ name: k.slice(dir.length + 1), dir: false }));
    },
  };
}

describe('script files', () => {
  it('a project with no scripts folder simply has no scripts', async () => {
    const fs = memoryFs();
    expect(await listScripts(fs, '/p')).toEqual([]);
    expect((await loadScripts(fs, '/p')).scripts.size).toBe(0);
  });

  it('saves, lists, loads and deletes scripts under assets/scripts', async () => {
    const fs = memoryFs();
    await saveScript(fs, '/p', 'Spinner', 'export default defineScript({});');
    await saveScript(fs, '/p', 'Alarm', 'export default defineScript({});\n');
    expect(scriptPath('Spinner')).toBe('assets/scripts/Spinner.script.ts');
    expect([...fs.files.keys()].sort()).toEqual(['/p/assets/scripts/Alarm.script.ts', '/p/assets/scripts/Spinner.script.ts']);
    expect(fs.files.get('/p/assets/scripts/Spinner.script.ts')!.endsWith('\n')).toBe(true);
    expect(await listScripts(fs, '/p')).toEqual(['Alarm', 'Spinner']);
    expect((await loadScripts(fs, '/p')).scripts.get('Alarm')).toContain('defineScript');
    await deleteScript(fs, '/p', 'Alarm');
    expect(await listScripts(fs, '/p')).toEqual(['Spinner']);
  });

  it('refuses names that could not be a file name', async () => {
    await expect(saveScript(memoryFs(), '/p', '../evil', 'x')).rejects.toThrow();
    await expect(saveScript(memoryFs(), '/p', '', 'x')).rejects.toThrow();
  });

  it('every template names itself after the script', () => {
    for (const t of SCRIPT_TEMPLATES) expect(t.source('Wobbler')).toContain('"Wobbler"');
  });
});
