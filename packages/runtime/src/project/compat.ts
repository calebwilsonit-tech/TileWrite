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
  timedGravity: {
    label: 'When gravity turns, the body turns with it over a moment, and is checked against the blocks every tick on the way',
    help: 'Off: the older rule, where the body jumps to its new place at once when gravity turns and only the picture eases. On: the body turns over the time the scene (or the body) says, 0.25 seconds when it does not say, and is kept out of every block while it turns; if something is in the way it waits for room.',
    since: 3,
  },
  uiScroll: {
    label: 'Panels, lists and grids scroll with the engine’s own scroller (no browser scrollbar), and the focus keeps what is chosen in view',
    help: 'Off: a panel set to scroll gets the browser’s own scrollbar and the mouse wheel only, and moving the focus with the keys or the pad can leave the chosen row off screen. On: every scrolling panel, list or grid is scrolled by the engine: the mapped scroll buttons, the wheel, dragging and touch all work, the chosen row is brought into view, and the scrollbar (if any) is made of the parts you pick.',
    since: 4,
  },
  uiControls: {
    label: 'Sliders, choice lists and the other form controls are drawn by the engine from parts you can replace',
    help: 'Off: a slider is the browser’s range input, a choice list the browser’s select box (Interact does nothing on it), and tabs are browser buttons. On: they are made of parts (a track, a thumb, a list of options...) that you can replace with your own widgets, the mapped buttons step and open them, and nothing in a game looks like a web page.',
    since: 4,
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
