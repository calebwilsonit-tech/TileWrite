# Extension points

Everything a plugin can add, with the `api` call, what the editor or the game does with it, and the example that shows it working. All examples are in `packages/plugin-examples/src` and are tested by `examples.test.ts`.

A plugin's `install(api)` is the **game part** (runs in the editor and in the exported game). `installEditor(api)` is the **editor part**.

## In the game

| Call | What it adds | Example |
| --- | --- | --- |
| `api.behavior(def)` (or `api.behaviors(...)`) | A behaviour: settings in the Inspector, signals for wires, an `update` every tick. | `game.ts` Spinner |
| `api.condition(def)`, `api.action(def)`, `api.conditions(list)`, `api.actions(list)` | Blocks for the event sheet, with plain-English `describe`. | `game.ts` events |
| `api.event(def)` | An event the sheet can react to ("something is hurt"), with its wording; `autosave: true` saves the game when it happens. | `game.ts` events |
| `api.system(name, fn, mode?, stage?)` | A function run every tick. `stage` says where: `first`, `after-player`, `after-behaviors`, `default`. | `game.ts` system |
| `api.inputAction(id, def)` | A button with its starting keys; shown in Project settings → Controls and the game's Controls screen. | `game.ts` button |
| `api.component(def)` | State an object can carry, with defaults. The Inspector offers it under Plugin components. | `game.ts` component |
| `api.collisionLayer(def)` | A named collision layer with its own bit (`ghost: true` lets gates "that let ghosts pass" admit it). Scripts get its number with `game.layer(name)`. | `game.ts` layer |
| `api.physicsModifier(def)` | Changes how every body moves before each step (wind, ice, a conveyor). | `game.ts` wind |
| `api.blockType(def)` | A kind of block with its own colours and rules; the Tiles panel offers to add it to the project. | `game.ts` ice |
| `api.whoFilter(def)` | A group pressure plates and trigger zones can react to. | `game.ts` heroes |
| `api.scriptMethod(def)` | A method scripts can call (the script API names `damage`, `heal`, `startDialogue`, `playCutscene` are implemented this way). | `game.ts` shout |
| `api.unlockRule(def)` | A way a place on the world map can unlock. | `game.ts` key |
| `api.bridgeSource(def)` | Cells that can be walked over a pit because of something the plugin brings; the checks and the playbot ask. | `game.ts` planks |
| `api.widget(def)` | A kind of widget for the UI designer, drawn by the plugin every frame. | `ui.ts` clock |
| `api.screen(def)`, `api.screenRole(def)` | A screen a project can copy and make its own (`role` says what it plays: title, pause, inventory...; a project with no screen for a role plays with the plugin's), and what a screen can be used as. | `ui.ts` credits |
| `api.listSource(def)` | Rows for lists and grids in screens, named in a widget's *source* (`pets`, or `pets:argument`). The engine itself offers `saves`, `controls`, `places`, `quickslots`, `items` and tables. | `ui.ts` list |
| `api.strings(fn)` | Words the game shows, for the translation tables. | `ui.ts` strings |
| `api.provide(name, value)` | Something for other plugins to take with `api.use(id, name)`; the screens of the game are provided as `gameUi`. | `ui.ts` game screens |
| `api.assistantNote(text)` | A line telling the assistant what the plugin adds. | `tools.ts` assistant |
| `api.log`, `api.fetch` | A line in the Console; a request to a host the plugin has permission for. | |
| `api.use(pluginId, name)` | Takes what a plugin you depend on offered with `api.provide` (undefined when it is off). | `ui.ts` game screens |
| `api.id`, `api.manifest`, `api.inEditor`, `api.packId` | Who is being installed, and whether the editor (not the game) is running. `packId` is the older name of `id` and stays. | |
| `api.adopt(members)` | Takes behaviours and blocks the engine already had into the plugin (used when the engine's own modules became plugins). | |

## In the editor (the editor part)

| Call | What it adds | Example |
| --- | --- | --- |
| `api.panel(def)` | A panel in the dock. | `editor.ts` panel |
| `api.tool(def)` | A tool under Plugins in the Tools panel, told where the mouse goes down, drags and comes up. | `editor.ts` probe |
| `api.importer(def)` | "Import: ..." in the command palette, for a file type. | `editor.ts` importer |
| `api.exporter(def)` | "Export as ..." in the command palette, turning a project file into another format. | `editor.ts` CSV |
| `api.exportTarget(def)` | A checkbox under **Also make** in the Export dialog; `finish` runs after the game has been exported. | `editor.ts` target |
| `api.inspector(def)` | How a component of the plugin is drawn in the Inspector. | `editor.ts` inspector |
| `api.prefab(def)` | An object in the Place tool. | `editor.ts` beacon |
| `api.template(def)`, or `templates` in `definePlugin` | A starter project in the New project list (the second form lists it even while the plugin is off). | `editor.ts` arena |
| `api.validator(def)` | A check for the Problems panel. | `editor.ts` to-do |
| `api.playbotStrategy(def)` | A button in the Playbot panel that plays the scene a certain way. | `tools.ts` wait |
| `api.playbotMove(def)` | A step the puzzle solver may combine with the others. | `tools.ts` pause |
| `api.fileReader(def)` | How the assistant reads a kind of file you attach. | `tools.ts` assistant |
| `api.assistantTool(def)` | A tool the assistant can use. | `tools.ts` assistant |
| `api.imageProvider(def)` | A way for the assistant to make a picture. | `tools.ts` assistant |

Panels, tools, importers and exporters of a plugin somebody else wrote run in the sandbox; the plugin API they see is the small one described in the README (`Tilewright.editor.panel({ id, title, mount(el, host) })`, `tool`, `importer`, `exporter`).
