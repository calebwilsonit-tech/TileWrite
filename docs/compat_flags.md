# Compatibility flags

A change in how the engine behaves that a game made before it might rely on goes behind a **flag**. A project file with no entry for a flag plays exactly as it always did (the flag is off). A new project is made with every flag on. Each flag can be switched on and off for one project in **Project settings, Compatibility**, or by hand in `project.json`:

```json
"compat": { "blockPhysics": true, "pauseAction": false }
```

Taking a flag out of the list is the same as `false`. The flags are listed with their help text in `packages/runtime/src/project/compat.ts`; this page says what each does and what moves when it is switched.

| Flag | Since | Off (how it always played) | On |
| --- | --- | --- | --- |
| `fadeBySight` | phase 3 | A wall fades when its picture overlaps the picture of the thing being followed and it is drawn after it, which can fade a wall that is not in the way (or keep one that is) when something stands on a wall or a ceiling. | A wall fades only when it really stands between the camera and the followed thing. |
| `blockPhysics` | phase 3 | Bodies are checked by their feet against a map of heights: a ceiling does not stop a jump, and gravity can only point down. | Every body's whole box is tested against every solid block it moves into, in every direction; gravity can point at any of the six sides. |
| `pauseAction` | phase 3 | The pause button opens the screen used as Pause by itself (a rule nothing in the project shows). | The pause button does nothing by itself; the Quick Action "When the pause button is pressed, open the Pause screen" (every new scene starts with it) does. Back still closes screens either way. Switching it on for an old project does not add the row to its scenes. |
| `backClosesMenus` | round 2 of phase 3 | Back (Esc) passes straight through any screen that does not take the buttons, so Esc on such a menu (an inventory that leaves the game running) opens Pause instead of closing the menu. | Back closes any screen the player opened as a menu. Only a heads-up display lets Back through: the HUD role, a screen that is up from the start and takes no buttons, or one set to "let it through to the game". |
| `menuKeys` | round 2 of phase 3 | In a screen made in the designer, the first press of a direction only chooses the first widget, the focus stops at the last one, up and down go to the nearest widget (which can skip a narrow one), left and right do not change choices or tick boxes, and the button that presses a widget is also given to the game. | A menu opens with its first row chosen; going past the last row comes round to the first; up and down go to the next row whatever its width; left and right change a choice or flip a tick box; the button that presses the chosen widget is not also given to the game. (The screens plugins ship, and copies of them, always work this way.) |
| `timedGravity` | round 2 of phase 3 | When gravity turns for a body (it needs `blockPhysics`), the body jumps to its new place at once; only the picture eases. | The body turns round its middle over the time the scene (or the body) says, 0.25 seconds when it does not, and is kept out of every block on the way; if it has no room it waits for it. |
| `loadRestoresHealth` | phase 3 | A loaded game starts the player at full health (the health is made on the first tick, after the load tried to set it). | The player comes back with the health the save says. |
| `menuButtonsClose` | round 3 | The inventory button (Tab, I) and the map button (M) only open their screens; while one is open, pressing the same button again does nothing, and only Back closes it. | Pressing the button again while its screen (the one used as Inventory, or as World map or Travel) is on top closes it, and the press goes no further. |
| `uiScroll` | round 3 (the maps, scrolling and controls add-on) | A panel, list or grid set to scroll gets the browser's own scrollbar and the mouse wheel only, and moving the focus with the keys or the pad can leave the chosen row off screen. | Every scrolling panel, list or grid is scrolled by the engine: the mapped scroll buttons (`ui_scroll_*`, `ui_page_up`, `ui_page_down`), the wheel, dragging and touch all work, the chosen row is brought into view, and the scrollbar (if any) is made of the parts you pick. See [recipes/scrolling.md](recipes/scrolling.md). |
| `uiControls` | round 3 (the maps, scrolling and controls add-on) | A slider is the browser's range input, a choice list the browser's select box (Interact does nothing on it), and tabs are browser buttons. | Sliders, choice lists, tick boxes, key bindings and tabs are drawn by the engine from parts (a track, a thumb, a list of options...) that you can replace with your own widgets; the mapped buttons step and open them, and nothing in a game looks like a web page. See [recipes/form-controls.md](recipes/form-controls.md). |

The new widget types **Text field**, **Number field** and **Map** are always drawn by the engine and need no flag: no game made before them has one. The mapped buttons the new controls use (`ui_scroll_*`, `ui_page_up`, `ui_page_down`, `ui_zoom_in`, `ui_zoom_out`, `ui_recentre`) are added to the game's controls by the plugin host. The game's Controls screen lists them only when `uiScroll` or `uiControls` is on, so a project without the flags shows the same controls list as before.

## Which projects have which flags

| Project | Flags on | Why |
| --- | --- | --- |
| **The owner's project** (`compat/projects/Demo`, "Upside Down") | none | It was made before the flags. Nothing was switched on for it without the owner's say. The gravity problems found in it are fixed behind `fadeBySight` and `blockPhysics`; `compat/proposals/upside-down.md` and `upside-down-gravity.diff` say what turning them on, and the two changes to its scripts, would do (tested on a copy; **not applied**). |
| the nine samples in `samples/` (tiles, tactics, colony, roguelike, tower defence, point and click, strategy, UI showcase, gravity room) | `fadeBySight`, `blockPhysics` | The editor saved them with the flags that existed when they were last built or opened. They have `pauseAction`, `loadRestoresHealth`, `timedGravity`, `uiScroll` and `uiControls` off, so they play as they did. |
| the reference game sample (`last-storytender`) | none | It has no `compat` entry. |
| every new project, and every template | all ten | A new project plays the way the engine plays now. (`uiScroll` and `uiControls` are the two newest.) |

## The project file's format, and going back

The project file has a format number (`schemaVersion`). Format 2 calls the list of plugins `plugins`; format 1 called it `packs`. A project in an older format opens and plays as it always did, and **nothing on disk changes until you save**. The first save of an older project copies the file as it was to `.tilewright/backup-format-1/project.json` (inside the project folder; Tilewright says so), because an older Tilewright cannot open a newer format. To go back: close Tilewright, put that file back as `project.json`, and open the project in the older Tilewright. The copy is made once and never overwritten.

## How to switch a flag off again

Project settings, **Compatibility**, untick it. Or remove the name from `"compat"` in `project.json`. The change takes effect the next time the game starts (Play, or an export).

## How the flags are kept honest

`npm run compat` plays every project in the corpus with its own flags and compares with the baseline taken before: a flag that is off must never change a trace, a save, a scene round trip or an exported file. The baselines of the owner's projects stay out of git (`.gitignore`), so the owner can run it themselves.
