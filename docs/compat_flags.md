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
| `loadRestoresHealth` | phase 3 | A loaded game starts the player at full health (the health is made on the first tick, after the load tried to set it). | The player comes back with the health the save says. |

## Which projects have which flags

| Project | Flags on | Why |
| --- | --- | --- |
| **The owner's project** (`compat/projects/Demo`, "Upside Down") | none | It was made before the flags. Nothing was switched on for it without the owner's say. The gravity problems found in it are fixed behind `fadeBySight` and `blockPhysics`; `compat/proposals/upside-down.md` and `upside-down-gravity.diff` say what turning them on, and the two changes to its scripts, would do (tested on a copy; **not applied**). |
| the nine samples in `samples/` (tiles, tactics, colony, roguelike, tower defence, point and click, strategy, UI showcase, gravity room) | `fadeBySight`, `blockPhysics` | The editor saved them with the flags that existed when they were last built or opened. They have `pauseAction` and `loadRestoresHealth` off, so they play as they did. |
| the reference game sample (`last-storytender`) | none | It has no `compat` entry. |
| every new project, and every template | all five | A new project plays the way the engine plays now. |

## How to switch a flag off again

Project settings, **Compatibility**, untick it. Or remove the name from `"compat"` in `project.json`. The change takes effect the next time the game starts (Play, or an export).

## How the flags are kept honest

`npm run compat` plays every project in the corpus with its own flags and compares with the baseline taken before: a flag that is off must never change a trace, a save, a scene round trip or an exported file. The baselines of the owner's projects stay out of git (`.gitignore`), so the owner can run it themselves.
