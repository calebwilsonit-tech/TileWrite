# Decisions

Append only. Each entry: choice, rejected options, reason.

## D001 - Stack (2026-10-16)
Electron + TypeScript + React for the editor, PixiJS for rendering (from M1), Vitest, Playwright, Zod.
Rejected: Tauri (Rust toolchain needed on user's PC, weaker Playwright story), Godot/Unity (not a deliverable we can ship as our own engine).
Reason: one language, `electron-builder` makes a Windows `.exe`, Playwright can drive the Electron window.

## D002 - Build tooling for the editor (2026-10-16)
Renderer built by Vite. Main and preload bundled by esbuild (main as ESM `main.mjs`, preload as CJS `preload.cjs` because sandboxed preloads must be CJS).
Rejected: `electron-vite` / `electron-forge` (extra layer to learn and debug; esbuild + Vite are already dependencies).

## D003 - Packages are consumed from source (2026-10-16)
Workspace packages set `main`/`types` to `./src/index.ts`; Vite, Vitest and esbuild bundle them directly. One root `tsconfig.json` with `noEmit` type-checks everything.
Rejected: TS project references with `composite` (slow iteration, d.ts build step with no benefit while everything is bundled anyway).
Revisit if the runtime is ever published standalone.

## D004 - Node and git installed via winget (2026-10-16)
The dev machine had neither. Installed Node.js LTS (24.x) and Git for Windows with winget, with the user's approval.
Note: PowerShell sessions started before the install need a PATH refresh.

## D005 - Project file format (2026-10-16)
Plain JSON with `schemaVersion` and migrations, validated by Zod; PNG for images, OGG/WAV for audio. (Implemented from M1.)

## D006 - M1 design and checklist (2026-10-16)
Conventions: grid coords (gx, gy) in tile units, height `h` in levels (float ok). Cell (i,j) covers [i,i+1) x [j,j+1); entity "on cell centre" = i+0.5.
Projection: `sx = (gx-gy)*tileW/2`, `sy = (gx+gy)*tileH/2 - h*heightPx`. Screen "down" = grid (+1,+1), screen "right" = grid (+1,-1).
Movement intent is given in screen terms and converted to grid then normalised in grid space (consistent grid speed).
Entities: ids are monotonically increasing and never reused, so a stale id can never alias a new entity. `world.get(id)` returns undefined once destroyed. Destroy/spawn during a tick are deferred to the end of the tick, so loops never see mutation.
Depth sort: items are 3D boxes (min/max x,y,z). A is behind B if `A.maxX<=B.minX || A.maxY<=B.minY || A.maxZ<=B.minZ`; topological sort with a screen-overlap broadphase handles tall and multi-cell objects. Rejected: single scalar key `x+y+h` (breaks for multi-cell objects). Fallback to key order if a cycle appears.
Simulation: fixed 60 Hz, accumulator with max catch-up of 5 steps; seeded RNG (mulberry32) lives in the simulation so replays are exact. Rendering interpolates nothing in M1 (revisit in M14).
Input: actions not keys. Per tick the input layer produces a snapshot `{action: value}`; recorder stores snapshots only on change; playback feeds them back.
Renderer: PixiJS v8, tiles are built once as Graphics (procedural diamonds + side faces, textures arrive with the sprite studio in M4), entities are Graphics boxes; zIndex is assigned from the sort each frame.
Prefabs with overrides: deferred to M5 (needs the inspector); noted in PROGRESS.md.

M1 checklist: iso math (grid/screen/world, height, neighbours 4/8, cell queries, line of sight) / fixed timestep + determinism test / seeded RNG / ECS world (components, tags, groups, safe refs, deferred spawn/destroy) / tilemap data / camera (follow, deadzone, bounds, zoom, shake) / box depth sort / input map + recorder + playback + DOM keyboard source / Pixi renderer / walking-square sample inside the editor (`#sample-m1`) / e2e screenshot / docs/runtime.md.

## D007 - M2 terrain and collision model (2026-10-16)
Each cell is a column (`heights`) plus optional extras: `slope` (stairs/ramp, rises exactly 1 level toward N/E/S/W over the cell), `flags` (PIT, BLOCK, TRIGGER, WATER), `deck` (one walkable layer above the ground, used for bridges, 1 level thick so you can walk underneath) and `oneWay` (bitmask of cell edges that cannot be entered).
Rejected: arbitrary stacks of surfaces per cell (much more data and editor UI for a case the reference game only needs for bridges); revisit if a game needs multi-storey buildings.
Bodies move axis-separated in sub-steps of <= 0.2 cells. Blocking uses the 4 footprint corners; support/snapping uses the footprint centre. A surface more than `stepUp` (0.35 levels) above the feet blocks (cliff or wall); a drop beyond `stepDown` makes the body airborne (`ledge: 'fall'`) or blocks it (`ledge: 'block'`, used by AI). Gravity 36 levels/s^2.
Pits: a PIT cell has no floor. A body over one falls until z <= PIT_KILL_Z (-3), then the body freezes in state `pit` and `fell` is emitted; game logic (respawn behaviour) calls `teleportBody`. Landing emits `landed` with the fall distance.
Entity colliders: AABB in the ground plane with z range; layers/masks as bitmasks; `solid` blocks bodies, `trigger` emits trigger-enter/stay/exit. Bodies record `blockedBy` for pushables (M5).
Events: `Simulation.events` (EventBus) - synchronous listeners plus a per-tick log for tests and the debugger.
Occlusion fade: renderer-only (not simulation state). Tiles taller than the focus entity's feet + 0.5 that are drawn after it and overlap it on screen fade toward alpha 0.3.

## D008 - Editor architecture (M3) (2026-10-16)
- **Document model** (`renderer/model`): `EditorDoc` owns the mutable scene (TileMap + entity and region lists) and a `History`. Every change is a `Command` with `redo`/`undo`, pushed through the doc, so one Ctrl+Z always means "the last thing I did". Brush gestures use a `Stroke` that applies cells immediately (live feedback) and commits as one command whose cells remember their state from before the first touch.
- **Tools** are plain objects (`down/move/up/cancel/hover`) driven by a `ToolEnv`, so they are tested headlessly with a fake env; the viewport only translates mouse events into `Pointer`s.
- **Docking**: `dockview-react` (the `dockview` package is now the framework-free core). Rejected: hand-rolled split panes (no tabs/floating/serialisation), `flexlayout-react`.
- **State**: a tiny external store (`useSyncExternalStore`) instead of Redux/Zustand; the document keeps its own events and bumps `docVersion` once per frame for React.
- **Pick cell** scans planes from level 12 down and returns the first cell whose column reaches that plane, so clicking raised ground, cliff faces and bridges picks what you see.
- **Security**: the renderer cannot touch files except inside folders the user chose in a native dialog (main-process allow-list); reopening a recent project is allowed only if the folder is in the saved recent list. Writes go to a temp file then rename. Autosave never overwrites the real scene.
- **Play in editor** builds a fresh `Simulation` from `doc.toScene()` using the same `loadScene` the exported game will use, so what you play is what ships.
- **Zod runs in `jitless` mode** because the editor's Content-Security-Policy forbids `new Function` (Zod's JIT probe logged a CSP error).
- **Store reactions loop instead of re-entering** (`ViewportController.onStore`): a failed Play shows a message and calls Stop, which changes the store again; re-entering caused an infinite loop.
- Gotcha: PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM, which breaks `package.json` parsing in tools. Use the Write/Edit tools or `[IO.File]::WriteAllText(..., UTF8Encoding($false))`.

## D009 - Sprites and animation (M4) (2026-10-16)
- **Pixels are palette indices (0 = transparent) stored as run-length text per layer per frame.** Small and diff-friendly. Rejected: base64 PNG per cel (opaque diffs), RGBA arrays (huge).
- **PNG and Aseprite handled by our own small decoders on `fflate`** instead of canvas/`createImageBitmap`, so import/export is identical and unit-testable in Node. Rejected: canvas-based decoding (browser-only, untestable headlessly).
- **Directions**: a clip lists frames per direction plus an "every direction" list; with `mirror`, W/SW/NW reuse E/SE/NE flipped (the renderer sets `scale.x = -1` around the feet point; no extra textures). Facing indexes match the iso maths (0 = East, clockwise).
- **Animator is a component + a system** that reads sprite data from `ctx.assets`, so animation is deterministic and replays exactly (echoes, playbot). Body parameters (`speed`, `airborne`, ...) are filled automatically; the "locomotion" controller preset is generated from clip names.
- **Rendering sprites**: each sprite is packed into one sheet texture (`exportSheet` with trimming) and cut into frame textures; entity views switch texture per frame. Missing sprites fall back to the procedural shape (never crash).
- **Studio edits a decoded copy** (`SpriteDoc`) with cheap per-cel undo for strokes and whole-sprite snapshots for structural edits; saving writes the sprite file and re-registers it so the world editor and play mode pick it up immediately.
- **Unsaved work is never dropped silently**: switching/creating/importing a sprite asks; closing the project saves the open sprite.
- Tween manager lives in the Simulation and updates first each tick.

## D010 - No-code logic (M5) (2026-10-16)
- **A behaviour is a registry entry** (id, settings schema with labels/help, required components, input/output signals, one system). The inspector, validators and the wire dialog are all generated from the registry, so adding a behaviour needs no editor code.
- **Signals are plain booleans on a `signals` component** (inputs/outputs), copied along wires each tick with OR semantics; logic nodes handle AND/NOT/XOR/toggle/delay. Wires and logic settle in a fixpoint before actuators run, so a chain of nodes reacts in the same tick. Rejected: event-bus messages for puzzle wiring (order-dependent, hard to replay).
- **Event sheets are data** (conditions/actions registered with a describe function), so every row can be shown in plain English and checked (`checkSheet`) without running it. Time and edge conditions fire once per tick.
- **Prefab instances store overrides only** (`diffOverrides` against the resolved prefab); the editor holds resolved copies so every setting is visible, and collapses on save. Prefab changes follow files on disk (`setPrefabs`), not undo history.
- **Ctrl+S works inside text fields** (it blurs the field first so the pending edit commits); other shortcuts remain suppressed while typing.
## D011 - Echoes, light, word puzzles (M6) (2026-10-16)
- **Echoes are real entities driven by recorded input**, not position replays: the recorder keeps the player's action snapshots (existing `InputRecorder`) and each ghost feeds them through the same `driveBody` as the player. Physics, plates, pushing and gates therefore treat ghosts exactly like the player, and replays stay deterministic. Echoes carry the `echo` tag and the ECHO collision layer; a gate's `ghostsPass` simply drops that bit from its mask.
- **All echoes restart together** whenever a recording starts or finishes; at capacity the oldest is replaced. Rejected: independent per-echo clocks (hard to reason about in puzzles).
- **Lighting is data + pure functions** (`LightingModel`, `lightLevel`, `isLit`, `visibilityPolygon`) in the runtime, rebuilt each tick by a system after the actuators; sensors and growing objects read last tick's model. Rendering is a separate layer: darkness painted into a RenderTexture with lights erased via the `erase` blend (soft concentric rings clipped to the shadow polygon) plus a faint additive glow. Rejected: per-pixel shaders (harder to test/query; the same model has to answer "is this lit?" for gameplay).
- **Only heights, BLOCK cells and tall solid colliders cast shadows**; decks and slopes do not.
- **Text is a `label` component** drawn by the renderer above an object (no separate UI layer yet); sentence stones and text blocks are ordinary behaviours that set it.
- **A bridge text block is a low solid collider two cells wide** (support is centre-based, so it must fully cover the pit cells it spans).
- Behaviours can be `hidden` (not offered in the Add menu); the echo replay behaviour uses it.
- Gotcha (e2e): specs that step the game by hand must pause through the store (`window.__store.set({ paused: true })`), not only `runner.paused`; the viewport re-applies the store's pause flag whenever the store changes (a toast appearing or expiring), which silently resumed the runner and added real-time ticks. This made M5/M6 specs flaky under load.

## D012 - AI and combat (M7) (2026-10-16)
- **Combat is plain behaviours over a small Health model**: `damage()`/`heal()` are ordinary functions (event rows, melee, touch damage and bosses all use them), invulnerability frames and knockback live in the Health state, and "who can hurt whom" is a `hurts` filter against each object's side (the player is on the player's side, everything else is an enemy unless set).
- **Guards are three cooperating behaviours, not one big brain**: Vision (a perception pass in the source phase) -> Chase (steering state machine idle/chase/search/return) -> Patrol (stays out of the way while `aiFlags.busy`). They share small flags (`busy`, `disabled`, `speedScale`, `damageScale`) so bosses and rooms can switch or tune them without knowing about each other. A visual state-machine editor for enemies is still owed.
- **A\* runs on cells with the same rules as the walk-test tool** (`cellWalkable`, `stepAllowed`), orthogonal moves only for walkers (diagonal paths clipped crates and wall corners), and a straight line is only used when it clears the walker's radius on both sides. Paths are recomputed every 0.5 s or when the goal cell changes; other solids are treated as blocked cells.
- **Vision uses the lighting model** (line of sight through occluders, darkness hides things unless close), so light and stealth interact without extra code.
- **Bosses are enemies with `bossPhases`** (it requires Health set to "stays down" so its Defeated signal survives); a boss "room" is a Region with `bossActive`.
- Pit falls: Health notices `body.state === 'pit'` (the 'fell' event is gone before the next tick), applies damage, and teleports back to a position recorded ~0.75 s earlier.
## D013 - Story systems (M8) (2026-10-16)
- **Inventory, flags and counters are all variables** (`item:<id>`, `slot:<n>`, `lit:<scene>:<id>`), so saving, event rows and dialogue conditions need no inventory-specific code. Item definitions are data (`assets/items.json`).
- **The simulation has three kinds of tick** (`Modal`): normal; *scripted* (a cutscene: the world moves, the player's controls do not); *freeze* (a conversation or menu is open: nothing that moves runs). Systems declare when they run (`always` / `gameplay` / `player`). Gameplay input is masked while something else has the controls, and a button held through the end of that moment stays ignored until released (so the Interact press that closes a conversation cannot reopen it). Menus, dialogue and cutscenes read `uiInput` (the real buttons).
- **Dialogue and cutscenes are data run by small systems** with plain-English checkers; the editor edits them as step lists (a visual node graph canvas is still owed). Cutscene steps can run "alongside the next", which gives tracks without a full timeline editor.
- **Scene changes are requests** (`runtime.travel`) carried out by the game host, which keeps flags, items, lanterns and health and replaces the world (`loadScene(..., { travel: true })`). Defeat in another scene's checkpoint works the same way.
- **Saves**: `serializeGame`/`applySave` over a versioned `SaveSchema`; objects tagged `persistent` keep their components and "gone" status; `SaveManager` keeps `.bak` copies and recovers from damaged files. Time stamps and labels come from the host (the simulation has no clock).
- **The game's own UI is a framework-free DOM layer in `packages/behaviors` (`GameUi`)** driven by a small host interface, so the editor's Play and exported games share it; `PlaySession` is the editor's host (scene loading, saves in the project's `saves/`, settings in `localStorage`). Replaces the React `PlayHud`.
- **Input**: gamepad state is read into the same raw-binding map as keys (`pad:button<N>`, `pad:axis<N>±`), defaults include a standard pad; `rebind` replaces bindings per device kind and removes a binding from other actions; settings store only the differences from the defaults.
## D014 - Checks, debugging and the playbot (M9) (2026-10-16)
- **Level analysis works on the scene data, not by running it**, using the engine's own walking rules (`cellWalkable`, `stepAllowed`) plus the player's jump (hop over a one-cell hole, climb ledges up to the jump height) and optimistic ledge drops. "Bypass" = a goal reachable with every gate closed; the check deliberately over-approximates what the player can reach, so a warning means "the engine allows this route". Goals are marked by tag (`goal`, `exit`, `reward`).
- **Crate puzzles are solved by exhaustive search over crate arrangements** (player region folded into the state), with reverse reachability to find positions from which no solution exists (soft-locks); capped at 60,000 arrangements and reported as "too big to check" beyond that.
- **The playbot only ever presses buttons** (`Bot.step`), through the real simulation: no teleporting, no reading hidden state beyond what the planner needs (obstacles, the map). Everything it does is recorded as an input recording, so a bot run can be kept as a playthrough and replayed deterministically.
- **Errors are wrapped where they happen**: `SystemError` carries the failing system (or behaviours phase) and the object, and the original stack; `crashReport` builds the headline, snapshot and text for the editor and, later, exported games.
- **The profiler is opt-in** (`sim.profiler.enabled`), wraps systems and per-behaviour calls, and is reset by whoever displays it; budgets are asserted in tests with best-of-N timing to be robust on busy machines.
- **Debug overlays share one drawing module** (`debug-draw.ts`) used for editor data and live objects; while playing they draw into their own layer above the world.
- Panels: Problems (scene + puzzle + whole project + crash) and Playbot; puzzle checks run quickly after every save and fully on demand.
## D015 - The code window (M10) (2026-10-16)
- **A script is a behaviour.** `defineScript` registers a `BehaviorDef` with id `script_<Name>` (category "Scripts"), so the Add menu, Inspector settings, wires and prefabs work with no extra editor code, and the same registry that serves built-ins serves scripts. Reloading = re-registering; running objects use the new definition on the next tick (their `me.state` survives).
- **Scripts are plain TypeScript modules compiled in the app.** The `typescript` package transpiles them (loaded lazily the first time a project has scripts), a source-map decoder maps runtime errors back to the user's lines, and each runs as an ES module imported from a blob URL (data URL under Node, which keeps loading unit-testable). Monaco shows the engine's API from `packages/behaviors/src/scripting/api.ts` (the same file is the documentation), via `?raw`, as ambient declarations.
- **Parity with no-code**: `game.do/test` expose every event-sheet action and condition registry entry, and "Convert to code" generates a script from the sheet; a unit test checks the generated script behaves like the rows.
- **Breakpoints** insert `__bp(line)` calls at the start of validated statements; a hit pauses the game after the current tick (the simulation is deterministic and not re-entrant, so we do not suspend mid-tick) and keeps `me`/`game` for the watch window. Watch expressions compile to tiny blob modules.
- **The renderer CSP was relaxed** to allow `blob:` scripts and workers (`script-src 'self' blob:`, `worker-src 'self' blob:`, `connect-src 'self' blob:`) for Monaco's workers and user scripts. Everything else stays `'self'`.
- **Scripts are not sandboxed.** They run in the game's own JS context with the user's privileges (the renderer has no Node access, so this is "can break your game", not "can read your disk"). Documented as a known limit; a worker-based sandbox is possible later but costs the live `me`/`game` objects.
- **Settings that must survive a crash-start live in the app settings file, not `localStorage`**: after a hard kill the first `localStorage` read stalled startup for ~5 s, so breakpoints are stored there instead.
- The Play controls are shown in the Code window; Play from there switches to the World view first (the viewport hosts the game).

## D016 - The Claude assistant (M11) (2026-10-16)
- **All API calls happen in the Electron main process** with the official `@anthropic-ai/sdk`; the renderer only gets chat text, tool requests and usage numbers over IPC. The key is stored with `safeStorage` (OS keychain) in `userData/assistant-key.bin`, never returned to the renderer, never in settings/projects/logs. If no keychain exists the key is refused, not stored in plain text.
- **`packages/assistant` is Electron-free** (prompt, Zod tool schemas, `Conversation` loop, model table, diff, cost). The SDK client lives in `sdk-client.ts`, imported only by main, so the renderer bundle has no SDK. The loop talks to a small `ModelClient` interface, which is how unit tests script the API.
- **Models are named in one file** (`models.ts`: default `claude-opus-5-5`, plus Sonnet 5.5, Haiku 5.5, Fable 5.1); the user picks in the panel. Adaptive thinking with `display: "summarized"`, explicit `effort` (default high), streaming with `eager_input_streaming` on every tool, `max_tokens` 64k.
- **Prompt caching by construction**: top-level `cache_control`, a system prompt with nothing request-specific, a tool list built deterministically, project facts in the first user message only, and an append-only message list (assistant content, including thinking blocks, is passed back verbatim). Tests check the prefix is byte-identical between requests; usage shows cache-read tokens.
- **Tool inputs are validated with Zod before anything runs** (errors are returned to Claude as `is_error` results so it can correct itself); `stop_reason` `refusal` and `max_tokens` are handled before tools run (a cut-off reply's tool calls are answered with an error, not run); all results of one reply return in a single user message; a step cap of 30 bounds cost.
- **Every change is a proposal**: `prepareAction` checks it against the live scene (names, behaviour ids, setting keys, signal names, tile ids, event block ids and parameters) and produces plain-English lines and a diff; `apply` runs inside `doc.history.batch` so it is one undo step. Proposals are prepared and shown one at a time in the order Claude asked, because a later one can refer to what an earlier one creates. Scripts and notes carry their own undo.
- **Refusal fallback**: `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) is on by default as the API guidance recommends, with a setting to turn it off and an automatic retry without it if the API answers 400 about it. Not verified against the live API (no key in this environment): see KNOWN_ISSUES.
- **Errors use the SDK's typed classes** (`friendlyError`), with a Retry button that resumes the last message without re-sending a new one.
- **A custom endpoint** (`TILEWRIGHT_ASSISTANT_BASE_URL`) exists for tests and proxies; the panel states when it is in use.

## D017 - Export and packaging (M12) (2026-10-16)
- **An exported game is the Electron runtime the editor itself runs on, plus a small game shell**: the export copies the folder of `process.execPath` (dev or installed editor), leaves out the editor's own code (`resources/app*`), renames the program to the game's name, and adds `resources/app/` with `game-main.mjs`, `game-preload.cjs`, the player page (`player/`) and the game's files under `data/`. Nothing is downloaded at export time, so exporting works offline and the editor never carries a second copy of Electron. Exports are only possible for the platform the editor runs on (Windows, Linux); macOS is not implemented.
- **The game shell is separate from the editor** (`src/game`, `src/player`): its own main process (window from `game.json`, F11 fullscreen, its own userData with `saves/` and `logs/`), a preload that exposes only the same `fs` bridge the editor's loaders already use (read: game data and saves; write: saves only), and a player page that reuses `PlaySession`, so the exported game behaves exactly like Play in the editor. The player page is built by a second Vite config next to the editor and copied into every export.
- **Scripts are compiled at export time** with the editor's own transpile path and shipped as `scripts.json` (JS plus source maps); the game loads them through `loadScript` with a pre-compiled "transpiler", so the TypeScript compiler is not shipped and script errors still name the author's line.
- **Export refuses on errors**: it saves the open scene, runs the whole-project check, checks the settings and icon and compiles every script; errors disable the Export button, warnings do not. The main process re-validates every path (inside the chosen project and output folders, no `..`) and will only replace a folder that carries its own marker file.
- **Crashes in exported games**: `PlaySession.onError`, window errors and unhandled rejections show a friendly screen with the cause and write a log in the game's `logs` folder; a failure in the main process writes a log and shows a message box; missing or damaged game files say so.
- **The zip** is made with the Windows `tar.exe` (bsdtar writes zip) or `zip` on Linux, named by full path so a GNU tar earlier in PATH (Git) cannot break it. A failed zip does not fail the export.
- **The editor installer** uses electron-builder with an exact Electron version and `electronVersion` set (a range fails inside a workspace); renderer-only packages are devDependencies so they are not packed twice (the bundles already contain them).
- **The tests clean up after themselves** (`e2e/clean-temp.ts` as global setup and teardown): an export test makes hundreds of megabytes per run, and 535 leftover temp folders had filled the disk.

## D018 - Acceptance slice and what it changed in the checks and the bot (M13) (2026-10-16)
- **The slice is built by `e2e/m13-acceptance.spec.ts` through the UI only**, then judged by the same validators a user has and played by the same `Bot` the Playbot panel uses; the bot's walkthrough script lives in `e2e/slice-bot.ts` and plays the files on disk headless (so it plays what an export would ship).
- **Objects are placed with the mouse and then given exact positions in the Inspector**: tall walls hide cells from the mouse, so a click can land on the wrong cell. Terrain that overlaps (pits) is painted before walls are raised.
- **`Game` can run several scenes** (`scenes` map, `enterScene`, travel requests handled in `step`), replicating what `PlaySession` does for a portal or fast travel; `walkTo` returns as reached when a scene change happens on the way.
- **`Bot.fight`** walks up (round walls) and swings until the target is defeated or gone; `walkTo` recentres on the cell when it is wedged on a corner.
- **Text bridges are modelled** (`textBridgeCells`): a text block's footprint counts as walkable over a pit or water when it starts underlined, the player can format it, or a wire underlines it. The walkers (`findPath`/`reachableCells`/`reachCells`) take a `bridges` set; the bot passes the cells of blocks that are underlined right now.
- **A gate is judged useful if opening it changes where the player can go with the other gates shut or with them open**, which handles both a doorway filled by two gates and gates in a row.
- **Crate puzzle analysis**: targets are only plates a crate could be pushed onto; the player's position can be given; if the puzzle looks unsolvable because the player starts behind closed gates, it is tried again with the gates open (the player is assumed to have got there).
- **Event-sheet checks know which flags conversations and cutscenes set** (`storyVariables`).

## D019 - Hit feel, sound and the sample game (M14) (2026-10-16)
- Hit-stop is not part of the simulation. The simulation records a request (`runtime.hitStop`, `runtime.fx`, `view.impact`); the game window (`GameRunner`) holds off stepping for those frames and draws sparks. Putting a freeze inside `Simulation.step` made every tick-counted test, the playbot and recorded playthroughs depend on it (7 unit tests failed on the first try), and gave nothing a player could see.
- Effects never enter the replayable state (not in `stateHash`, not in saves). The queue is capped, so a headless run that never drains it cannot grow without bound.
- Sounds are plain files in `assets/audio`, named by their file name. There is no sound database or mixer UI: an event, cutscene or region asks for a name; a missing file is a Problems-panel warning, never a crash. The names `hit`, `hurt` and `defeat` play automatically during fights.
- The editor and the exported game share one `AudioEngine` through `PlaySession`, so exported games have sound with no extra code. Autoplay is allowed in both Electron windows so music can start before a key is pressed.
- The sample game is the acceptance slice itself, regenerated from `e2e/m13-acceptance.spec.ts` (`TILEWRIGHT_SAMPLE_OUT`), so it cannot drift from what the tests build. It is copied, not opened in place.