import { z } from 'zod';
import { isRange, isVersion, satisfies } from './semver';

/**
 * What a plugin says about itself (`plugin.json`). The host reads it before it loads any of the plugin's code, so a person can
 * see what a plugin is, what it wants to do and what it needs before deciding to install it.
 */

/** The version of the plugin platform: what plugins are written against. Breaking changes only in a new major version. */
export const ENGINE_VERSION = '1.0.0';

/** Things a plugin may ask to be allowed to do. The person who installs it sees them and can say no. */
export const PERMISSIONS = {
  'project.read': 'Read the files of the project that is open',
  'project.write': 'Change and make files in the project that is open',
  network: 'Talk to other computers over the internet (only the hosts it names)',
  clipboard: 'Read and write the clipboard',
  programs: 'Run other programs on this computer (off by default: a plugin that does this can do anything you can)',
} as const;
export type PermissionName = keyof typeof PERMISSIONS;

/** The one that always needs a warning. */
export const DANGEROUS: readonly PermissionName[] = ['programs'];

const PermissionText = z.string().refine((p) => p in PERMISSIONS || /^network:[a-z0-9.-]+(:\d+)?$/i.test(p), {
  message: 'A permission is one of project.read, project.write, network, clipboard, programs, or network:<host name>',
});

const Id = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/, 'A plugin id uses lower-case letters, numbers and - _ . (it starts with a letter)')
  .max(64);

const VersionText = z.string().refine(isVersion, { message: 'A version looks like 1.2.3' });
const RangeText = z.string().refine(isRange, { message: 'A version range looks like ^1.2.0, ~1.2.3, >=1.0.0 <2.0.0 or 1.x' });

export const PluginManifestSchema = z.object({
  id: Id,
  name: z.string().min(1).max(80),
  version: VersionText,
  description: z.string().max(500).default(''),
  author: z.string().max(120).default(''),
  license: z.string().max(60).default(''),
  homepage: z.string().max(300).default(''),
  /** The plugin platform versions it works with. */
  engine: RangeText.default('^1.0.0'),
  /** Other plugins that must be on first, and the versions of them it works with. */
  dependencies: z.record(Id, RangeText).default({}),
  permissions: z.array(PermissionText).default([]),
  /** Files, relative to the plugin's folder: the game part (runs in the game and in Play) and the editor part (never exported). */
  entry: z
    .object({
      runtime: z.string().max(200).optional(),
      editor: z.string().max(200).optional(),
    })
    .default({}),
  /** Text file shown when the plugin is updated ("what changed"). */
  changelog: z.string().max(200).default(''),
  /** Folder of art, sounds, screens, templates and pages the plugin brings (copied into a game that uses them). */
  assets: z.string().max(200).default(''),
  /** True for the plugins that ship with the editor. */
  builtin: z.boolean().default(false),
  /** True for a plugin every project has on (a project cannot turn it off): the screens a game cannot run without. */
  essential: z.boolean().default(false),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export type ManifestResult = { ok: true; manifest: PluginManifest } | { ok: false; problems: string[] };

/** Read a `plugin.json`: the manifest, or what is wrong with it in plain English. */
export function parseManifest(json: unknown): ManifestResult {
  const r = PluginManifestSchema.safeParse(json);
  if (r.success) return { ok: true, manifest: r.data };
  return { ok: false, problems: r.error.issues.map((i) => `${i.path.length > 0 ? `${i.path.join('.')}: ` : ''}${i.message}`) };
}

/** Does this plugin work with this version of the plugin platform? */
export function worksWithEngine(m: Pick<PluginManifest, 'engine'>, engine = ENGINE_VERSION): boolean {
  return satisfies(engine, m.engine);
}

/** The permission, in words; the host and the plugin manager use this. */
export function describePermission(p: string): string {
  if (p in PERMISSIONS) return PERMISSIONS[p as PermissionName];
  const host = /^network:(.+)$/.exec(p)?.[1];
  return host ? `Talk to ${host} over the internet` : p;
}

/** Does a granted set cover a requested permission? `network` covers every `network:<host>`. */
export function grants(granted: readonly string[], wanted: string): boolean {
  return granted.includes(wanted) || (wanted.startsWith('network:') && granted.includes('network'));
}
