/**
 * Compatibility flags (phase 3, Rule A). A change in how the engine behaves that a game made before it might rely on
 * goes behind a flag: a project with no `compat` entry for a flag plays exactly as it always did (the flag is off), and a
 * new project is made with every flag on. The owner can read which flags a project has, and switch each one on or off
 * (Project settings -> Compatibility).
 */
export const COMPAT_FLAGS = {
  fadeBySight: {
    label: 'Walls fade only when they really stand between the camera and the thing being followed',
    help: 'Off: the older rule, which looks at pictures that overlap and at draw order, and can fade a wall that is not in the way (or keep one that is) when something stands on a wall or a ceiling.',
    since: 3,
  },
} as const;

export type CompatFlag = keyof typeof COMPAT_FLAGS;
export type CompatFlags = Record<CompatFlag, boolean>;

export const COMPAT_NAMES = Object.keys(COMPAT_FLAGS) as CompatFlag[];

/** Every flag off: how a project played before flags existed. */
export const legacyFlags = (): CompatFlags => Object.fromEntries(COMPAT_NAMES.map((n) => [n, false])) as CompatFlags;

/** Every flag on: how a new project plays. */
export const currentFlags = (): CompatFlags => Object.fromEntries(COMPAT_NAMES.map((n) => [n, true])) as CompatFlags;

/** The flags a project plays with: what it says, and off for everything it does not mention. */
export function compatOf(project: { compat?: Record<string, boolean> | undefined }): CompatFlags {
  const out = legacyFlags();
  for (const n of COMPAT_NAMES) if (project.compat?.[n] === true) out[n] = true;
  return out;
}
