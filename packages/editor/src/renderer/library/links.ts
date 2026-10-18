import { z } from 'zod';
import type { LibraryItem } from './store';

/**
 * What a project took from the library, remembered in assets/library-links.json.
 *  - "link": the project follows the library item; "Update" brings in a newer version.
 *  - "copy": the project owns the pieces from then on; nothing is remembered about updates.
 */
export const LINKS_FILE = 'assets/library-links.json';

export const LinkSchema = z.object({
  itemId: z.string(),
  name: z.string(),
  mode: z.enum(['link', 'copy']),
  /** The library version that was brought in. */
  version: z.number().int(),
  files: z.array(z.string()).default([]),
  tiles: z.array(z.string()).default([]),
  prefabs: z.array(z.string()).default([]),
  installedAt: z.string().default(''),
  /** Who made it, under which licence, and where it came from (for credits when a game is exported). */
  author: z.string().default(''),
  licence: z.string().default(''),
  source: z.string().default(''),
});
export type Link = z.infer<typeof LinkSchema>;

export const LinksFileSchema = z.object({ links: z.array(LinkSchema).default([]) });
export type LinksFile = z.infer<typeof LinksFileSchema>;

export const emptyLinks = (): LinksFile => ({ links: [] });

export function parseLinks(text: string): LinksFile {
  try {
    const r = LinksFileSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : emptyLinks();
  } catch {
    return emptyLinks();
  }
}

/** Remember an install; adding the same item again replaces its record. */
export function recordInstall(file: LinksFile, link: Link): LinksFile {
  return { links: [...file.links.filter((l) => l.itemId !== link.itemId), link] };
}

/** Linked items whose library item has a newer current version, or has been removed from the library. */
export function updatesAvailable(file: LinksFile, items: readonly LibraryItem[]): { link: Link; current: number | null }[] {
  const out: { link: Link; current: number | null }[] = [];
  for (const link of file.links) {
    if (link.mode !== 'link') continue;
    const item = items.find((i) => i.id === link.itemId);
    if (!item) out.push({ link, current: null });
    else if (item.current !== link.version) out.push({ link, current: item.current });
  }
  return out;
}

/** Break a link: the project keeps the pieces and owns them. */
export function unlink(file: LinksFile, itemId: string): LinksFile {
  return { links: file.links.map((l) => (l.itemId === itemId ? { ...l, mode: 'copy' as const } : l)) };
}
