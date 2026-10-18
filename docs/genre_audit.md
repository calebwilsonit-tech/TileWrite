# Genre audit: what the engine assumed about the game, and what changes

Written at the start of phase 2 (2026-10-18), before any change, by reading the code. The first build was shaped by one reference game, *The Last Storytender* (an action-adventure puzzle game). The goal is a general isometric engine. This page says where the shape shows, what should stay in the core, what becomes an optional module or a pack, and what each of the eight proof games needs that is missing.

Verdicts: **core** (genuinely general, stays), **module** (general but optional: a project turns it on and can strip it), **pack** (belongs to one game; moves into the "Storytender" behaviour pack that loads like any plugin), **new** (does not exist yet).

## 1. What assumes a kind of game

### The controlled character and the camera
| Where | Assumption | Verdict |
| --- | --- | --- |
| `tags: ['player']` is read in about 40 places (`ai`, `puzzle`, `story`, `text`, `events/sheet`, `script`, `director`, `inventory`, `game-ui`, `play-session`, `controller`, `playbot/game`, `save`, `crash`, validators) | There is exactly one player entity and it exists | **core, but renamed in meaning**: the tag stays as "the entity this player controls" (so every saved file works) and nothing may require it. A scene with no `player` plays (camera free, no HUD hearts). Several controlled entities and none are both legal. |
| `validate.ts` "no player start" is an error; Play refuses to start without one | A game is a player on a map | **core**: becomes a warning that only appears when the project uses a control scheme that needs a player |
| `templates.ts` `empty-iso` creates a player; every sample has one | An empty project is playable | **new**: a truly empty template (grass, a camera, nothing else) plus genre templates |
| `runner.follow` follows one entity id | One followed entity | **module**: camera modes (follow, free pan, fixed, rotate between four views) as a control scheme |
| `player-controller.ts` (`move_*` actions, run, jump) is a core system, run with mode `player` | Direct 8-way control is how things move | **module**: becomes the "Direct control" scheme; `playerController` is one behaviour among several movers |
| Fixed action names (`move_left`, `interact`, `attack`, `dodge`, `echo`, `quick_1..4`) in `DEFAULT_INPUT_MAP` | Action game buttons | **module**: the map stays (it is data), but the Storytender pack contributes `echo`, `dodge`, `quick_*`; a new project starts with `move_*`, `interact`, `pause`, `confirm`, `cancel`, `pointer_*` only |

### Stats, damage and items
| Where | Assumption | Verdict |
| --- | --- | --- |
| `Health`, `Damage on Touch`, `Dodge`, `Melee Attack`, `Ranged Attack`, `Boss Phases`, `difficulty` (hard = 1.5x damage) | Everything can be hurt in real time | **module** "Combat": optional behaviours, none required by the core. `difficulty` becomes a plain setting any behaviour may read |
| `runtime.vars['item:<id>']`, quick slots `slot:1..4`, `story/items.ts`, `story/inventory.ts`, the inventory screen in `game-ui` | Carried items with four quick slots | **module** "Inventory": items stay data; quick slots and the screen are optional; a data table can replace items entirely |
| `Checkpoint` in `SceneRuntime`, "Lantern Post", respawn at the last lit lantern, `lit:` variables, `lightResource`, the lantern bar | Death sends you to a lantern | **pack** (Storytender). `SceneRuntime.checkpoint` stays as a generic "respawn point" field because saves use it; roguelikes can ignore it |
| `Light`, `Light Sensor`, `Growing Object`, `lighting.ts` shadows | Light is a puzzle mechanic | **module** "Lighting" (general: darkness, torches); `Light Sensor` and `Growing Object` move to the pack |

### Story machinery
| Where | Assumption | Verdict |
| --- | --- | --- |
| Echo Recorder, echo actions, `echo` input, `InputRecording` replays as characters | Recording yourself is a puzzle tool | **pack** (Storytender). The recorder/replay core (`InputRecorder`, `replayPlaythrough`) stays: the playbot needs it |
| Sentence Stone, Formattable Text Block, rising dough (Growing Object) | Words as walls | **pack** |
| Lantern Post, Cutscene Trigger, NPC Talk, Scene Portal, Minigame station | Story scaffolding | NPC Talk, Cutscene Trigger, Scene Portal, Minigame: **module** "Story" (dialogue, cutscene, minigame data stay in the core file formats but are optional). Lantern Post: **pack** |
| `GameUi` pause menu: Inventory, Travel to lit lanterns, Save slots, Settings, Controls | Every game has save slots and a story | **module**: the menu is a *screen defined by data* (see the UI designer); the built-in one becomes the default "Storytender screens" set shipped in the pack. A project with no screens shows nothing |
| Inline text formatting (`[b]`, `[color=]`) | Dialogue is formatted | **core**: tiny, general, safe |
| Skins, world map, minigames | RPG extras | **module** (data files that are simply absent in a new project) |

### Time and flow
| Where | Assumption | Verdict |
| --- | --- | --- |
| `Simulation.step` runs one fixed 60 Hz tick per real tick, `modal` is `none/scripted/freeze` | Real time is the only time | **new**: a *scene clock* with modes real-time, paused, sped up (1x/2x/4x/8x) and turn-based; `step()` is called by a clock that decides how many sim ticks a frame is worth. Determinism is kept (same inputs, same ticks) |
| Everything advances every tick (`gameplay` systems) | No notion of whose turn it is | **new**: a turn queue (initiative, action points, end turn) as a module; turn-based mode simply stops the real-time movement systems and advances only the active unit's action |
| `playbot` plays with a fixed set of buttons and a path planner for the player | One player, buttons only | **module**: the bot gains *pointer actions* (click a cell, click a widget, box-select) so it can play click-driven games, and a "turn bot" for tactics |

### World and rendering
| Where | Assumption | Verdict |
| --- | --- | --- |
| `TileMap`: one tile id and one height per cell, a column filled from the floor up, a single optional `deck`, per-cell `blockLow/blockHigh` | A world is a height map | **new**: *block stacks*: an optional per-cell list of individual blocks with gaps; the column model stays the cheap default and is converted on demand |
| `IsoRenderer` / `camera.ts`: one fixed view direction | A single iso view | **new**: four view rotations (rotate the grid before projecting; depth sort follows) |
| Tiles have colours and one `art` sprite for the top face | Box art | **new**: the tile studio (three face art, animation, variants, per-tile properties) |
| Objects are one cell with a 'collider' box | Everything is small | **new**: footprints larger than one cell, wall and floor attachments, tall props with sort points and fade parts |
| Scenes are small hand-built maps (32x32) | No large or generated worlds | **new**: chunked streaming for big maps, and a procedural generator driven by visual rules and a lockable seed |

### Editor
| Where | Assumption | Verdict |
| --- | --- | --- |
| Inspector "Add behaviour" menu lists every registered behaviour | Fixed set | **core**: lists whatever the enabled packs and project-made behaviours register |
| The Story panel (items, dialogues, cutscenes, minigames, map, skins, interface) | Story first | **module**: tabs appear only for the story module; a Data panel (tables) is added |
| Tools panel (stairs, cliff, pit, water, bridge, patrol...) | Fixed tools | **core** tools stay; the Plugin API lets packs add tools and panels |
| Assistant prompt describes echoes, lanterns, sentence stones, "a puzzle game" | Storytender | **core**: rewritten around what the project's packs and data actually contain |
| UI: `GameUi` is a hand-written DOM layer (hearts, slots, boss bars, toasts); `ui.json` only moves a few built-in pieces | A fixed HUD | **new**: the UI designer (widgets, layout, styles, states, binding, screens, flow) replaces the fixed HUD; the old pieces become widgets of the default screen set |
| Logic: event sheets, wires (OR only), state machines, behaviour trees | One style of logic | **new**: one underlying logic model (events, actions, wires, graph nodes) with three editing levels (Quick Actions, wires, graph) that convert to each other |

## 2. What stays in the core

Fixed-step deterministic simulation, entities with named components, the behaviour framework (phases, signals, wires), event sheets, state machines, trees, variables, the tile map with heights and slopes, physics and pathfinding, the isometric renderer, the sprite studio, saves, the input action map, scene and project formats, localization, the editor shell, the checker and playbot, export, the assistant. None of these mention a player, health or an inventory by name except where listed above as a rename or a move.

## 3. What becomes a pack or a module

- **Storytender pack** (`packs/storytender`, loaded through the same plugin API as any pack): Echo Recorder, echoes, Sentence Stone, Formattable Text Block, Growing Object, Light Sensor, Lantern Post, Light Resource and the lantern bar, `echo` and `dodge` actions, Boss Phases, the "quill" melee tuning, and the default story screens. The slice and the sample game load it; its tests must still pass.
- **Modules** (built into the engine, off in an empty project, on in templates that want them): Combat (health, damage, melee, ranged, dodge), Inventory (items, slots, pickups), Story (NPC talk, cutscenes, minigames, world map, skins, portals), Lighting, AI (patrol, chase, vision, trees), Control schemes, Turn system, Simulation helpers (resources, schedules, waves, flow fields, needs, automata, production).
- An empty project loads no module and no pack. A template turns on exactly the modules it uses and shows them in **Project settings -> Packs and modules** where each can be removed.

## 4. What each proof game needs that is missing

| Game | Needs (new unless noted) |
| --- | --- |
| **Tactics** | scene clock in turn mode, turn queue with initiative and action points, grid cursor control scheme, cell-locked movement with move range, attack range, height advantage (core heights exist), enemy turn AI (utility AI), selection and unit card UI, turn-order bar widget, win/lose conditions, turn bot in the playbot |
| **City / colony builder** | drag-to-place building with ghosts and valid/invalid tinting, footprints larger than one cell, rotate before place, rotate the camera between four views, free camera pan and zoom, resources and economy helper, speed-up clock, schedules (day/night), jobs and flow-field pathing for many units, build menu and resource bar widgets, 200 units at 60 fps |
| **Roguelike** | procedural dungeon generator (rooms and corridors) with a lockable seed, data tables for loot, permadeath and "new run" flow, grid or free movement per entity, turn mode optional, minimap widget |
| **Tower defence** | waves from a data table, flow field or path following, placeable towers with upgrades (data table), lives and money (resources), targeting behaviour, speed-up clock |
| **Point-and-click adventure** | click-to-move control scheme with pathfinding, hotspots (entities with interaction verbs), look/use/talk verbs UI, item combining (data table of recipes), dialogue (exists), bot that clicks |
| **RTS (my pick)** | RTS box-select, command queues, flow fields for hundreds of units, gather/build/fight behaviours, selection panel and unit cards, minimap. It is chosen because nothing else tests box-select and command queues, and because it is the hardest test of the 200-unit budget |
| **UI showcase** | the whole UI designer: widgets, layout, styles, states, binding, screens and flow, focus order, in-world UI, Quick Actions, wires |
| **Tile showcase** | the whole tile studio, autotile sets with guided slots, animated tiles, palette swaps, tile properties as the only source of collision and height, tall props, wall attachments, block stacks, the personal library, the local hub |

## 5. Order of work

1. Pack and plugin API; move the Storytender behaviours into a pack; empty project and templates (this is the foundation everything else registers through).
2. Custom components, data tables, custom events, project-made behaviours, behaviour pack import/export.
3. Scene clock and turn system; movement modes; control schemes; footprints; camera rotation.
4. Block stacks, chunked maps, procedural generation, simulation helpers.
5. The logic model with three levels; the UI designer on top of it.
6. Tile studio, tall props, attachments, personal library.
7. Templates, the assistant, the eight samples with the playbot, exports and the 200-unit budget.
8. The community asset hub last, as a separate package that never blocks the engine.

Every choice is recorded in `DECISIONS.md` as it is made; anything not finished goes in `KNOWN_ISSUES.md` with a reason.

## 6. Outcome (written at the end of phase 2)

Every row of sections 1 and 3 was done as the verdict said: the `player` tag no longer has to exist (an empty project plays); Combat, Inventory, Story, AI, Lighting, Turn-based play, Control schemes and Simulation helpers are packs, and the Storytender mechanics are a pack written with the same plugin API ([packs-and-plugins.md](packs-and-plugins.md)); the scene clock, turns, control schemes, footprints and four views, block stacks, chunked and procedural maps, the logic model with three levels, the UI designer, the tile studio, the library and the hub exist and are documented. Section 4's needs were each met by a sample ([samples.md](samples.md)) except the items listed under "Genre coverage" in KNOWN_ISSUES.md (item combining, worker gather and build orders, unit cards and a turn-order bar in the samples). The decisions are D027 to D039 in DECISIONS.md.
