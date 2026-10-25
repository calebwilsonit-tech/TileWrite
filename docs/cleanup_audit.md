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

Measured on the development computer (a graphics card, not a low-end machine). "Phase 2 as written" are the figures written down at the end of phase 2. Because a computer is not the same on two days, the end-to-end test was also run on the code of the end of phase 2 (commit `a65ef20`, built and run the same way) today: "Phase 2, today".

| What | Phase 2 as written | Phase 2, today | After (this phase) |
| --- | --- | --- | --- |
| 200 walking villagers, logic per step (`perf.test.ts`) | under 1 ms | not run | 0.94 to 0.97 ms |
| Builder sample, 200 moving units, frames a second (`p2-perf.spec.ts`) | 60.2, 95th percentile 16.8 ms | 57.2, 95th percentile 18.1 ms | 56.9 to 57.2, 95th percentile 18.1 ms (three runs) |
| 5,000 tiles and 200 objects, a tick (`m9.test.ts`) | under 16 ms (a budget, no figure kept) | not run | 1.63 ms (budget 5.5 ms) |
| Unit tests, whole run | 1152 tests in 110 files | not run | see the summary in PROGRESS.md |

Reading: the frame rate is the same as phase 2's code gives on the same computer today (57.2 against 56.9 to 57.2), so the interface rewrite (screens as data, the heads-up display as widgets) cost no measurable frame time; the 60.2 written at the end of phase 2 was a better day for the machine, not a faster engine. The logic step is at the edge of the "under 1 ms" figure (0.94 to 0.97) and was not measured more finely in phase 2, so no change in either direction is claimed.

### What a person notices, before phase 3 and after round 2

`node scripts/perf-numbers.mjs` (new; run it on any built checkout) starts the built editor three times and opens and exports the `colony` sample. "Before" is the checkout of `4cd481c` (the commit before phase 3) built and run the same way, twice, one run straight after the other, to show how much the same code differs from one run to the next on this computer.

| What | Before (`4cd481c`), run 1 | Before, run 2 | After (round 2) |
| --- | --- | --- | --- |
| Startup: program started to the project list on screen (median of three; the first of three is a cold start) | 756 ms (3330, 756, 694) | 880 ms (880, 1001, 615) | 640 ms (702, 633, 640) |
| Project load: asking to open the colony sample to its scene ready (median of three) | 1175 ms (1665, 714, 1175) | 703 ms (698, 737, 703) | 786 ms (761, 786, 820) |
| Memory with the project open, all four processes together | 504.8 MB | 506.6 MB | 525.7 MB |
| Memory, the window's JavaScript | 45.2 MB | 31.6 MB | 48.1 MB |
| Export of the colony sample: the folder with the game in it | 369.4 MB (exe 235.6 MB) | 369.4 MB (exe 235.6 MB) | 369.6 MB (exe 235.6 MB) |
| Export: time the Export dialog took | 22.8 s | 22.0 s | 21.5 s |

Reading, honestly: startup and project load are within the spread the old code shows against itself (load took 703 to 1175 ms on the old code; 761 to 820 after), so no change in either direction is claimed. Memory is about 20 MB higher with the project open (4 percent), which is the plugin host, the screens and the assistant's code being loaded; the JavaScript figure moves by more between two runs of the old code (45 and 32) than between old and new, so it says nothing. The exported game is 0.2 MB bigger (the folder is dominated by the Electron runtime, 235 MB). The editor's own bundle is larger after phase 3 and round 2 by what was added (the plugin manager, the assistant's readers and previews, the tile import), which is not counted separately here. Machine: the development computer, with other programs open, so only compare these figures with each other.
