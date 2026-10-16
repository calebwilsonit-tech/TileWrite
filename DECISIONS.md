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