/**
 * Reading the files of a project for Claude: what kind a file is, how much of it fits, and what can honestly be said about
 * the kinds Claude cannot take in. Pure (bytes in, words out); the editor does the file access.
 */

export type FileKind = 'text' | 'image' | 'audio' | 'font' | 'archive' | 'document' | 'binary';

const TEXT_EXT = new Set(['.json', '.md', '.txt', '.csv', '.ts', '.js', '.mjs', '.cjs', '.css', '.html', '.svg', '.yaml', '.yml', '.xml', '.log', '.ini', '.tsv']);
const IMAGE_EXT: Record<string, ImageMime> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
/** Pictures the API cannot take as they are: they are turned into PNG first (an SVG is text as well, so it is read both ways). */
const CONVERTED_EXT = new Set(['.bmp', '.psd', '.aseprite', '.ase']);
const DOCUMENT_EXT = new Set(['.pdf']);
const AUDIO_EXT = new Set(['.wav', '.ogg', '.mp3', '.flac', '.m4a', '.aac', '.opus', '.mid', '.midi']);
const FONT_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const ARCHIVE_EXT = new Set(['.zip', '.twpack', '.gz', '.7z', '.rar']);

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export const extOf = (path: string): string => {
  const i = path.lastIndexOf('.');
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i > slash ? path.slice(i).toLowerCase() : '';
};

/** A picture file of any kind the assistant can look at: the API's own types, and those that are converted (BMP, PSD, Aseprite, SVG). */
export const isPictureFile = (path: string): boolean => fileKind(path) === 'image' || extOf(path) === '.svg';

export function fileKind(path: string): FileKind {
  const ext = extOf(path);
  if (TEXT_EXT.has(ext)) return 'text';
  if (ext in IMAGE_EXT || CONVERTED_EXT.has(ext)) return 'image';
  if (DOCUMENT_EXT.has(ext)) return 'document';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (FONT_EXT.has(ext)) return 'font';
  if (ARCHIVE_EXT.has(ext)) return 'archive';
  return 'binary';
}

/** The picture type a file really is, by its first bytes (a file named .png that is something else is not trusted). */
export function sniffImage(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

/** Width and height of a PNG, from its header (null when it is not one). */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (sniffImage(bytes) !== 'image/png' || bytes.length < 24) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** Does it read as text? (no NUL bytes, and almost everything printable once decoded) */
export function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096);
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i]!;
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) odd++;
  }
  return n === 0 || odd / n < 0.02;
}

const kb = (n: number): string => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * What can be said about a sound without hearing it. Claude cannot listen, so this says what the file is and how long it
 * is, and says plainly that nothing more is known: it never describes how a sound sounds.
 */
export function describeAudio(path: string, bytes: Uint8Array): string {
  const ext = extOf(path);
  const facts: string[] = [`${path}: a sound file (${ext.slice(1).toUpperCase() || 'unknown format'}), ${kb(bytes.length)}.`];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number, n: number): string => String.fromCharCode(...bytes.slice(o, o + n));
  if (bytes.length >= 44 && tag(0, 4) === 'RIFF' && tag(8, 4) === 'WAVE') {
    // walk the chunks for "fmt " and "data"
    let at = 12;
    let channels = 0;
    let rate = 0;
    let bits = 0;
    let dataBytes = 0;
    while (at + 8 <= bytes.length) {
      const id = tag(at, 4);
      const size = dv.getUint32(at + 4, true);
      if (id === 'fmt ' && at + 24 <= bytes.length) {
        channels = dv.getUint16(at + 10, true);
        rate = dv.getUint32(at + 12, true);
        bits = dv.getUint16(at + 22, true);
      } else if (id === 'data') {
        dataBytes = Math.min(size, bytes.length - at - 8);
        break;
      }
      at += 8 + size + (size % 2);
    }
    if (rate > 0 && channels > 0 && bits > 0 && dataBytes > 0) {
      const seconds = dataBytes / (rate * channels * (bits / 8));
      facts.push(`It lasts ${clock(seconds)} (${seconds.toFixed(2)} seconds), ${channels === 1 ? 'mono' : channels === 2 ? 'stereo' : `${channels} channels`}, ${rate} Hz, ${bits}-bit.`);
    }
  } else if (bytes.length >= 27 && tag(0, 4) === 'OggS') {
    // the last page's granule position is the number of samples; the sample rate is in the first (Vorbis or Opus) packet
    let rate = 0;
    if (bytes.length > 40 && tag(29, 6) === 'vorbis') rate = dv.getUint32(40, true);
    else if (bytes.length > 36 && tag(28, 8) === 'OpusHead') rate = 48000;
    let lastPage = -1;
    for (let i = bytes.length - 14; i >= 0 && i > bytes.length - 70_000; i--) {
      if (bytes[i] === 0x4f && bytes[i + 1] === 0x67 && bytes[i + 2] === 0x67 && bytes[i + 3] === 0x53) {
        lastPage = i;
        break;
      }
    }
    if (rate > 0 && lastPage >= 0) {
      const samples = Number(dv.getBigUint64(lastPage + 6, true));
      if (samples > 0 && samples < 2 ** 40) facts.push(`It lasts about ${clock(samples / rate)} (${(samples / rate).toFixed(1)} seconds).`);
    }
  } else if (ext === '.mp3') {
    facts.push('Its length is not worked out here.');
  }
  facts.push('I cannot listen to sound, so I cannot tell you what it sounds like, whether it fits the scene, or whether it is good. Only the file details above are known. If you describe it, I will take your word for it.');
  return facts.join(' ');
}

/** What to say about a file that cannot be read at all (a font, an archive, something unknown). */
export function describeUnreadable(path: string, kind: FileKind, size: number): string {
  const what = kind === 'font' ? 'a font file' : kind === 'archive' ? 'a packed file (an archive or an asset pack)' : 'a binary file I have no reader for';
  return `${path}: ${what}, ${kb(size)}. I cannot read its contents.`;
}

/** The index of a project's files, for the opening of a conversation and the project_index tool. */
export interface IndexedFile {
  path: string;
  size?: number | undefined;
}

/** The kinds a project's files are grouped in (the index, and the kind filter of search_project). */
const GROUPS: { id: string; label: string; test(path: string): boolean }[] = [
  { id: 'scenes', label: 'Scenes', test: (p) => p.endsWith('.scene.json') },
  { id: 'sprites', label: 'Sprites (pictures made in the sprite studio)', test: (p) => p.endsWith('.sprite.json') },
  { id: 'structures', label: 'Structures', test: (p) => p.endsWith('.structure.json') },
  { id: 'tables', label: 'Data tables', test: (p) => p.endsWith('.table.json') },
  { id: 'screens', label: 'Interface screens and layout', test: (p) => /(^|\/)(screens|ui)\.json$/.test(p) },
  { id: 'story', label: 'Story (conversations, cutscenes, lists of things, the world map)', test: (p) => /(^|\/)(dialogues|cutscenes|items|worldmap|minigames|skins)[^/]*\.json$/.test(p) || /(^|\/)(dialogues|cutscenes)\//.test(p) },
  { id: 'scripts', label: 'Scripts', test: (p) => /\.(ts|js)$/.test(p) },
  { id: 'sounds', label: 'Sounds (I cannot listen to these)', test: (p) => fileKind(p) === 'audio' },
  { id: 'images', label: 'Pictures (PNG, JPG, BMP, PSD, Aseprite, SVG...)', test: (p) => isPictureFile(p) },
  { id: 'documents', label: 'Documents (PDF)', test: (p) => fileKind(p) === 'document' },
  { id: 'languages', label: 'Translations', test: (p) => p.includes('localization/') },
  { id: 'notes', label: 'Notes and documents', test: (p) => fileKind(p) === 'text' && /\.(md|txt)$/.test(p) },
];

/** The id of the group a file belongs to ("scenes", "sprites", "sounds"...), or "other". */
export function groupIdOf(path: string): string {
  return GROUPS.find((g) => g.test(path))?.id ?? 'other';
}

/** Every group id, for a tool that filters by kind. */
export const GROUP_IDS: readonly string[] = [...GROUPS.map((g) => g.id), 'other'];

/**
 * A short, stable text that says what is in the project and where, so Claude can ask for what it wants with `read_project_file`.
 * Names are listed up to a limit per group (with the count when there are more), sorted, so the same project always gives
 * the same text (it sits in the cached start of the conversation).
 */
export function formatProjectIndex(projectName: string, files: readonly IndexedFile[], opts: { perGroup?: number } = {}): string {
  const limit = opts.perGroup ?? 25;
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const taken = new Set<string>();
  const lines: string[] = [`Files in "${projectName}" (${files.length} in all). Read any of them with read_project_file.`];
  for (const g of GROUPS) {
    const mine = sorted.filter((f) => !taken.has(f.path) && g.test(f.path));
    for (const f of mine) taken.add(f.path);
    if (mine.length === 0) continue;
    const shown = mine.slice(0, limit).map((f) => (f.size !== undefined ? `${f.path} (${kb(f.size)})` : f.path));
    lines.push(`${g.label}: ${mine.length}`, ...shown.map((s) => `  ${s}`), ...(mine.length > shown.length ? [`  ... and ${mine.length - shown.length} more (list_project_files shows a folder)`] : []));
  }
  const rest = sorted.filter((f) => !taken.has(f.path));
  if (rest.length > 0) {
    lines.push(`Other files: ${rest.length}`, ...rest.slice(0, limit).map((f) => `  ${f.path}`), ...(rest.length > limit ? [`  ... and ${rest.length - limit} more`] : []));
  }
  return lines.join('\n');
}
