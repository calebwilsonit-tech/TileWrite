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
