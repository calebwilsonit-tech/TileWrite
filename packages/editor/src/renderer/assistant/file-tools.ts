import { PathProblem, cleanRelative, describeAudio, describeUnreadable, extOf, fileKind, formatProjectIndex, limitText, looksLikeText, sniffImage, type IndexedFile, type ToolOutput } from '@tilewright/assistant';
import { host } from '@tilewright/behaviors';
import { compositeFrame, encodePng, parseSprite } from '@tilewright/runtime';
import { store } from '../app/store';
import { api, joinPath } from '../project/api';
import { fail, json } from './tool-core';

/**
 * Claude reading the project's files. Every path Claude names is checked here (`cleanRelative`: nothing that leaves the
 * project folder) and again by the main process, which refuses links and streams too (`resolveInsideAny`).
 */

/** Folders that are not part of the project's content. */
const SKIPPED = new Set(['saves', '.tilewright', 'node_modules', '.git', 'release', 'dist', 'exports']);
/** What one read may hand back. */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3_500_000;
const MAX_FILES = 3000;

const text = (t: string): ToolOutput => ({ content: t });

function projectDir(): string {
  const p = store.state.project;
  if (!p) return fail('No project is open.');
  return p.dir;
}

function cleanPath(rel: string): string {
  try {
    return cleanRelative(rel);
  } catch (e) {
    if (e instanceof PathProblem) return fail(e.message);
    throw e;
  }
}

const absolute = (rel: string): string => joinPath(projectDir(), ...cleanPath(rel).split('/'));

/** Every file of the project (skipping saves, exports and tool folders), with sizes. */
export async function listProjectFiles(dir?: string): Promise<IndexedFile[]> {
  const root = dir ?? projectDir();
  const out: IndexedFile[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    if (out.length >= MAX_FILES) return;
    let entries: { name: string; dir: boolean; size?: number }[];
    try {
      entries = await api().fs.list(dir);
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES) return;
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.dir) {
        if (!SKIPPED.has(e.name)) await walk(joinPath(dir, e.name), path);
      } else out.push({ path, size: e.size });
    }
  };
  await walk(root, '');
  return out;
}

const base64 = (bytes: Uint8Array): string => {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
};

/** A sprite file as words (size, layers, frames, animations) and a picture of its first frame. */
function describeSprite(path: string, raw: string): ToolOutput {
  const parsed = parseSprite(JSON.parse(raw));
  if (!parsed.ok) return { isError: false, content: `${path}: ${parsed.error}\n\n${limitText(raw, 4000)}` };
  const s = parsed.value;
  const lines = [
    `${path}: a sprite "${s.name}", ${s.width} x ${s.height} pixels, ${s.frames.length} frame${s.frames.length === 1 ? '' : 's'}, ${s.layers.length} layer${s.layers.length === 1 ? '' : 's'} (${s.layers.map((l) => l.name).join(', ')}), ${s.palette.length - 1} colours.`,
    s.clips.length > 0 ? `Animations: ${s.clips.map((c) => `${c.name} (${c.all.length || Object.values(c.dirs)[0]?.length || 0} frames)`).join(', ')}.` : 'No animations.',
    s.meta && s.meta.kind !== 'sprite' ? `It is a ${s.meta.kind} (${s.meta.preset || 'no preset'}), ${s.meta.heightCells} cells tall.` : '',
    'The picture is its first frame, enlarged.',
  ].filter(Boolean);
  // small sprites are shown bigger so the pixels can be seen
  const scale = Math.max(1, Math.min(8, Math.floor(256 / Math.max(s.width, s.height))));
  const rgba = compositeFrame(s, 0);
  const big = new Uint8ClampedArray(s.width * scale * s.height * scale * 4);
  for (let y = 0; y < s.height * scale; y++) {
    for (let x = 0; x < s.width * scale; x++) {
      const from = (Math.floor(y / scale) * s.width + Math.floor(x / scale)) * 4;
      big.set(rgba.subarray(from, from + 4), (y * s.width * scale + x) * 4);
    }
  }
  const png = encodePng(s.width * scale, s.height * scale, big);
  return { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64(png) } }, { type: 'text', text: lines.join('\n') }] };
}

async function readProjectFile(rel: string, offset: number): Promise<ToolOutput> {
  const clean = cleanPath(rel);
  const file = absolute(clean);
  let bytes: Uint8Array;
  try {
    bytes = await api().fs.readBinary(file);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/ENOENT|no such file/i.test(message)) return fail(`There is no file "${clean}". project_index and list_project_files show what exists.`);
    if (/EISDIR/i.test(message)) return fail(`"${clean}" is a folder. list_project_files shows what is inside it.`);
    if (/outside|link|chose/i.test(message)) return fail(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    return fail(`"${clean}" could not be read: ${message}`);
  }
  if (bytes.length > MAX_BYTES) return text(describeUnreadable(clean, 'binary', bytes.length).replace('a binary file I have no reader for', `too big to read here (the limit is ${MAX_BYTES / 1024 / 1024} MB)`));

  // a plugin that knows this kind of file explains it
  const ext = extOf(clean);
  for (const reader of host.ext.fileReaders.values()) {
    if (!reader.extensions.includes(ext)) continue;
    const read = await reader.read(clean, bytes);
    const images = (read.images ?? []).slice(0, 4).map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: base64(i.png) } }));
    return { content: [...images, { type: 'text', text: limitText(read.text) }] };
  }

  const kind = fileKind(clean);
  if (kind === 'image') {
    const mime = sniffImage(bytes);
    if (!mime) return text(`${clean}: its name says it is a picture, but its contents are not a picture file I can read.`);
    if (bytes.length > MAX_IMAGE_BYTES) return text(`${clean}: a picture of ${(bytes.length / 1024 / 1024).toFixed(1)} MB, which is too big to look at (the limit is ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(1)} MB). Ask the user for a smaller copy.`);
    return { content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: base64(bytes) } }, { type: 'text', text: `${clean} (${bytes.length} bytes)` }] };
  }
  if (kind === 'audio') return text(describeAudio(clean, bytes));
  if (kind === 'text' || (kind === 'binary' && looksLikeText(bytes))) {
    const whole = new TextDecoder().decode(bytes);
    if (clean.endsWith('.sprite.json')) {
      try {
        return describeSprite(clean, whole);
      } catch {
        /* not JSON: show it as text below */
      }
    }
    const from = Math.min(offset, whole.length);
    const part = whole.slice(from, from + 40_000);
    const more = from + part.length < whole.length;
    return text(`${part}${more ? `\n... (more: ${whole.length - from - part.length} characters; ask again with offset ${from + part.length})` : ''}`);
  }
  return text(describeUnreadable(clean, kind, bytes.length));
}

/** The reading tools for files. Null when the name is not one of them. */
export async function runFileRead(name: string, input: Record<string, unknown>): Promise<ToolOutput | null> {
  switch (name) {
    case 'project_index': {
      const p = store.state.project;
      if (!p) return fail('No project is open.');
      return text(formatProjectIndex(p.project.name, await listProjectFiles()));
    }
    case 'list_project_files': {
      const folder = typeof input.folder === 'string' ? input.folder.trim() : '';
      const dir = folder === '' || folder === '.' ? projectDir() : absolute(folder);
      let entries: { name: string; dir: boolean; size?: number }[];
      try {
        entries = await api().fs.list(dir);
      } catch {
        return fail(`There is no folder "${folder}". project_index shows what exists.`);
      }
      const shown = entries.filter((e) => !(e.dir && SKIPPED.has(e.name))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      return text(shown.length === 0 ? '(empty)' : shown.map((e) => (e.dir ? `${e.name}/` : `${e.name}${e.size !== undefined ? ` (${e.size} bytes)` : ''}`)).join('\n'));
    }
    case 'read_project_file':
      return readProjectFile(String(input.path ?? ''), Number(input.offset ?? 0));
    case 'list_image_providers': {
      const list = [...host.ext.imageProviders.values()];
      if (list.length === 0) return text('No plugin adds a way to make pictures from words, so generate_image is not available. You can still draw small pictures yourself with draw_sprite, and read pictures the user attaches.');
      return text(json(list.map((p) => ({ id: p.id, name: p.label, needsKey: p.needsKey, plugin: p.plugin }))));
    }
    default:
      return null;
  }
}
