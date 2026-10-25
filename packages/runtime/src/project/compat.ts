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
  blockPhysics: {
    label: 'Bodies collide with every block, in every direction, whichever way gravity points',
    help: 'Off: the older physics, which only checks the feet against a map of heights (a ceiling does not stop a jump, and gravity can only point down). On: every body whole box is tested against every solid block it moves into, so ceilings, overhangs and walls work, and gravity can point at any of the six sides.',
    since: 3,
  },
  loadRestoresHealth: {
    label: 'Loading a saved game brings the player back with the health they had',
    help: 'Off: the older behaviour, where a loaded game always started at full health (the health is made on the first tick, after the load had already tried to set it). On: the health in the save is used.',
    since: 3,
  },
  backClosesMenus: {
    label: 'Back (Esc) closes a menu you made, even one that does not take the buttons',
    help: 'Off: the older rule, where Back passes straight through any screen that does not take the buttons, so Esc on such a menu (an inventory that leaves the game running, say) opens Pause instead of closing it. On: Back closes any screen the player opened as a menu; only a heads-up display (the HUD role, a screen that is up from the start and takes no buttons, or one set to "let it through") lets Back pass.',
    since: 3,
  },
  menuKeys: {
    label: 'The keyboard and the pad work menus you made the way they work the game\'s own menus',
    help: 'Off: the older rule for screens made in the designer: the first press of a direction only chooses the first widget, the focus stops at the last one, up and down go to the nearest widget (which can skip a narrow one), and left and right do not change choices or tick boxes. On: a menu opens with its first row chosen, going past the last row comes round to the first, up and down go to the next row whatever its width, left and right change a choice or flip a tick box, and the button that presses the chosen widget is not also given to the game. The game\'s own screens (Pause, Settings...) always work this way.',
    since: 3,
  },
  pauseAction: {
    label: 'The pause button is a Quick Action you can see and change',
    help: 'Off: the pause button opens the screen used as Pause by itself, which nothing in the project shows (the older rule). On: it does nothing by itself; the Quick Action "When the pause button is pressed, open the Pause screen", which every new scene starts with, does it, so you can change or remove it. Back (closing a screen) works either way.',
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
