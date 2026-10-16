# Tilewright progress

Boxes are ticked only when the milestone's tests pass and the sample has been played.
Spec: `ENGINE_BUILD_PROMPT.md`. Read `DECISIONS.md` and `KNOWN_ISSUES.md` before continuing.

**Next up:** M5 no-code logic - the behaviour framework (a behaviour = named settings + a system, shown in the inspector), the built-in behaviours (Pushable, Pressure Plate, Gate/Door, Lever, Timer, Spawner, Pickup, Patrol, Health, Damage on Touch, ...), event sheets (When condition -> do action, in plain English), wires with logic nodes, prefabs with overrides, entities as platforms (crates you can stand on, moving platforms), and the sample: a plate opens a gate, a crate can be pushed onto the plate. Owed earlier: pit damage (M7), autotiling rules + Decoration/Walls layers (needs art; revisit in M5/M14), hot reload while playing and a separate game window (M10 / M14), vector drawing in the studio (M14).

## Milestones

- [x] M0 Foundations (repo, workspaces, lint, typecheck, tests, CI, Electron window, state docs)
- [x] M1 Runtime core (iso math, scene/ECS, renderer + depth sort, camera, input, fixed timestep)
- [x] M2 Heights and collision (stairs, cliffs, pits, falling, occlusion fade)
- [x] M3 Editor shell + world painter (see the M3 checklist: what is done and what was deliberately deferred)
- [x] M4 Sprite studio (see the M4 checklist for what is deferred)
- [ ] M5 No-code logic (behaviours, inspector, event sheets, wires)
- [ ] M6 Echoes, light, puzzle parts
- [ ] M7 AI and combat
- [ ] M8 Story systems
- [ ] M9 Errors and debugging (problems panel, overlays, profiler, validators, playbot)
- [ ] M10 Code window
- [ ] M11 Claude assistant
- [ ] M12 Export and packaging
- [ ] M13 The acceptance game
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
- [ ] Asset import and asset browser (M4); "Explain / Fix with Claude" buttons (M11)
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