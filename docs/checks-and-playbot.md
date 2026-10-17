# Checks, debugging and the playbot (M9)

Code: `packages/playbot/src/*`, `packages/runtime/src/core/{profiler,crash}.ts`, the editor's Problems and Playbot panels (`panels/BottomPanels.tsx`, `panels/PlaybotPanel.tsx`), `project/check.ts`, `viewport/{debug-draw,play-session}.ts`.

## Problems panel
Every problem in plain English with **Go to**, in three groups:
- **This scene** (always up to date): no player, things outside the map or standing on a pit, stairs that do not meet the floor, behaviours missing a part, wires to things that lost their signal, sentence stones with one word, patrols with fewer than two points or a leg that cannot be walked, bosses outside a boss room, plates/levers/sensors/zones/timers connected to nothing, gates with nothing to open them.
- **Puzzle checks** (`Check puzzles`, and a quick version after every save): a goal that cannot be reached even with every gate open (error); a goal that **can be reached without opening any gate** (a puzzle bypass: a gap beside the gate, a pit the player can jump); gates that block nothing; and (full check) crate puzzles that **cannot be solved** or that **can be soft-locked** ("pushing Crate A from cell (5, 3) east leaves a position where it can never be solved"). Goals are objects tagged `goal`, `exit` or `reward` (the Place tool's **Goal / exit**).
- **Whole project** (`Check the whole project`, what Export insists on): every scene's problems plus doors leading to scenes that are not in the project or to spawn names that do not exist, characters whose conversation is missing, cutscene triggers, pickups and event rows naming things that do not exist, and the dialogues and cutscenes themselves. **Open** jumps to the scene and object.
"Explain" and "Fix with Claude" arrive with the assistant (M11).

## When the game fails
Runtime errors never crash the editor: the game pauses and the Problems panel shows **The game stopped**: which step failed (a system, or a behaviour on a named object), the original message, a snapshot (tick, scene, player place and health, variables, recent events) and the technical stack. **Go to that object**, **Copy report**, **Dismiss**. The same `crashReport`/`formatCrashReport` will write the log file of exported games.

## Debugging aids (Layers panel, Overlays) — in the editor and while playing
Collision colours, height numbers, **trigger areas and solid objects** (purple / red footprints), **guard routes and view cones** (live paths and cones while playing), **how far lights reach**, **draw-order numbers**, and the **speed meter** (frames per second, game-step and drawing time, objects/tiles/lights, the slowest behaviours and systems; timing is off unless the meter is shown, and never affects the simulation).
Budget enforced by a test: a tick of a scene with 5,000+ tiles and 200 objects must stay under 5.5 ms (it runs near 1.5 ms), best of several windows so a busy computer cannot fail it.

## The playbot
A bot that plays with **only the buttons a player has** (movement keys, interact, echo...), through the same simulation as Play (headless): `Bot` in `@tilewright/playbot`.
- **Walk to the goal** plans around walls, pits and objects (A*), notices when it is stuck and says where ("Stuck at cell (7, 2) for 12 s while heading for "Exit""), or that there is no way ("There is no way to walk to "Exit" from here."), or time-outs.
- **Play to the goal (using switches)** tries the nearest plate or lever when the way is shut and walks again ("Reached "Exit" in 9.4s after using "Plate"").
- **Solve the crate puzzle** searches the crate arrangements (Sokoban-style, small rooms) and then carries out the pushes with the buttons.
- **Hold the plates with echoes** records an echo onto each plate in turn and stands on the last one itself.
- Also: talk through a conversation choosing the answers you want, stand on a plate, push a crate one cell.
- **Playthroughs**: record one by playing (`Record one by playing`, saved when you press Stop; it must end near the goal if you got there) or keep the bot's last run. `Replay` plays the recorded buttons into the scene as it is now and reports whether it still ends as it should (variables, near the goal); a level change that breaks it is reported ("The player ended 4.2 cells from "Exit""). Stored in `playthroughs/` as JSON (the buttons only, deterministic).
Mouse clicks on conversation choices are not part of a recording (use the keys when recording).

## Tested by
`packages/playbot/src/{analysis,bot}.test.ts` (reachability, jumps over pits, bypasses, useless gates, unreachable goals, crate puzzles and soft-locks, walking/stuck/blocked/time-out, talking, pushing, echoes, solving, playthroughs), `packages/behaviors/src/{m9,crash}.test.ts` (profiler, error attribution, crash reports, the performance budget), `packages/editor/src/renderer/project/check.test.ts`, validator tests in `model/logic.test.ts`, and `e2e/m9-checks.spec.ts` (a level with a gate that does not fill its doorway is checked, the bot proves the bypass by walking through it, a second gate fixes it, the bot then needs the switch, the run is kept and replayed, the project checks out, the overlays and speed meter are used, and a failing script produces a crash report).

## Playing a whole game with the bot
- The bot can **fight** (`Bot.fight`): it walks up to an enemy or boss round the walls and swings the quill until it is defeated.
- A headless `Game` can hold **all the scenes** of a project: portals, lanterns and "go to" actions change scene as they do in play, carrying items, flags, lit lanterns and health, and the bot's walk reports "went on to the next scene" instead of failing.
- A **playthrough** recorded over several scenes (by the bot, or by playing) replays from its first scene; the Playbot panel's replay button runs it across scenes. `docs/acceptance.md` shows a bot that plays a whole two-scene game from the first frame to the exit, and replays it for the same result every time (that is also the determinism test).
- Text blocks that can be turned into bridges count as walkable in the checks and in the bot's path planning once underlined; a gate counts as useful if opening it changes where the player can go with the other gates shut or open (so gates in a row, and a doorway filled by two gates, are both fine); crate puzzles in later rooms are checked as if the earlier gates were open.
