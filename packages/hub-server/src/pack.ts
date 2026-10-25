import { z } from 'zod';

/**
 * What the hub accepts as an asset pack. This is the same file the editor's personal library keeps (format "tilewright-pack");
 * the hub checks the shape and the safety of it, not what the tiles mean.
 */

export const PACK_FORMAT = 'tilewright-pack';
export const PACK_KINDS = ['tile', 'tileset', 'prop', 'attachment', 'character', 'animation', 'ui', 'structure', 'behaviour', 'sound', 'template', 'plugin'] as const;

/** Licences an item can be shared under. "custom" means the author explains it in the description. */
export const LICENCES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-NC-4.0', 'free-for-any-game', 'custom'] as const;
export type Licence = (typeof LICENCES)[number];

export const LICENCE_LABELS: Record<Licence, string> = {
  'CC0-1.0': 'CC0 (public domain)',
  'CC-BY-4.0': 'CC-BY 4.0 (credit the author)',
  'CC-BY-NC-4.0': 'CC-BY-NC 4.0 (credit the author, not for sale)',
  'free-for-any-game': 'Free to use in any game',
  custom: 'Custom (read the description)',
};

export const LIMITS = {
  /** The whole pack as JSON text. */
  packBytes: 8 * 1024 * 1024,
  files: 400,
  /** Code in a pack is kept small so a person can read it before trusting it. */
  codeBytes: 256 * 1024,
  name: 60,
  description: 2000,
  tags: 12,
};

const PackFileSchema = z.object({ path: z.string().min(1).max(260), encoding: z.enum(['utf8', 'base64']), data: z.string() });

export const IncomingPackSchema = z
  .object({
    format: z.literal(PACK_FORMAT),
    formatVersion: z.number().int().min(1),
    name: z.string().min(1).max(LIMITS.name),
    kind: z.enum(PACK_KINDS),
    description: z.string().max(LIMITS.description).default(''),
    author: z.string().default(''),
    licence: z.string().default(''),
    tags: z.array(z.string().max(30)).max(LIMITS.tags).default([]),
    createdAt: z.string().default(''),
    tileSize: z.object({ w: z.number(), h: z.number() }).optional(),
    files: z.array(PackFileSchema).max(LIMITS.files).default([]),
    tiles: z.array(z.unknown()).default([]),
    autotile: z.array(z.unknown()).default([]),
    uiPrefabs: z.array(z.unknown()).default([]),
    code: z.boolean().default(false),
  })
  .passthrough();
export type IncomingPack = z.infer<typeof IncomingPackSchema>;

const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|html|htm|wasm|sh|bat|cmd|ps1|exe|dll)$/i;

export interface PackCheck {
  ok: boolean;
  /** Plain-English reasons it was refused. */
  problems: string[];
  pack?: IncomingPack;
  /** The pack has code (it says so, or has files that are code). */
  hasCode: boolean;
  codeBytes: number;
}

/** Check a pack before the hub keeps it. */
export function checkIncomingPack(json: unknown, size: number): PackCheck {
  const problems: string[] = [];
  if (size > LIMITS.packBytes) return { ok: false, problems: [`The pack is ${(size / 1048576).toFixed(1)} MB; the hub keeps packs up to ${LIMITS.packBytes / 1048576} MB.`], hasCode: false, codeBytes: 0 };
  const r = IncomingPackSchema.safeParse(json);
  if (!r.success) return { ok: false, problems: [`This is not a valid asset pack: ${r.error.issues[0]?.path.join('.') ?? ''} ${r.error.issues[0]?.message ?? ''}`.trim()], hasCode: false, codeBytes: 0 };
  const pack = r.data;
  const seen = new Set<string>();
  let codeBytes = 0;
  let codeFiles = 0;
  for (const f of pack.files) {
    if (f.path.startsWith('/') || f.path.includes('..') || f.path.includes('\\') || !f.path.startsWith('assets/')) problems.push(`The file "${f.path}" is outside the assets folder.`);
    if (seen.has(f.path)) problems.push(`The file "${f.path}" is in the pack twice.`);
    seen.add(f.path);
    if (CODE_FILE.test(f.path)) {
      codeFiles++;
      codeBytes += f.data.length;
    }
  }
  const hasCode = pack.code || codeFiles > 0;
  if (codeFiles > 0 && !pack.code) problems.push('The pack has code files but does not say it contains code.');
  if (hasCode && codeBytes > LIMITS.codeBytes) problems.push(`The code in the pack is ${Math.round(codeBytes / 1024)} KB; the hub allows ${LIMITS.codeBytes / 1024} KB of code per pack.`);
  if (!(LICENCES as readonly string[]).includes(pack.licence)) problems.push(`Choose a licence: ${LICENCES.join(', ')}.`);
  return { ok: problems.length === 0, problems, pack, hasCode, codeBytes };
}
