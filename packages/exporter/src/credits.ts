import { z } from 'zod';

/**
 * Credits for a game: the art and parts a project took from the library or the hub are written in `assets/library-links.json`
 * with who made them and under which licence. An export turns that into a CREDITS.txt beside the game, so attribution
 * (which CC-BY asks for) is never forgotten. The same list tells the exporter which licences limit how the game may be used.
 */

export const CreditSchema = z.object({
  name: z.string(),
  author: z.string().default(''),
  licence: z.string().default(''),
  /** Where it came from (a hub address and item), for people who want to find the original. */
  source: z.string().default(''),
});
export type Credit = z.infer<typeof CreditSchema>;

const LinksSchema = z.object({ links: z.array(CreditSchema.passthrough()).default([]) });

export const LICENCE_NAMES: Record<string, { label: string; url: string; credit: boolean; commercial: boolean }> = {
  'CC0-1.0': { label: 'CC0 1.0 (public domain)', url: 'https://creativecommons.org/publicdomain/zero/1.0/', credit: false, commercial: true },
  'CC-BY-4.0': { label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', credit: true, commercial: true },
  'CC-BY-NC-4.0': { label: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/', credit: true, commercial: false },
  'free-for-any-game': { label: 'free to use in any game', url: '', credit: false, commercial: true },
  custom: { label: "the author's own terms", url: '', credit: true, commercial: true },
};

/** The items a project uses that have an author, from the text of library-links.json. */
export function creditsOf(linksText: string | null): Credit[] {
  if (!linksText) return [];
  let json: unknown;
  try {
    json = JSON.parse(linksText);
  } catch {
    return [];
  }
  const r = LinksSchema.safeParse(json);
  if (!r.success) return [];
  return r.data.links.filter((c) => c.author.trim() !== '').map((c) => ({ name: c.name, author: c.author, licence: c.licence, source: c.source }));
}

/** The text of CREDITS.txt, or null when nothing needs one. */
export function buildCredits(gameName: string, credits: readonly Credit[]): string | null {
  if (credits.length === 0) return null;
  const lines: string[] = [`${gameName} - credits`, '', 'This game uses art and parts made by other people, shared with their licences:', ''];
  for (const c of credits) {
    const lic = LICENCE_NAMES[c.licence];
    lines.push(`- "${c.name}" by ${c.author} - ${lic?.label ?? (c.licence || 'licence not stated')}${c.source ? ` (from ${c.source})` : ''}`);
  }
  const used = [...new Set(credits.map((c) => c.licence))].filter((l) => LICENCE_NAMES[l]?.url);
  if (used.length > 0) {
    lines.push('', 'Licences:');
    for (const l of used) lines.push(`- ${LICENCE_NAMES[l]!.label}: ${LICENCE_NAMES[l]!.url}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Things to tell the person exporting: a licence that does not allow selling the game, or one that is not stated. */
export function creditProblems(credits: readonly Credit[]): { severity: 'warn'; text: string }[] {
  const out: { severity: 'warn'; text: string }[] = [];
  const nc = credits.filter((c) => LICENCE_NAMES[c.licence]?.commercial === false);
  if (nc.length > 0) out.push({ severity: 'warn', text: `${nc.map((c) => `"${c.name}" (${c.author})`).join(', ')} may not be used in a game that is sold (CC BY-NC). Keep the game free, or replace ${nc.length === 1 ? 'it' : 'them'}.` });
  const unknown = credits.filter((c) => !c.licence);
  if (unknown.length > 0) out.push({ severity: 'warn', text: `${unknown.map((c) => `"${c.name}"`).join(', ')} came with no licence. Ask ${unknown.length === 1 ? 'its' : 'their'} author what you may do with ${unknown.length === 1 ? 'it' : 'them'} before you share the game.` });
  return out;
}
