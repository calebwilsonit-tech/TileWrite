# Prompt: build "Tilewright", a no-code 2D isometric game engine

> Paste everything below the line into a fresh Claude Code session that is
> pointed at a **new, empty repository**. It is written so Claude can work on
> it for a very long time, across many sessions, without you steering.
> "Tilewright" is a placeholder name; change it if you like.

---

## 0. Who you are and how to work

You are the lead engineer, designer and QA team for **Tilewright**, a desktop
game engine for making **2D isometric games without writing code**. Think
"Unreal Engine, but only for 2D isometric games, and friendly enough that a
designer who has never programmed can ship a whole game".

You have as long as you need. Do not rush, do not stub things out and call
them done, and do not stop at a plan. Build it, run it, test it, fix it, and
keep going milestone after milestone until every acceptance criterion in
section 12 passes.

### Working rules (follow these for the whole project)

1. **Keep state on disk so any session can resume.** Maintain these files at
   the repo root and update them every time you finish a piece of work:
   - `PROGRESS.md` - the milestone checklist from section 11 with each box
     ticked only when its tests pass, plus a "Next up" line.
   - `DECISIONS.md` - every architectural choice, the options you rejected,
     and why. Append, never rewrite history.
   - `KNOWN_ISSUES.md` - bugs you found and have not fixed yet.
   - `docs/` - user documentation, written as you build each feature.
   At the start of every session, read these four first, then continue from
   "Next up". Never redo finished work.
2. **The loop for every feature:** design it in a few lines in `DECISIONS.md`
   -> write it -> write tests -> run the tests -> launch the editor and use the
   feature for real (Playwright drives the Electron window; take screenshots
   and look at them) -> fix what is wrong -> update docs -> commit with a clear
   message -> push.
3. **Small commits, always green.** `npm test` and `npm run typecheck` must
   pass before every commit. If something is half-finished, keep it behind a
   feature flag rather than committing broken code.
4. **Honesty.** If a test fails, say so. If you skipped something, write it in
   `KNOWN_ISSUES.md`. Never tick a box you did not verify.
5. **No-code first.** Every feature must be usable entirely through the UI.
   Code is an optional power tool, never a requirement. When you design a
   feature, ask: "Could a designer who has never programmed do this?" If not,
   redesign it.
6. **Play what you build.** After each milestone, build a tiny sample game
   with the engine's UI (not by hand-editing files) and play it with the
   playbot (section 8). If the sample cannot be made in the UI, the milestone
   is not done.
7. **Think about every part.** Before each milestone, write a checklist of
   every sub-feature, edge case, failure mode, undo case, save/load case and
   keyboard shortcut it needs, then build all of it. Section 3-10 list the
   minimum; add anything else a real engine would need.

## 1. The goal in one paragraph

A designer opens Tilewright, creates a project from a template, paints an
isometric world with height levels, stairs, cliffs and water, draws and
animates characters in the built-in sprite studio, drags behaviours onto
objects ("Player Controller", "Patrols", "Pushable", "Pressure Plate",
"Door opens when..."), wires up puzzles with visual event sheets, writes
dialogue in a node graph, presses **Play** to test inside the editor, gets
clear plain-English errors when something breaks (with an "Ask Claude" button
that explains and fixes it), and finally clicks **Export -> Windows** to get a
`.exe` they can give to friends.

## 2. The reference game (what the engine must be able to make)

The engine must be able to rebuild **The Last Storytender**, a Godot game this
prompt was written from. Every feature below must be possible without code:

- **Isometric world:** 64x32 diamond tiles, multiple height levels per cell,
  stairs/ramps between levels, cliffs, pits you can fall into (fall
  animation, damage, respawn), water, bridges, walls that fade out when the
  player walks behind them (occlusion fade), correct depth sorting of tall
  objects, characters and props at every height.
- **Player:** 8-direction movement, walk/run, dodge, a melee weapon (a quill),
  health, a light/resource bar, interact button, quick-slot items.
- **Echoes:** record the player's movement for up to N seconds, then replay
  it as a ghost that can stand on pressure plates. Several echoes at once;
  capacity upgradable by a story flag. Ghosts pass through some gates.
- **Puzzle parts:** pressure plates (momentary or latched), gates/doors
  linked to plates or logic, pushable crates, levers, timers, sentence
  stones (a text sign whose swappable word changes the world: "The bridge
  [BREAKS / HOLDS]"), text blocks that can be formatted (underline makes a
  bridge, bold makes a wall, italic makes it slide), rising dough that grows
  over time and grows faster near light.
- **Light:** a lantern that lights a radius, dark areas, lights that affect
  puzzle objects, dynamic 2D lighting with shadows.
- **Enemies and bosses:** patrol paths, vision cones (stealth), hearing,
  chase/search/return states, A* pathfinding on the iso grid with heights,
  boss fights with phases, boss only active in certain rooms.
- **Story:** NPC dialogue with choices, conditions and flags; cutscenes on a
  timeline (camera moves, character moves, dialogue, fades); a hub overworld
  with several dungeons; a world map with fast travel.
- **Checkpoints:** lantern posts you light or rest at; death sends you to the
  most recent post you lit/rested at; dungeon pause menu has Restart and
  Travel-to-lit-lantern.
- **Systems:** inventory, items, quick slots, save/load with multiple slots
  and autosave, story flags and counters, settings menu (audio, video,
  controls), full input remapping, gamepad support, pause menu, HUD,
  minigames inside the game, cosmetic skins, difficulty options.
- **Feel:** screen shake, hit-stop, particles, tweens, sound effects with
  variation, music with crossfades, camera follow with deadzone and room
  bounds.

Keep this list in `docs/reference_game.md` and tick each item off as the
engine gains the ability to make it.

## 3. Technology (decide quickly, then commit)

Recommended stack (you may change it, but write the reason in
`DECISIONS.md`):

- **Electron + TypeScript + React** for the editor shell (one codebase,
  builds a Windows `.exe` with `electron-builder`).
- **PixiJS (WebGL)** for rendering in both the editor viewport and the game
  runtime.
- **Monaco** for the code window.
- **Vite** for building, **Vitest** for unit tests, **Playwright** for
  end-to-end tests of the editor window and of exported games.
- **Zod** for validating every project file and every tool input.
- Project files are **plain JSON** (and PNG for images, OGG/WAV for audio),
  human-readable and diff-friendly, with a `schemaVersion` and migrations.
- The **runtime** (what ships inside an exported game) is a separate package
  that does not include any editor code.

Repo layout (monorepo with npm workspaces):

```
packages/
  runtime/      game engine core: scene, ECS, renderer, physics, audio, input, save
  behaviors/    built-in no-code behaviours (Player Controller, Patrol, Plate, ...)
  editor/       Electron app: shell, panels, tools
  assistant/    Claude integration (section 9)
  playbot/      automated player and puzzle solver (section 8)
  exporter/     builds standalone games
templates/      starter projects (empty iso, top-down action, puzzle dungeon)
samples/        sample games built through the UI, used as tests
docs/
```

## 4. Runtime (the engine core)

Build each of these as its own module with unit tests:

1. **Scene and entities.** Scenes contain entities; entities have components
   (Transform-Iso, Sprite, Animator, Collider, Light, Behaviour list, Script,
   Audio Source, UI). Prefabs with overrides and nested prefabs. Groups/tags.
   Spawning and destroying at runtime, with safe references (a destroyed
   entity must never crash a loop that still holds it).
2. **Isometric math.** Grid <-> screen <-> world conversions, configurable
   tile size (default 64x32), height levels (configurable pixels per level),
   cell queries, neighbours, line-of-sight on the grid.
3. **Renderer.** Tile layers, height-aware depth sorting (sort by
   iso depth + height + per-object sort offset; handle large multi-cell
   objects), occlusion fade for walls in front of the player, sprite
   batching, camera (follow, deadzone, bounds, zoom, shake), pixel-perfect
   option, post effects (vignette, colour grade, flash).
4. **Lighting.** Ambient darkness per region, point lights with radius and
   colour, light occluders from walls, light queries ("is this cell lit?")
   usable by behaviours.
5. **Physics and collision.** Height-aware collision: an entity at height 2
   ignores walls at height 0; stairs move you between heights; ledges and
   pits; trigger areas; push/slide; one-way edges; layers and masks.
   Deterministic fixed timestep (60 Hz) so recordings and playbots replay
   exactly.
6. **Input.** Actions not keys ("move", "interact", "echo", "attack"),
   keyboard + mouse + gamepad, rebinding saved per player, input recording and
   playback (used by echoes and the playbot).
7. **Animation.** Sprite-sheet animations, 8-direction sets, animation state
   machine (idle/walk/attack/hurt with transitions and conditions), animation
   events (play sound, spawn hitbox on frame N), tweens with easing.
8. **Audio.** Sound effects with random pitch/volume, music tracks with
   crossfade and loop points, buses (master/music/sfx/voice) with volume
   settings, positional falloff.
9. **AI.** A* on the iso grid with heights and stairs, patrol paths, vision
   cones blocked by walls and darkness, hearing radius, a state machine and a
   behaviour-tree option, all editable visually.
10. **Logic.** Signals/events, timers, story flags and counters, variables
    (global, scene, entity), conditions and actions (the same building blocks
    the no-code editor uses).
11. **Dialogue and cutscenes.** Dialogue graphs (lines, choices, conditions,
    set flag, give item, jump), a timeline player for cutscenes (tracks for
    camera, entities, animation, dialogue, audio, fades, wait-for-input).
12. **UI.** HUD widgets (bars, icons, counters, text), menus (main, pause,
    settings, save slots), focus navigation with keyboard/gamepad, themes,
    fonts, text with inline formatting.
13. **Save system.** Save slots, autosave, what to save (flags, inventory,
    position, entity states marked "persistent"), versioned save format with
    migrations, corrupted-save recovery.
14. **Localization.** All player-visible text in string tables; language
    switch at runtime.
15. **Performance.** 60 fps with 5,000 tiles and 200 entities on a mid-range
    laptop; a profiler overlay; budgets enforced by tests.

## 5. Editor (the no-code tools)

### 5.1 Shell
Project manager (new from template, open recent, import), dockable panels
with saved layouts, global undo/redo for every action, autosave and crash
recovery, command palette, keyboard shortcut editor, light/dark theme, hot
reload (change anything while the game is running in the editor and see it
update), **Play / Pause / Step frame / Stop** inside the editor with the game
in a panel or a separate window, and "Play from here" (start the game at the
mouse position).

### 5.2 World builder / painter
- Brushes: single tile, rectangle, line, flood fill, eraser, random scatter,
  pattern stamp; tile picker with search.
- Height tools: raise/lower brush, set height, smooth, and dedicated
  **stair**, **ramp**, **cliff** and **pit** tools that create the correct
  tiles and collision automatically.
- Autotiling rules (edges, corners, cliff faces, water shores) that the user
  can edit visually.
- Layers (ground, decoration, walls, objects, lights, regions) with
  visibility/lock toggles.
- **Collision painting:** view and paint collision per cell and per height,
  auto-generate collision from tiles, colour overlay showing walkable /
  blocked / pit / stair / trigger, and "walk test" mode where you click a
  cell and see where the player could reach from there.
- Regions/rooms (camera bounds, music zone, darkness, "boss active here").
- Place entities and prefabs by drag and drop, snap to grid, rotate between
  the 4 iso facings, multi-select, copy/paste across scenes.
- Procedural helpers: fill room, scatter props, generate a corridor between
  two points.
- **Level validators** (run on save and on demand): unreachable areas,
  doors that lead nowhere, plates with no target, puzzles that can be
  bypassed (path to the reward exists without solving the puzzle), objects
  blocking a required landing, missing spawn point, soft-locks.

### 5.3 Sprite studio (sprite maker and animator)
Pixel and vector drawing with layers, palette management, shapes, fill,
selection and transform tools, symmetry, **iso guide grid** and an
"iso box" helper to draw blocks at the right angles, onion skinning, timeline
with frame durations, 8-direction animation sets with "mirror left/right" to
save work, set origin/feet point, hitboxes and hurtboxes per frame, export to
sprite sheets with automatic packing, import PNG/Aseprite files, and a
"procedural shape" mode (build sprites from parametric shapes like the
reference game does in code, but with sliders).

### 5.4 No-code logic
- **Behaviour library** (drag onto entity, tweak in the inspector): Player
  Controller, Follow Camera, Patrol, Chase, Vision Cone, Health, Damage on
  Touch, Pushable, Pressure Plate, Gate/Door, Lever, Timer, Spawner, Pickup,
  Lantern Post / Checkpoint, Light Source, Echo Recorder, Sentence Stone,
  Formattable Text Block, Growing Object, NPC Talk, Scene Portal, Moving
  Platform, Falling Floor, Projectile, Boss Phases.
- **Event sheets** (like Construct/GDevelop): "When [condition] -> do
  [action]" rows with sub-events, AND/OR, variables, loops, picking entities;
  readable in plain English; every built-in condition/action documented
  in-place.
- **Visual state machines** for enemies, bosses and puzzles.
- **Wires:** draw a line from a plate to a gate to link them, with logic
  gates (AND/OR/NOT/latch/delay) as nodes.
- Everything the no-code layer does must also be available to scripts.

### 5.5 Code window
Monaco editor with TypeScript, autocompletion and inline docs for the whole
engine API, a script component that attaches to any entity, live reload,
breakpoints and a variable watch while the game runs in the editor, a
console, and "convert this event sheet to code" for users who want to learn.

### 5.6 Other editors
Dialogue graph editor (with preview player), cutscene timeline editor, UI
layout editor (anchors, themes, previews at different resolutions), audio
mixer, input map editor, inspector for every component, asset browser with
thumbnails, search, tags and "find references", world map editor for fast
travel, string table editor, project settings.

## 6. Errors and troubleshooting

- **Problems panel**: every error and warning, in plain English, with "go to"
  links that select the entity, tile or event row that caused it.
- Runtime errors never crash the editor; the game pauses, the panel shows
  what happened, the call stack, and a snapshot of relevant state.
- Crash reports in exported games: write a log file and show a friendly
  screen.
- Profiler: frame time, draw calls, entity count, slowest behaviours.
- Debug overlays toggled from a menu: collision, heights, depth order, AI
  paths and vision cones, light radius, trigger areas, plate links.
- Validators from 5.2 plus a project-wide check before export.
- Every error has an **"Explain"** and **"Fix with Claude"** button
  (section 9).

## 7. Export

- **Export -> Windows** produces a standalone `.exe` (and a zip) containing
  only the runtime and the game's assets. Also Linux and macOS when built on
  those systems.
- Settings: game name, icon, version, window size, fullscreen default, splash
  screen.
- Export runs the project-wide validators first and refuses to export with
  errors (warnings allowed).
- Exported games must run with no editor installed and no internet.
- Provide `npm run dist:win` to build the **editor itself** as a Windows
  installer/`.exe`. Document in `docs/BUILDING.md` exactly how the user
  compiles it on their own Windows PC (install Node LTS, `npm ci`,
  `npm run dist:win`, where the `.exe` appears). Test the Windows build in CI
  with a GitHub Actions `windows-latest` job if available.

## 8. Playbot (automated testing for games made with the engine)

A bot that plays the game with the **same inputs a player has** (no
teleporting): a goal-driven path follower, a puzzle solver that searches
plate/echo/push combinations for small rooms, "play this level start to
finish" scripts the user can record by playing, and reports
("reached the exit in 2m10s", "stuck at cell (20,12) for 30 s", "puzzle
solvable without using the plate - bypass!"). Used by the validators, by
the test suite, and by the Claude assistant.

## 9. Claude inside the engine

An **Assistant panel** where the user chats with Claude about their project,
and Claude can look at and change it.

### 9.1 What Claude can do (tools exposed through an Editor API)
- Read: project files, the current scene as JSON, selected entity, event
  sheets, scripts, errors from the problems panel, profiler data, validator
  results, a **screenshot of the viewport**.
- Act: create/modify entities, tiles, behaviours, event rows, dialogue,
  scripts; run the game; run validators; run the playbot; run tests.
- Every change Claude proposes is shown as a **diff/preview** the user
  approves or rejects, applied as a single undo step, and can be reverted.
- Modes: "Explain", "Fix this error", "Build this for me" (e.g. "make a room
  where two echoes must hold two plates at once"), "Review my level".

### 9.2 How to integrate (Claude API)
Before writing this part, load the **claude-api** skill (or read the official
Anthropic docs) and follow it exactly; do not write SDK calls from memory.
Requirements:
- Use the official TypeScript SDK `@anthropic-ai/sdk`, called from the
  Electron **main process** (never from the renderer).
- Use the current recommended default Claude model at build time (look it up
  in the claude-api skill or the Models API) and let the user pick a model in
  settings. Do not hard-code a model name anywhere except one config default.
- Stream responses; use adaptive thinking and expose an "effort" setting.
- Define editor tools with JSON schemas; validate every tool input with Zod
  before running it; check `stop_reason` (`refusal`, `max_tokens`) before
  running tools; return parallel tool results together.
- Use prompt caching: keep tool definitions and the system prompt stable so
  they cache; put project context after the cached prefix; verify cache hits
  in usage stats.
- The user supplies their own API key in settings; store it with the OS
  keychain (Electron `safeStorage`), never write it into project files, logs
  or exported games, and never send it anywhere but the Anthropic API.
- Handle errors with the SDK's typed error classes: rate limits, network
  failures and overloads show a friendly message and a retry button.
- Show token usage and estimated cost per conversation.
- Assistant works offline-gracefully: if no key or no internet, the rest of
  the engine is unaffected.
- Include a "project memory" file Claude reads at the start of each chat
  (game design notes, rules like "no puzzle may be bypassable").

## 10. Documentation and onboarding
Interactive first-run tutorial that builds a tiny room with a plate and a
gate, a manual for every panel and behaviour, short "recipes" (stealth
enemy, echo puzzle, boss fight, NPC with choices, save point), and an API
reference generated from the code.

## 11. Milestones (do them in order; each ends with a playable sample)

- **M0 Foundations:** repo, workspaces, lint, typecheck, tests, CI, Electron
  window opens, `PROGRESS.md`/`DECISIONS.md` created.
- **M1 Runtime core:** iso math, scene/ECS, renderer with depth sort, camera,
  input, fixed timestep. Sample: a square walking on a tiled floor.
- **M2 Heights and collision:** heights, stairs, cliffs, pits, falling,
  occlusion fade. Sample: a multi-level room.
- **M3 Editor shell + world painter:** panels, undo/redo, brushes, height
  and stair tools, collision painting, play-in-editor. Sample built in UI.
- **M4 Sprite studio:** drawing, animation, 8-direction sets, export sheets.
  Sample: a character drawn and animated in the studio walks the room.
- **M5 No-code logic:** behaviour library, inspector, event sheets, wires.
  Sample: a plate opens a gate; a crate can be pushed onto the plate.
- **M6 Echoes, light, puzzle parts:** echo recorder, lighting, sentence
  stones, formattable text blocks, growing objects. Sample: a two-echo
  puzzle room.
- **M7 AI and combat:** pathfinding, patrols, vision cones, health, damage,
  boss phases. Sample: a stealth room and a small boss.
- **M8 Story systems:** dialogue graph, cutscene timeline, flags, inventory,
  save/load, checkpoints/respawn/restart, world map + fast travel, menus,
  settings, input remap, gamepad.
- **M9 Errors and debugging:** problems panel, overlays, profiler,
  validators (including bypass and soft-lock detection), playbot.
- **M10 Code window:** Monaco, engine API types, script components,
  breakpoints, console.
- **M11 Claude assistant:** panel, tools, diff approval, key storage,
  streaming, caching, error handling.
- **M12 Export and packaging:** game export to `.exe`, editor installer,
  `docs/BUILDING.md`, Windows CI job.
- **M13 The acceptance game:** rebuild a vertical slice of The Last
  Storytender using only the editor UI (section 12).
- **M14 Polish:** onboarding tutorial, docs, templates, performance pass,
  accessibility (font scaling, colour-blind-safe overlays, remappable
  everything).

## 12. Acceptance criteria (the project is done when all are true)

1. A new user can follow the tutorial and make a playable room in under 15
   minutes without touching code.
2. Using **only the editor UI**, you (Claude, driving the editor through
   Playwright like a user) build a vertical slice of The Last Storytender: a
   hub area, one dungeon with height levels and stairs, an echo puzzle with
   two plates and a gate, a crate puzzle, a sentence stone that changes a
   bridge, a lantern post checkpoint with death-respawn and a pause menu with
   Restart/Travel, a stealth enemy with a vision cone, a small boss with two
   phases, an NPC conversation with a choice that sets a flag, save/load,
   and a settings menu with input remapping.
3. The playbot finishes that slice from start to end, and the validators
   report no bypassable puzzles and no soft-locks.
4. The slice exports to a Windows `.exe` that runs with no editor installed
   (verified in the Windows CI job, or documented manual steps if CI is not
   available).
5. All unit, end-to-end, golden-screenshot and determinism tests pass; the
   slice runs at 60 fps within the performance budget.
6. The Claude assistant can (a) explain a deliberately broken event sheet,
   (b) fix it via an approved diff, and (c) build a new plate-and-gate room
   from a one-sentence request, all verified by tests that mock the API plus
   one optional live test the user can run with their key.
7. `docs/` explains every panel, behaviour and recipe; `docs/BUILDING.md`
   explains how to compile the editor `.exe` on Windows.

When all seven are true, write a final summary in `PROGRESS.md`: what was
built, what is known to be weak, and what you would do next.
