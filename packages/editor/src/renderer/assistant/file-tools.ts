import { PathProblem, SearchProblem, buildReferences, describeReferences, referenceNote, unusedAssets, type ProjectRefs, type TextFile, cleanRelative, filterFiles, findByName, formatSearch, searchText, textMatcher, secretReason, describeAudio, describeUnreadable, extOf, extractPdfText, fileKind, formatProjectIndex, limitText, looksLikeText, pdfFacts, pdfFitsAsDocument, type IndexedFile, type SearchHit, type ToolOutput } from '@tilewright/assistant';
import { unzlibSync } from 'fflate';
import { host } from '@tilewright/behaviors';
import { compositeFrame, encodePng, parseSprite } from '@tilewright/runtime';
import { store } from '../app/store';
import { api, joinPath } from '../project/api';
import { fail, json } from './tool-core';
import { PictureProblem, bytesToBase64, pictureForClaude } from './pictures';
import { browserRasterize } from './pictures-browser';
import { previewsFor } from './preview';
import { analyse, decodeWav, describeLevels, mp3Info, tagLoops, type FileInfo } from './audio';
import { decodeInBrowser } from './audio-browser';
import { tileTemplateText } from './image-tools';

/**
 * Claude reading the project's files. Every path Claude names is checked here (`cleanRelative`: nothing that leaves the
 * project folder) and again by the main process, which refuses links and streams too (`resolveInsideAny`).
 */

/** Folders that are not part of the project's content. */
const SKIPPED = new Set(['saves', '.tilewright', 'node_modules', '.git', 'release', 'dist', 'exports']);
/** What one read may hand back. */
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 3000;

const text = (t: string): ToolOutput => ({ content: t });

function projectDir(): string {
  const p = store.state.project;
  if (!p) return fail('No project is open.');
  return p.dir;
}

/** What the person added in Project settings to the built-in list of files the assistant may not read. */
const extraDeny = (): readonly string[] => store.state.project?.project.assistantDeny ?? [];

function cleanPath(rel: string): string {
  try {
    const clean = cleanRelative(rel);
    const secret = secretReason(clean, extraDeny());
    if (secret) throw new PathProblem(secret);
    return clean;
  } catch (e) {
    if (e instanceof PathProblem) return fail(e.message);
    throw e;
  }
}

const absolute = (rel: string): string => joinPath(projectDir(), ...cleanPath(rel).split('/'));

/** Every file of the project (skipping saves, exports and tool folders), with sizes. */
export async function listProjectFiles(dir?: string): Promise<IndexedFile[]> {
  const root = dir ?? projectDir();
  const deny = extraDeny();
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
      } else if (!secretReason(path, deny)) out.push({ path, size: e.size });
    }
  };
  await walk(root, '');
  return out;
}

const base64 = bytesToBase64;

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

/** The pictures a file can give, drawn from its data; null for a file with none or one that is not what its name says. */
function previewOf(path: string, whole: string): ReturnType<typeof previewsFor> {
  const p = store.state.project;
  if (!p) return null;
  try {
    return previewsFor(path, JSON.parse(whole), { tileset: p.project.tileset, iso: p.project.iso });
  } catch {
    return null; // not JSON, or not drawable: the text is still there
  }
}

/**
 * A sound as far as it can be measured and seen: its length (also for MP3), levels, clipping, silence at the ends, the loop points
 * stored in it and a picture of its waveform. Claude still cannot hear it, and is told so.
 */
async function readSound(path: string, bytes: Uint8Array): Promise<ToolOutput> {
  const ext = extOf(path);
  const wav = ext === '.wav' ? decodeWav(bytes) : null;
  if (wav) return soundOutput(analyse(path, wav.info, wav.decoded));
  const header = ext === '.mp3' ? mp3Info(bytes) : null;
  const info: FileInfo = header ?? { format: ext.slice(1).toUpperCase() || 'sound', loops: [], cues: [] };
  info.loops = [...info.loops, ...(ext === '.mp3' || ext === '.wav' ? [] : tagLoops(bytes))];
  try {
    const decoded = await decodeInBrowser(bytes);
    return soundOutput(analyse(path, { ...info, sampleRate: info.sampleRate ?? decoded.sampleRate, channels: info.channels ?? decoded.channels.length }, decoded));
  } catch {
    // it could not be decoded here: what the header says, or the plain details
    return text(header || info.loops.length > 0 ? describeLevels(path, info, null) : describeAudio(path, bytes));
  }
}

const soundOutput = (a: { text: string; png: Uint8Array }): ToolOutput => ({ content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64(a.png) } }, { type: 'text', text: a.text }] });

/** A PDF goes to the API whole when it fits, so Claude sees its pages as the person does; otherwise its text is pulled out. */
function readPdf(clean: string, bytes: Uint8Array): ToolOutput {
  const facts = pdfFacts(bytes);
  const size = `${(bytes.length / 1024 / 1024).toFixed(1)} MB`;
  const pages = facts.pages > 0 ? `${facts.pages} page${facts.pages === 1 ? '' : 's'}` : 'an unknown number of pages';
  if (!facts.isPdf) return text(`${clean}: its name says it is a PDF, but its contents are not a PDF file I can read.`);
  const why = pdfFitsAsDocument(facts, bytes.length);
  if (why === null) {
    return { content: [{ type: 'document', title: clean, source: { type: 'base64', media_type: 'application/pdf', data: base64(bytes) } }, { type: 'text', text: `${clean}: a PDF, ${pages}, ${size}. The pages are attached above.` }] };
  }
  if (facts.encrypted) return text(`${clean}: a PDF (${pages}, ${size}), but ${why}, so it cannot be read. Ask the user for an unlocked copy.`);
  const found = extractPdfText(bytes, unzlibSync);
  const head = `${clean}: a PDF, ${pages}, ${size}. I cannot attach it whole because ${why}.`;
  if (!found.readable) return text(`${head} Almost no text could be pulled out of it (it may be scanned pictures, or use fonts that hide their letters). Ask the user for a smaller part, or for the text.`);
  return text(`${head} This is the text that could be pulled out of it, without page breaks (some fonts lose their letters):\n\n${limitText(found.text)}`);
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
  if (kind === 'image' || ext === '.svg') {
    try {
      const pic = await pictureForClaude(clean, bytes, browserRasterize);
      // an SVG is a picture and text: its source comes with the drawn picture
      const source = ext === '.svg' ? `\n\nThe SVG source:\n${limitText(new TextDecoder().decode(bytes), 12_000)}` : '';
      return { content: [{ type: 'image', source: { type: 'base64', media_type: pic.mediaType, data: base64(pic.data) } }, { type: 'text', text: pic.facts + source }] };
    } catch (e) {
      if (e instanceof PictureProblem) return text(`${clean}: ${e.message}`);
      if (ext !== '.svg') return text(`${clean}: the picture could not be read (${e instanceof Error ? e.message : String(e)}).`);
      // an SVG that cannot be drawn is still text
    }
  }
  if (kind === 'document') return readPdf(clean, bytes);
  if (kind === 'audio') return readSound(clean, bytes);
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
    const body = `${part}${more ? `\n... (more: ${whole.length - from - part.length} characters; ask again with offset ${from + part.length})` : ''}`;
    // scenes, screens, conversations and tile sets come with a picture drawn from their data (on the first page only)
    const looks = from === 0 ? previewOf(clean, whole) : null;
    if (!looks) return text(body);
    const images = looks.pictures.map((p) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: base64(p.png) } }));
    const intro = `${clean}: ${looks.pictures.length === 1 ? 'a picture' : `${looks.pictures.length} pictures`} drawn from this file come first (${looks.pictures.map((p) => p.caption).join('; ')}). ${looks.notes.join(' ')}`;
    return { content: [...images, { type: 'text', text: `${intro}\n\nThe file itself:\n${body}` }] };
  }
  return text(describeUnreadable(clean, kind, bytes.length));
}

/** Text files searched at most this big, and this many of them: a search is quick, never a read of the whole project. */
const SEARCH_FILE_BYTES = 1_500_000;
const SEARCH_FILES = 800;

async function searchProject(input: Record<string, unknown>): Promise<ToolOutput> {
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const kind = typeof input.kind === 'string' && input.kind ? input.kind : undefined;
  const folder = typeof input.folder === 'string' ? input.folder : undefined;
  const where = input.where === 'names' || input.where === 'text' ? input.where : 'both';
  const limit = Math.min(100, Math.max(1, Number(input.limit ?? 40)));
  if (!query && !kind && !folder) return fail('Give a query, or a kind or folder to list.');
  let files: IndexedFile[];
  try {
    files = filterFiles(await listProjectFiles(), { kind, folder });
  } catch (e) {
    if (e instanceof SearchProblem) return fail(e.message);
    throw e;
  }
  const names = where === 'text' ? [] : findByName(files, query);
  const hits: SearchHit[] = [];
  let searched = 0;
  let skipped = 0;
  let cut = false;
  if (query && where !== 'names') {
    let match: (line: string) => number;
    try {
      match = textMatcher(query, { caseSensitive: input.caseSensitive === true, regex: input.regex === true });
    } catch (e) {
      if (e instanceof SearchProblem) return fail(e.message);
      throw e;
    }
    for (const f of files) {
      if (fileKind(f.path) !== 'text') continue;
      if (searched + skipped >= SEARCH_FILES) {
        cut = true;
        break;
      }
      if ((f.size ?? 0) > SEARCH_FILE_BYTES) {
        skipped++;
        continue;
      }
      let body: string;
      try {
        body = await api().fs.read(absolute(f.path));
      } catch {
        skipped++;
        continue;
      }
      searched++;
      hits.push(...searchText(f.path, body, match, limit - hits.length));
      if (hits.length >= limit) {
        cut = true;
        break;
      }
    }
  }
  return text(formatSearch({ query, names, hits, searched, skipped, cut, kind }, { names: 40, hits: limit }));
}

/** The references of the project, worked out from its text files (kept for a little while: the list of files and sizes is what says it is still current). */
let cachedRefs: { key: string; at: number; refs: ProjectRefs } | null = null;

export async function projectReferences(files: IndexedFile[]): Promise<ProjectRefs> {
  const key = `${projectDir()}|${files.map((f) => `${f.path}:${f.size ?? ''}`).join(',')}`;
  if (cachedRefs && cachedRefs.key === key && Date.now() - cachedRefs.at < 20_000) return cachedRefs.refs;
  const readable = files.filter((f) => /\.(json|ts|js)$/.test(f.path) && (f.size ?? 0) <= SEARCH_FILE_BYTES).slice(0, SEARCH_FILES);
  const texts: TextFile[] = [];
  for (let i = 0; i < readable.length; i += 16) {
    const batch = await Promise.all(
      readable.slice(i, i + 16).map(async (f) => {
        try {
          return { path: f.path, text: await api().fs.read(absolute(f.path)) };
        } catch {
          return null;
        }
      }),
    );
    for (const t of batch) if (t) texts.push(t);
  }
  const refs = { ...buildReferences(files, texts), skipped: files.filter((f) => /\.(json|ts|js)$/.test(f.path)).length - texts.length };
  cachedRefs = { key, at: Date.now(), refs };
  return refs;
}

/** The index of the project's files, with what uses what. Without the references (a project too big to read, a failure) it is the plain list. */
export async function projectIndexText(opts: { perGroup?: number } = {}): Promise<string> {
  const p = store.state.project;
  if (!p) return fail('No project is open.');
  const files = await listProjectFiles();
  try {
    const refs = await projectReferences(files);
    return formatProjectIndex(p.project.name, files, { ...opts, note: (path) => referenceNote(path, refs), unused: unusedAssets(files, refs) });
  } catch {
    return formatProjectIndex(p.project.name, files, opts);
  }
}

async function referencesTool(input: Record<string, unknown>): Promise<ToolOutput> {
  const files = await listProjectFiles();
  const refs = await projectReferences(files);
  const path = typeof input.path === 'string' && input.path ? cleanPath(input.path) : '';
  if (path) {
    if (!files.some((f) => f.path === path)) return fail(`There is no file "${path}". project_index and search_project show what exists.`);
    return text(describeReferences(path, refs));
  }
  const unused = unusedAssets(files, refs);
  const busiest = [...refs.usedBy].sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  const lines = [
    `References were read from ${refs.read} text files${refs.skipped > 0 ? ` (${refs.skipped} were too big or over the limit and are not counted)` : ''}.`,
    unused.length > 0
      ? `Nothing uses these ${unused.length} files (sprites, structures, tables, sounds, pictures):\n${unused.slice(0, 40).map((p) => `  ${p}`).join('\n')}${unused.length > 40 ? `\n  ... and ${unused.length - 40} more` : ''}`
      : 'Every sprite, structure, table, sound and picture is used by something.',
    busiest.length > 0 ? `Used by the most files:\n${busiest.map(([p, r]) => `  ${p}: ${r.length}`).join('\n')}` : '',
    'Ask with a path to see what one file uses and what uses it.',
  ];
  return text(lines.filter(Boolean).join('\n'));
}

/** The reading tools for files. Null when the name is not one of them. */
export async function runFileRead(name: string, input: Record<string, unknown>): Promise<ToolOutput | null> {
  switch (name) {
    case 'project_index':
      return text(await projectIndexText());
    case 'project_references':
      return referencesTool(input);
    case 'list_project_files': {
      const folder = typeof input.folder === 'string' ? input.folder.trim() : '';
      const dir = folder === '' || folder === '.' ? projectDir() : absolute(folder);
      let entries: { name: string; dir: boolean; size?: number }[];
      try {
        entries = await api().fs.list(dir);
      } catch {
        return fail(`There is no folder "${folder}". project_index shows what exists.`);
      }
      const above = folder === '' || folder === '.' ? '' : `${cleanPath(folder)}/`;
      const deny = extraDeny();
      const shown = entries.filter((e) => !(e.dir && SKIPPED.has(e.name)) && !secretReason(`${above}${e.name}`, deny)).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
      return text(shown.length === 0 ? '(empty)' : shown.map((e) => (e.dir ? `${e.name}/` : `${e.name}${e.size !== undefined ? ` (${e.size} bytes)` : ''}`)).join('\n'));
    }
    case 'search_project':
      return searchProject(input);
    case 'tile_template':
      return text(tileTemplateText(input));
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
