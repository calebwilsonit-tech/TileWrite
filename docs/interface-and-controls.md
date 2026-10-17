# The game's own screen: title, interface and controls

Three things shape how the game greets and talks to the player. None needs code.

## Project settings and the title screen
**Project...** in the top bar (or *Commands -> Project settings*) opens the project settings.
- **Game**: the name of the game, the scene it starts in, and **Show a title screen first** with an optional line under the name. The title screen offers *New game*, *Continue* (only once the player has a save; it loads the newest one), *Load game*, *Settings* and *Quit*. The world waits behind it and the pause keys cannot close it. It shows in the exported game and when you press **Play** (not with **From here** or a Test button). The name and the line can be translated.
- **Controls**: see below.

(The tile size stored in `project.json` is not used by the editor yet; see KNOWN_ISSUES.)

## Controls (`assets/input.json`)
In **Project settings -> Controls** each built-in action shows the keys and buttons a new player starts with. **Change** then press a key, mouse button or gamepad button (Esc cancels); **Standard** puts the built-in ones back. Rebinding follows the in-game rules: a key taken from another action is removed from it, and a keyboard change keeps the gamepad button.

**Your own actions** (for example `dash`) are named with lower-case letters, numbers and `_`, given a name to show and a key. Use them in event rows (the *button is pressed* condition: type the action name) or scripts (`input.pressed("dash")`). They appear on the game's Settings -> Controls screen and players can rebind them. The project check warns about an action with no key, a key used twice, and a built-in action left with no key.

## The interface (**Story -> Interface**, `assets/ui.json`)
- **The picture** shows the game's screen. Drag a piece (hearts, lantern bar, quick slots, boss bars, messages, or your own) and it pins itself to the nearest of nine places: corners, edge middles, or the centre, keeping the distance you left. *Preview as* shows widescreen, square-ish, ultrawide and a sideways phone; **Make it bigger** gives the picture the whole window. The picture uses the same placement rules as the game.
- **Pinned to** and the pixel fields do the same by number. Pieces left on *where the game puts it* stay in the column at the top left. **Shown** hides a piece; **Size** scales it.
- **Add a counter / bar / text** makes your own: a counter shows a flag or counter beside a label, a bar fills as a number grows toward a maximum (a number or another counter), a text shows words with `{name}` replaced by a flag or counter. Test ids and names: `tw-widget-<name>`.
- **Theme**: lettering (storybook, clean, typewriter, friendly), five colours, corner roundness and the size of menus and the conversation box. They apply to every screen of the game, the title screen included.
- Problems (a counter with no flag, hidden hearts or messages, two pieces with one name) are listed under the editor and in the Problems panel.

Words in these screens (the title, the line under it, labels and texts) are part of **Translations**.

## Formatting words
See [story-systems.md](story-systems.md): `[b]`, `[i]`, `[u]`, `[s]`, `[color=gold]` work in conversations, choices, messages and the title's subtitle.

## Claude
The assistant can change all of this as approved cards: `write_ui_layout`, `write_controls` and `set_project_settings`.

## Tested by
`packages/runtime/src/ui/layout.test.ts` (placement maths, themes, problems), `packages/runtime/src/input/project-input.test.ts`, `e2e/m15-interface.spec.ts` (settings, controls, dragging a piece, title screen, Continue, theme in the game) and `e2e/m15-assistant-tools.spec.ts`.
