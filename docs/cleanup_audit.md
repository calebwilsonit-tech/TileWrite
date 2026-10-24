# Cleanup audit (phase 3, step 5)

What was looked at, what was found, what was done, and what was left on purpose. Written before the cleanup and updated as each item was settled, so every line says which it is.

## 1. One logic runtime

**Finding.** The logic system has three levels (Quick Actions on an object, event rows and wires through nodes, Blueprint-style graphs). They are *not* three implementations of the blocks: there is one registry of conditions and actions (`events/sheet.ts`, `conditionDefs` / `actionDefs`), and the graph runner (`events/graph.ts`) and the wire nodes (`builtins/nodes.ts`) both call the sheet's `testConditionList` and `runActionList`. Quick Actions are rows made by `logic-catalog.ts`. What differs is the *scheduler*: rows are tested every tick (with "once" memory), graph flows start on an event and may wait (delays, loops) across ticks, wires pass signals once a tick in dependency order.

**Decision: keep the three schedulers, share everything else (already true), and say so.** Folding the graph scheduler into the row scheduler would change when a flow's first action runs relative to the rows around it, which is exactly the kind of timing change the corpus cannot prove harmless for projects it has never seen (Rule A). The cost of the three schedulers is about 600 lines, all covered by `sheet.test.ts`, `graph` tests and `m5` e2e. Recorded as D046.

## 2. The editor extension plumbing

**Finding.** Before the plugin platform, `packs.ts` kept its own tables for what a pack's editor part added (`editorExtensions()`), separate from the plugin host. After the platform, `editorExtensions()` just returns `host.editor`, and the old `Pack` API (`registerPack`, `installPack`, `uninstallPack`, `listPacks`, `setActivePacks`...) are thin wrappers over `PluginHost`.

**Done / decided.**
- The editor's panels, tools, importers, exporters, export targets, inspectors, prefabs, templates, validators, playbot strategies and moves, file readers, assistant tools and image providers are all *connected* (each has an example and a test: `docs/plugins/extension-points.md`, `examples.test.ts`); none was left unwired. The two that were declared but unread before this phase, `fileReader` and `imageProvider`, are now used by the assistant (`file-tools.ts`, `image-tools.ts`), and `assistantTool` by the assistant's tool list.
- The `Pack` wrappers stay (deprecated) because their names are in the SDK's baseline and the SDK only grows (`compat/baselines/sdk-api.json`). They are marked as such in `packs.ts`.

## 3. Names: pack, plugin, asset pack

Three things were called a "pack". Now each has one word:

| Word | Means | Where |
| --- | --- | --- |
| **plugin** | code that adds behaviours, blocks, screens, tools | the project's `plugins` list, Project settings, the Plugins window, `docs/plugins/` |
| **asset pack** | a `.twpack` file of art, tiles, structures, interface pieces and screens | the personal library, the hub |
| (retired) **pack** | what plugins used to be called | kept as a deprecated alias in the code API; the project file key `packs` is read as `plugins` |

**Done.** Project format 2 renames the key `packs` to `plugins` (migration in `migrate.ts`; a project made before loads as it always did, and `LEGACY_PACKS`, which is what a project with no list means, is unchanged). The assistant's tools are `list_plugins` and `set_plugins`. The manual says plugin everywhere a plugin is meant and "asset pack" for the library's files.

## 4. Consistent interface and naming

- Menus, the pause button and every prebuilt screen go through one path (step 2); the two ways of drawing a menu are gone.
- The Settings, Controls, Save, Load, Map and Inventory screens now behave the same way with the mouse, the keyboard and a gamepad because they are the same widgets, not four hand-written pages.
- Buttons and labels: "Plugins", "Screens from plugins", "Asset pack", "Roll back this whole run" use the same verbs as the rest of the editor (Customize, Revert, Update, Remove).

## 5. Dead code

A script (`scratchpad/dead.mjs`, described here so it can be run again) lists every `export` that nothing else in the repository mentions by name. 464 names showed up; 414 are types or helpers used inside their own file (a public type the SDK exposes, or a function that is only exported so tests and the SDK facade can reach it) and were left alone. Of the 50 with no use at all:

| Removed (internal, not part of the SDK) | |
| --- | --- |
| `isLoop` (machine-edit), `STUDIO_TOOL_KEYS`, `ANCHOR_CHOICES`, `openExport`, `NEEDS_CREDIT`, `playerCell`, `goBack` of the screen kit | removed |

| Kept on purpose | Why |
| --- | --- |
| the other exports of `behaviors` and `runtime` (`takeConditions`, `columnValues`, `cloneScene`, `widgetIds`...) | they are in the SDK's baseline (`export *`), and a name the SDK has had may not disappear. The real fix is to curate what the SDK exports instead of re-exporting two whole packages; that is a change of the SDK's shape and is listed under "what next". |
| `makePlayerController`, `directControl`, `legacyPacks`, `onPacksChanged` | the deprecated Pack API (see 2) |

Also removed in the phase: the old fixed menus in `GameUi` (about 550 lines), the private drawing of hearts, light bar, quick slots and boss bars (now widgets of their plugins), the reserved-name special cases in the router, and `runtime.menuOpen` is no longer ever true (kept as a field because exported `GameUiLike` hosts read it).

## 6. Documentation that assumed one game

The reference game's words (`storytender`, `echo`, `lantern`, `sentence`, `dough`, `quill`, `mnemosynth`, `critic`, `spoiler`) are kept out of the core by a test (`neutral.test.ts`). The manual pages that describe the engine (`editor.md`, `runtime.md`, `interface-and-controls.md`, `ui-designer.md`, `logic.md`) were read for sentences that tell the reader how a game "should" be (a player with hearts, a lantern, an inventory) and reworded where they did; pages about a plugin's own mechanics (`ai-and-combat.md`, `story-systems.md`, `echoes-light-words.md`) say at the top which plugin they belong to.

## 7. Performance, before and after

Measured on the development computer (a graphics card, not a low-end machine). "Before" are the figures written down at the end of phase 2.

| What | Before (phase 2) | After |
| --- | --- | --- |
| 200 walking villagers, logic per step (`perf.test.ts`) | under 1 ms | see below |
| Builder sample, 200 moving units, frames a second (`p2-perf.spec.ts`) | 60.2, 95th percentile 16.8 ms | see below |
| 5,000 tiles and 200 objects, a tick (`m9.test.ts`) | under 16 ms | see below |
| Unit tests, whole run | 1152 tests in 110 files | see the summary in PROGRESS.md |
