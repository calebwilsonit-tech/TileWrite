# Tilewright progress

Boxes are ticked only when the milestone's tests pass and the sample has been played.
Spec: `ENGINE_BUILD_PROMPT.md`. Read `DECISIONS.md` and `KNOWN_ISSUES.md` before continuing.

**Next up:** M8 story systems - NPC dialogue with choices, conditions and flags, cutscenes on a timeline, inventory/items/quick slots, checkpoints (lantern posts) and respawn at the last one, scene portals, hub overworld/world map, save/load slots, pause menu and HUD. Owed earlier: autotiling rules + Decoration/Walls/Lights layers, hot reload while playing and a separate game window (M10 / M14), vector drawing in the studio (M14), bypass/soft-lock validators (M9), a visual state-machine editor for enemies (M9/M14).

## Milestones

- [x] M0 Foundations (repo, workspaces, lint, typecheck, tests, CI, Electron window, state docs)
- [x] M1 Runtime core (iso math, scene/ECS, renderer + depth sort, camera, input, fixed timestep)
- [x] M2 Heights and collision (stairs, cliffs, pits, falling, occlusion fade)
- [x] M3 Editor shell + world painter (see the M3 checklist: what is done and what was deliberately deferred)
- [x] M4 Sprite studio (see the M4 checklist for what is deferred)
- [x] M5 No-code logic (see the M5 checklist for what is deferred)
- [x] M6 Echoes, light, puzzle parts (see the M6 checklist)
- [x] M7 AI and combat (see the M7 checklist)
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