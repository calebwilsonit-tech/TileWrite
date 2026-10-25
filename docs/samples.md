# The eight genre samples, and a recipe for each genre

The `samples/` folder holds nine small games, one for each kind of game the engine is meant to make (the ninth, `gravity-room`, was added in phase 3). They are not written by hand: each is made by a test (`e2e/p2-<name>.spec.ts`) that starts a project from a template and changes it only with the editor's own controls, plays it, saves it, and then lets the **playbot** finish it with no editor. Run one with `npx playwright test e2e/p2-tactics.spec.ts` (after `npm run build -w @tilewright/editor`); the saved project is rewritten in `samples/`. Open any of them in the editor with **Open Project** to see how it is made, or read the test to see every click.

| Sample | Genre | What it shows | Test |
| --- | --- | --- | --- |
| `tactics` | turn-based tactics | the Tactics starter, a hill, a ranged enemy built from behaviours, a victory flag; clicks select and move soldiers | `e2e/p2-tactics.spec.ts` |
| `colony` | city / colony builder | a build menu from a data table, footprints, producers (farm -> people -> gold), villagers who walk to their jobs, a 1x / 2x / 4x clock, a goal of 20 people | `e2e/p2-builder.spec.ts` |
| `roguelike` | roguelike | a dungeon made from a new seed every run, loot rolled from a table, permadeath that starts a new run, clear-the-dungeon goal | `e2e/p2-roguelike.spec.ts` |
| `tower-defence` | tower defence | waves from a table, enemies that follow a road, towers placed from a menu and paid for, an upgrade, lives and gold | `e2e/p2-towerdefence.spec.ts` |
| `point-and-click` | adventure | verbs (look, use, talk), hotspots, a conversation, an item, a locked door | `e2e/p2-pointandclick.spec.ts` |
| `rts-skirmish` | real-time strategy (my choice) | box select, move and attack-move orders, a mine, a barracks that trains from a button, an enemy camp | `e2e/p2-rts.spec.ts` |
| `ui-showcase` | interface | title, settings with sliders and key remapping, pause, a bound HUD, an inventory grid with drag and drop; mouse, keyboard and gamepad; four picture shapes | `e2e/p2-uishowcase.spec.ts` |
| `gravity-room` | gravity and blocks | a stone ceiling, an arch with a lintel, a low overhang, invisible blocker cells, stairs and a step, a bridge, and a pillar sticking out of the west wall; keys 1 to 4 turn gravity toward the floor, the west wall, the ceiling and the south wall; the bot walks through every turn and checks that nothing is ever inside a block and that a block fades only when it is between the camera and the player | `e2e/p3-gravity-room.spec.ts` |
| `tiles-house`, `tiles-from-the-hub` | tiles and props | edge sets, a cliff, animated water, a snow recolour, a tree whose canopy fades, wall attachments, the library, a house built from it, a set and a code pack taken from the hub | `e2e/p2-tiles-showcase.spec.ts` |

Two of them (tactics and colony) are also exported to programs of their own and played with no editor on the computer (`e2e/p2-export-samples.spec.ts`), and the colony with 200 villagers on the move holds 60 frames a second in Play (`e2e/p2-perf.spec.ts`; the logic of 200 villagers takes under 1 ms a step, `packages/behaviors/src/perf.test.ts`).

## Recipes: how to make each genre

Start from the template of that name in **New project**; each switches on the plugins the genre needs (Project settings -> Plugins). The assistant can do the same from one sentence ([assistant.md](assistant.md)).

**Turn-based tactics.** Template *Tactics*. Soldiers are objects with **Turn Taker**, **Grid Mover** and **Health**; enemies add **Unit AI**. An object with **Grid Cursor** lets the player click a soldier, click where to walk or who to hit. The row *when the scene starts -> start a turn-based battle* begins it; *a battle has been won* ends it. Hills give height advantage ([time-and-turns.md](../packages/plugins/turns/docs/time-and-turns.md), [control-schemes.md](control-schemes.md)).

**Colony or city builder.** Template *Builder*. A table of buildings (prefab, width, depth, cost) feeds the **Builder** behaviour; a list in the UI designer shows it as buttons. A **Producer** on a prefab makes (and uses) resources; resources are plain variables; **Utility Agent** villagers choose jobs from a table; the clock buttons use *Pause or resume the game, or change its speed* ([simulation-helpers.md](../packages/plugins/sim/docs/simulation-helpers.md), [ui-designer.md](ui-designer.md)).

**Roguelike.** Template *Roguelike*. In **Generate** make a dungeon, unlock the seed and tick *make the map when the game starts*; place monsters with a rule for the rooms. *Roll a random row of a table* gives loot; the row *the hero is defeated -> start a new run* is permadeath; *the scene starts* begins the battle again each run ([procedural-maps.md](procedural-maps.md), [data-and-blocks.md](data-and-blocks.md)).

**Tower defence.** Template *Builder* plus the Combat plugin. Waypoints named "Waypoint 1..n" with the tag `route`; a **Wave Spawner** on a gate reads a table of waves; enemies have **Path Follower** and **Health**; towers have **Ranged Attack** with *Its shots hurt: the enemy side*; *something reaches the end of its path* takes a life ([simulation-helpers.md](../packages/plugins/sim/docs/simulation-helpers.md)).

**Point and click.** Template *Point and click*. **Click to Move** on the hero; **Hotspot** on each thing (what Look, Use and Talk say, or `dialogue:Name`); three buttons that *Choose the verb*; rows that react to *an object is used (hotspot)* ([control-schemes.md](control-schemes.md), [story-systems.md](../packages/plugins/story/docs/story-systems.md)).

**Strategy.** Combat, Control schemes and Simulation helpers plugins. An object with **Camera Rig** and **RTS Control**; units with **Commandable Unit** and **Health**; a **Producer** for income and a button that pays and creates a unit. Drag a box to select, right-click to move or attack, hold A for attack-move ([control-schemes.md](control-schemes.md)).

**An interface for any game.** The UI designer's screens: Title, Settings, Pause (reserved names), a HUD that opens on start, lists and grids from tables. Bind widgets to variables or `settings.music`; give widgets actions; check the four picture shapes ([ui-designer.md](ui-designer.md), [interface-and-controls.md](interface-and-controls.md)).

**Tiles and props.** Tile studio for floors, blocks, cliffs, water and trees; edge sets and recolours; the library to keep and reuse them; the hub to share them ([tile-studio.md](tile-studio.md), [asset-library.md](asset-library.md), [asset-hub.md](asset-hub.md)).

## How the playbot plays them
`PointerBot` ([checks-and-playbot.md](checks-and-playbot.md)) loads the saved folder the way an exported game does and plays with a mouse: it hovers and clicks cells, drags a box, presses the buttons and sliders it can read on the open screens, and takes turns in a battle. It finishes tactics (wins the battle), colony (20 people), roguelike (loses a run on purpose, then clears the new dungeon), tower defence (survives every wave), point and click (opens the door), RTS (destroys the camp) and walks through the house's arch and behind its trees.
