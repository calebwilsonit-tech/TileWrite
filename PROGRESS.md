# Tilewright progress

Boxes are ticked only when the milestone's tests pass and the sample has been played.
Spec: `ENGINE_BUILD_PROMPT.md`. Read `DECISIONS.md` and `KNOWN_ISSUES.md` before continuing.

**Next up:** M14 is nearly done (tutorial, docs, accessibility, golden pictures, sound and hit feel, the sample game). What is left is the list of engine features owed since earlier milestones (autotiling, hot reload / separate game window, vector drawing, visual state machines, dialogue graph canvas, localization), a full green run, and the final summary in this file (what was built, what is weak, what next).

## Milestones

- [x] M0 Foundations (repo, workspaces, lint, typecheck, tests, CI, Electron window, state docs)
- [x] M1 Runtime core (iso math, scene/ECS, renderer + depth sort, camera, input, fixed timestep)
- [x] M2 Heights and collision (stairs, cliffs, pits, falling, occlusion fade)
- [x] M3 Editor shell + world painter (see the M3 checklist: what is done and what was deliberately deferred)
- [x] M4 Sprite studio (see the M4 checklist for what is deferred)
- [x] M5 No-code logic (see the M5 checklist for what is deferred)
- [x] M6 Echoes, light, puzzle parts (see the M6 checklist)
- [x] M7 AI and combat (see the M7 checklist)
- [x] M8 Story systems (see the M8 checklist)
- [x] M9 Errors and debugging (see the M9 checklist)
- [x] M10 Code window (see the M10 checklist)
- [x] M11 Claude assistant (see the M11 checklist)
- [x] M12 Export and packaging (see the M12 checklist; the NSIS installer itself is unverified)
- [x] M13 The acceptance game (see the M13 checklist)
- [ ] M14 Polish

## M0 sub-checklist (done)

- [x] npm workspaces layout, TypeScript/ESLint/Vitest config, Electron + Vite + React shell
- [x] tests, typecheck, lint green; Playwright smoke test; CI workflow written (not yet run: no remote repo)

## M3 checklist

Done and covered by tests (unit: `packages/editor/src/**/*.test.ts`; e2e: `e2e/m3-*.spec.ts`, which drive the real window with mouse and keyboard):
- [x] Project manager: new from template (3 templates), open, recent list, plain-English errors for damaged / too-new files
- [x] Project + scene formats: JSON with `schemaVersion`, Zod validation, migration framework, one-row-per-line map layers
- [x] Docking panels with saved layout and reset; light/dark theme; command palette (Ctrl+K); shortcut editor with conflict warnings and persistence
- [x] Global undo/redo for every action (command pattern), History panel
- [x] Autosave + crash recovery (verified by killing the process), atomic saves, save/reload round trip
- [x] Brushes: single, rectangle (outline option), line, flood fill, eraser, random scatter, pattern stamp; tile palette with search
- [x] Height tools: raise/lower/set/smooth; stairs, ramp, cliff, pit, water, bridge tools that make the right tiles and collision automatically
- [x] Collision: blocker and one-way-edge painting, colour overlay, walk test; collision derives from the terrain automatically
- [x] Layers panel: visibility + lock for Ground / Objects / Regions; locked layers refuse edits with an explanation
- [x] Regions (camera bounds work in play; music, darkness, boss flags are stored for later milestones)
- [x] Objects: place (snapped, rotate), select (click, shift, box), move, rotate, delete, copy/paste across scenes, duplicate; inspector for objects, regions and scene
- [x] Procedural helpers: room, corridor, scatter props
- [x] Basic validators in the Problems panel with Go to (no player, outside map, bad stairs, unreachable floor, ...)
- [x] Play in editor: Play / Pause / Step / Stop, Play from here, runtime errors pause the game with a message
- [x] Sample built in the UI and played: bridge crossing, stairs onto a platform, pit fall (`e2e/m3-build.spec.ts`)

Deliberately deferred (so the box above is honest):
- [ ] Autotiling rules and their visual editor, Decoration / Walls / Lights layers (M4 / M6)
- [ ] Per-height collision painting (collision currently comes from heights, flags and decks)
- [ ] Hot reload while the game is running; game in a separate window (M10 / M14)
- [x] Asset import and asset browser (M4); "Explain / Fix with Claude" buttons (M11, done)
- [ ] Bypass and soft-lock validators (M9)

## M4 checklist

Done and covered by tests (unit: `packages/runtime/src/sprites`, `anim`, `packages/editor/src/renderer/studio`; e2e: `e2e/m4-studio.spec.ts`, which draws with the real mouse):
- [x] Sprite file format (Zod, RLE pixels, one frame per line), PNG encoder/decoder, sheet packer with trimming, Aseprite reader (layers, frames, durations, palette, tags)
- [x] Drawing: pencil, eraser, line, rectangle, ellipse, fill, picker, select/move/copy, flip/rotate/nudge, brush size, mirror drawing, **iso box helper**, **iso guide grid**, onion skin, pixel grid, zoom/pan
- [x] Layers (add, rename, hide, reorder, merge), palette management, undo/redo for every stroke and edit
- [x] Timeline with frame durations, add/duplicate/delete/reorder with animations following
- [x] **8-direction animation sets** with **mirror left/right**, per-animation loop, events, live preview facing any direction
- [x] Feet point, hitboxes and hurtboxes per frame
- [x] Parametric shapes with sliders baked to pixels
- [x] Export to packed sprite sheet + atlas, import PNG / sprite sheets / Aseprite, asset browser with search and tags, find uses, missing-sprite problem
- [x] Runtime: textured sprites in the renderer, animator state machine (conditions, wait-for-end), clip events, tweens with 11 easings (deterministic, simulation-driven)
- [x] Sample made in the UI and played: a character drawn and animated in the studio walks the room, turning and mirroring (`e2e/m4-studio.spec.ts`)

Deferred:
- [ ] Autotiling rules and editor, Decoration / Walls layers (tile art arrives with M5/M14)
- [ ] Vector drawing mode, free rotate/scale of selections, tile-art editing (the studio draws sprites; terrain is still procedural)
- [ ] Aseprite import is covered by unit tests with a hand-built file, not yet by a real Aseprite-made file
## M5 checklist

Done and covered by tests (unit: `packages/behaviors/src`, `packages/editor/src/renderer/model/logic.test.ts`; e2e: `e2e/m5-logic.spec.ts`, real window, real mouse; docs: `docs/logic.md`):
- [x] Behaviour framework with registry; inspector Behaviours section with plain-English settings and help; required-part check in Problems
- [x] Built-ins: Pushable, Pressure Plate (momentary/latched), Trigger Zone, Lever, Timer, Logic Gate, Gate/Door, Spawner, Pickup, Moving Platform, Falling Floor, Projectile, Follow Camera
- [x] Signals, wires (Wire tool + connect dialog + viewport lines + inspector list), logic nodes
- [x] Event sheets (conditions/actions, AND/OR/NOT, once, repeat, for-each, sub-events, plain-English sentences, error list)
- [x] Prefabs with overrides, nesting, apply/revert/unlink, saved as overrides only, Assets panel
- [x] Solid objects as platforms; moving platforms carry riders
- [x] Sample built in the UI and played: crate pushed onto a plate opens a gate, an event row fires, player walks through (`e2e/m5-logic.spec.ts`)

Deferred:
- [ ] Health, Damage on Touch, Patrol, Chase, Vision, Boss (M7); Pickup inventory, NPC, Checkpoint, Portal (M8); echo, light, sentence-stone behaviours (M6)
- [ ] Prefab children shown individually in the editor; visual state machines for enemies/bosses; non-OR wire combination without a Logic Gate

## M6 checklist

Done and covered by tests (unit: `packages/runtime/src/lighting`, `packages/behaviors/src/m6.test.ts`, `packages/editor/src/renderer/model/logic.test.ts`; e2e: `e2e/m6-echoes.spec.ts`, `e2e/m6-words.spec.ts`; docs: `docs/echoes-light-words.md`):
- [x] Echo recorder (record up to N seconds, ghosts replay input deterministically, several at once, capacity from a story variable, hold/loop/vanish, ghosts press plates, gates can let ghosts through)
- [x] Lighting model and renderer: regions' darkness, `darkness` variable, lights with radius/colour/flicker/switch wire, shadows from walls and tall objects, light queries (`isLit`/`lightLevel`), Light Sensor, soft-edged darkness drawn in play (screenshots inspected)
- [x] Growing objects (rising dough: grows over time, faster in light, becomes a taller solid block, Shrink signal)
- [x] Sentence stones (swappable word, per-word signals, variable) and formattable text blocks (underline bridge, bold wall, italic slides; player or wires format them); `label` text rendering
- [x] Editor: new objects in the Place tool (Sentence stone, Text block, Lantern, Light sensor, Rising dough), region Darkness slider, validators for stones/echoes
- [x] Samples built in the UI and played: a two-echo puzzle room in the dark (two plates, AND, gate), a sentence stone that opens a gate and an underlined text block that bridges a pit

Deferred:
- [ ] Lantern fuel / light resource bar (M7/M8); light tinting of tiles; soft region borders; edit-mode lighting preview; shadows from decks and slopes
- [ ] Event-sheet conditions/actions specific to echoes and words (they work today through variables and wires)

## M7 checklist

Done and covered by tests (unit: `packages/runtime/src/ai`, `packages/behaviors/src/m7.test.ts`, editor tests; e2e: `e2e/m7-combat.spec.ts`; docs: `docs/ai-and-combat.md`):
- [x] A* pathfinding on the iso grid with heights, stairs, pits, water, walls, one-way edges, bridges and obstacles
- [x] Health (invulnerability, knockback, respawn/remove/stay, fall damage and recovery), Damage on Touch, Melee Attack (the quill), Dodge, Boss Phases (phases, helpers, room-limited fights, Defeated signal)
- [x] Patrol (with the Patrol path tool), Vision Cone (cone, walls, darkness, hearing), Chase (chase, search, return) with editor gizmos for routes and view cones
- [x] Play HUD (hearts and boss bar), event-sheet conditions and actions for health and combat events, validators (routes that cannot be walked, bosses without a room)
- [x] Sample built in the UI and played: a stealth guard that is heard and defeated, and a three-phase boss in an arena whose defeat opens a gate (`e2e/m7-combat.spec.ts`, screenshots inspected)

Deferred:
- [ ] Visual state-machine editor for enemies and bosses; behaviour trees; ranged enemy attacks; guards avoiding each other; hearing blocked by walls
- [ ] Light/resource bar and lantern fuel; art and animation for the quill and dodge

## M8 checklist

Done and covered by tests (unit: `packages/runtime/src/story`, `packages/behaviors/src/m8.test.ts`, `packages/editor/src/renderer/project/story.test.ts`; e2e: `e2e/m8-story.spec.ts`; docs: `docs/story-systems.md`):
- [x] Items and inventory (variables), quick slots 1-4, using items, pickups that give items
- [x] Dialogue graphs (lines, choices with conditions, set, give/take, branch) with a plain-English checker, the NPC Talk behaviour, conversation box with mouse and keyboard choices, world frozen during talk
- [x] Cutscene timeline (camera, walks, speech, dialogue, fades, shake, animation, sound, variables, items; "keep going" steps; skippable) with Cutscene Trigger; Story panel editors for items, dialogues and cutscenes with Test buttons
- [x] Lantern posts (light, rest, respawn at the last one, fast travel list), scene portals, scene changes that keep flags/items/health, hub-and-areas by portals
- [x] Save/load: three slots plus autosave, persistent objects, versioned format, backups and corrupted-save recovery
- [x] The game's own HUD and menus (hearts, slots, boss bars, messages, pause menu with inventory/travel/save/load/settings/restart), difficulty, remappable controls with keyboard, mouse and gamepad support
- [x] Sample built in the UI and played: a hub (keeper, lantern, bread, portal, intro cutscene) and a cave, including saving, loading, remapping and fast travel (`e2e/m8-story.spec.ts`, screenshots inspected)

Deferred:
- [ ] Dialogue node-graph canvas and a visual cutscene timeline; localization string tables
- [x] Audio engine and hit-stop (M14)
- [ ] Video settings, minigames, cosmetic skins, drawn world map

## M14 checklist (in progress)

- [x] Interactive first-run tutorial (`Take the tutorial` on the project screen, or Commands): ten self-ticking steps build a plate, a crate and a gate behind a wall, wire them and play it (`e2e/m14-tutorial.spec.ts`)
- [x] Docs: an index (`docs/README.md`), a reference page for every behaviour and every event block generated from the engine and compared by a test, recipes for the common things, a panel manual (a test checks every panel is described and every link resolves)
- [x] Accessibility: text size 100-200%, colour-blind-safe overlay palette (checked by a test simulating protanopia, deuteranopia and tritanopia), less motion, everything remappable (`e2e/m14-accessibility.spec.ts`, `docs/accessibility.md`)
- [x] Golden-picture tests of the finished hub and dungeon (Playwright snapshots), determinism (three replays of the slice end in identical saved state, equal to the bot's own run), speed (about 1 ms of game logic per step in a headless replay, 60 fps and 0.3 ms per step in the real window, asserted)
- [x] Sound and music (WebAudio engine: named sounds from `assets/audio`, pitch variation, a voice cap, music loops that crossfade, volumes from Settings), region music, event actions and cutscene steps, Assets panel Sounds section with preview, a warning for names that have no file (`docs/sound-and-effects.md`, `e2e/m14-feel.spec.ts`)
- [x] Hit feel: hit-stop (the game window pauses stepping, so the simulation, bot and replays are unchanged), screen shake from hits, seven particle presets, event actions (burst, shake, freeze), Melee Attack settings, switched off by Settings or Reduce motion
- [x] Sample game: the finished slice ships as 	emplates/last-storytender (project screen **See a finished game**, copied into a chosen folder; checked and replayed by e2e/m14-sample.spec.ts)
- [ ] Autotiling, hot reload and a separate game window, vector drawing, visual state machine, dialogue graph canvas, localization, video settings, minigames, skins (owed since earlier milestones; see KNOWN_ISSUES)

## M13 checklist

Verified by `e2e/m13-acceptance.spec.ts` (a minute, built through the UI) with `e2e/slice-bot.ts`; described in `docs/acceptance.md`:
- [x] Hub with an elder (choice that sets a flag, opening a seal through an event row), a lantern post and a portal
- [x] Dungeon with height levels and stairs, an echo puzzle with two plates and a gate, a crate puzzle, a sentence stone that turns a text block into a bridge over a pit, a stealth guard, a lantern post, a two-phase boss in an arena guarding the exit
- [x] Death respawn at the lantern, pause menu with Restart and Travel, save/load, settings with input remapping (played with the real menus in the editor)
- [x] The validators report no bypass, no soft-lock and no problems, and do catch a hole cut into a wall
- [x] The playbot finishes the slice from the first frame to the exit, hub to dungeon, with buttons only (47 s of game time)
- [x] The slice exports to a Windows program that starts in the hub and plays with real keys and mouse (no editor installed on that path)
- [x] Engine fixes the slice forced: bridges in the checks and the bot, gates in a row, crate puzzles in later rooms, flags set by conversations, bot travel/fight/corner recovery

## M12 checklist

Done and covered by tests (unit: `packages/exporter/src/exporter.test.ts`; e2e: `e2e/m12-export.spec.ts` (the editor exports a game, the exported .exe is launched and driven), `e2e/packaged-export.spec.ts` (optional, against a packaged editor); docs: `docs/export.md`, `docs/BUILDING.md`):
- [x] Export dialog (toolbar / Commands): game name, version, window size, full screen, splash text, icon; settings remembered in `export-settings.json`
- [x] Export saves the scene, runs the whole-project check, settings, icon and script compile checks, and refuses on errors (verified: deleting the player blocks it with a plain-English message)
- [x] Makes `<Name>-<version>-windows/` with `<Name>.exe` and a zip: Electron runtime copied from the running editor, no editor code, no download, nothing needed at run time
- [x] Exported game runs the same PlaySession as Play: the real keyboard moves the player, the script made the crate turn, the window has the chosen size, saves go to the game's own folder, the file bridge refuses anything outside the game's folders
- [x] A failing script gives a friendly screen with the cause and a crash log file in the game's logs folder (screenshots inspected)
- [x] Packaged editor (app.asar) exports correctly (found and fixed: `fs.cp` does not work inside asar)
- [x] `electron-builder` zip/unpacked build of the editor works (160 MB zip); `docs/BUILDING.md` written; CI `windows-build` job added

Not verified: the NSIS installer (`npm run dist:win` downloads helper tools that stalled here), the CI jobs (never run), Linux export, exe icon/file properties.

## M11 checklist

Done and covered by tests (unit: `packages/assistant/src/assistant.test.ts`; e2e: `e2e/m11-assistant.spec.ts` against a mock Anthropic server, plus the optional `e2e/live-assistant.spec.ts`; docs: `docs/assistant.md`):
- [x] Assistant panel: key box (keychain via safeStorage, never in files), model and effort pickers, modes (Ask / Explain / Fix / Build / Review), project notes file, streaming transcript, tool activity, usage and estimated cost
- [x] Official SDK from the main process; adaptive thinking, effort, streaming with eager tool input streaming, prompt caching (stable prefix verified), Zod-validated tool inputs, stop_reason handling, parallel results returned together, typed error classes with Retry
- [x] 25 tools: 16 read (scene, tiles, selection, event sheet, behaviours, prefabs, scripts, problems, puzzle check, playbot, screenshot, notes...) and 9 changing tools, all previewed as cards with diffs, approved or rejected, one undo step each
- [x] Explain / Fix with Claude buttons on problems, event sheet problems and game errors
- [x] Criterion 6 verified with the API mocked: (a) explain a deliberately broken event sheet, (b) fix it through an approved change, (c) build a plate-and-gate room from one sentence, then the puzzle check finds nothing and the playbot reaches the exit (screenshots inspected)

Not verified: anything against the real API (needs a key: `npm run test:live`).

## M10 checklist

Done and covered by tests (unit: `packages/behaviors/src/scripting/scripting.test.ts`, `packages/editor/src/renderer/project/scripts.test.ts`, `model/validate.test.ts`; e2e: `e2e/m10-code.spec.ts`; docs: `docs/code-window.md`):
- [x] Code window with Monaco: the engine API as TypeScript types (completions, hover docs, underlined mistakes - verified under Electron/file:// including the TS worker), script list, templates, delete, autosave, compile errors with line numbers
- [x] Scripts are behaviours (`script_<Name>`): Add menu, Inspector settings, wires, prefabs; live reload while playing keeping `me.state`; missing-script problem on objects
- [x] `game.do/test` give code every event-sheet action and condition; "Convert to code" turns an event sheet into an equivalent script
- [x] Breakpoints (gutter click), pause after the step with the line highlighted, Resume/Step/Stop, watch window, console
- [x] Play/Pause/Step/Stop available in the Code window
- [x] Sample built in the UI: a Spinner script written in the editor, attached to a crate, hot-changed during play, stopped at a breakpoint, event sheet converted (`e2e/m10-code.spec.ts`, screenshots inspected)

Deferred (see KNOWN_ISSUES): sandboxing, line-by-line stepping/call stack, scene Problems panel entries for script compile errors, script imports, compiling scripts in exported games (M12).
## M9 checklist

Done and covered by tests (unit: `packages/playbot/src`, `packages/behaviors/src/{m9,crash}.test.ts`, `packages/editor/src/renderer/project/check.test.ts`, `model/logic.test.ts`; e2e: `e2e/m9-checks.spec.ts`; docs: `docs/checks-and-playbot.md`):
- [x] Problems panel with plain-English problems and Go to for the scene, puzzle checks (bypassed gates incl. jumps, unreachable goals, useless gates, unsolvable and soft-lockable crate puzzles), connection checks (plates/gates connected to nothing) and a whole-project check (doors to nowhere, missing conversations/cutscenes/items, dialogue and cutscene problems)
- [x] Runtime errors never crash the editor: the game pauses, the panel shows which step and object failed, a state snapshot and the stack, with Go to / Copy / Dismiss
- [x] Debug overlays (trigger areas and solid objects, guard routes and cones, light reach, draw order) in the editor and while playing; speed meter with slowest behaviours; a performance budget test (5,000 tiles, 200 objects)
- [x] The playbot: button-only walking with A*, stuck/blocked/time-out reports, switches, talking, pushing, a crate-puzzle solver that it carries out, echo plates, playthroughs recorded by playing or by the bot and replayed with expectations
- [x] Sample built in the UI and checked by the bot: a walled room whose gate leaves a gap (found by the check and proved by the bot), fixed with a second gate, solved by the bot after using the switch, run kept and replayed (`e2e/m9-checks.spec.ts`, screenshots inspected)

Deferred:
- [ ] A search-based puzzle solver for echo/crate combinations beyond the fixed recipes; soft-lock analysis beyond crate puzzles; a bot that fights and uses items
- [x] "Explain" / "Fix with Claude" buttons (M11)
- [x] Crash log files and screen in exported games (M12)

