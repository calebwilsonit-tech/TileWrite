# Give the whole game one look: the Parchment UI kit

`packages/plugins/parchment` is a plugin that makes the game's screens look like old paper, and brings the screens a game of that kind wants. Turn it on in **Project settings, Plugins** (it ships with the editor, and with every game that uses it). It is off in a new project: a look is not part of every game.

## What it gives you
| Part | Is | Recipe |
| --- | --- | --- |
| Inventory | an open book: a paper doll with equipment slots and stats, a scrolling 4-column grid of item cards with hover and a chosen mark | [a-binder-inventory.md](a-binder-inventory.md) |
| World map | an unfolded parchment: chapter list, only the places found, lit waypoints, "you are here", posts too close left out | [a-parchment-map.md](a-parchment-map.md) |
| Pause menu | a menu column with a description box, and pages for Travel and "Restart?" that Back leaves | [a-pause-menu-with-pages.md](a-pause-menu-with-pages.md) |
| Title | the same menu column; New game asks a difficulty that is locked for the save | [a-title-with-a-locked-difficulty.md](a-title-with-a-locked-difficulty.md) |
| Heads-up display | a gauge, a counter, the region name, a prompt, a boss bar, narrator text, message slips | [a-heads-up-display.md](a-heads-up-display.md) |
| Save, Load, Settings, Controls | the engine's own screens with the paper look (and the Settings difficulty that locks) | below |

Every one is an ordinary designer screen made with the general tools: panels in rows and columns, text, bars, lists and grids that repeat for a source, conditions, and buttons that do the game's own actions. The kit adds a few things any screen can use: four **list sources** (`parchment-waypoints`, `parchment-equipment`, `parchment-stats`, `parchment-chapters`) and five **plugin widgets** (flourish, paper doll, parchment map, region name, message slips). Two general tools were improved for it, and are for everybody: the Quick Action **Change a player setting**, and **choosing a widget with the keys or the pad now does what pointing at it does** (so a description under a menu follows both).

## Giving the engine's own screens a look, in about forty lines
Save, Load, Settings and Controls are the kit's re-skin of the Prebuilt screens plugin, and it is the recipe for any re-skin:

1. **Start from the game's screens, not from nothing.** The Prebuilt screens plugin offers its screens to other plugins: `api.use('prebuilt-screens', 'screens')` gives a function that returns them (a list of ordinary `UiScreen`s). The manifest says `"dependencies": { "prebuilt-screens": "^1.0.0" }`.
2. **Change the look, not what a screen does.** `parchmentLook(node)` (`look.ts`) walks a screen's widgets and changes only `style` and `states`: the box gets a paper fill, a brown border and a shadow; headings get an ink colour; clickable rows get a darker paper when chosen. Actions, list sources and bindings are untouched, so every button still works.
3. **Add your own widgets.** `api.widget({ id, label, render(el) {...} })` makes a widget the UI designer offers under *From plugins*. And lists: `api.listSource({ id, label, rows(sim) })`.
4. **Offer the result with a higher priority.** `api.screen({ id, screen, role, revision: 1, priority: 10 })`. When several plugins offer a screen for the same part, the highest `priority` plays it (default 0). A project that has its own screen for a part ignores all of them.

Using it, a project can still press **Customize** on any of the kit's screens: the copy remembers it came from the Parchment kit, and the designer compares it with the kit's next version just like with the engine's own.

## Exported games
The kit is a plugin that ships with the editor, so a game that uses it exports with its paper screens (`e2e/p4-export-parchment.spec.ts` exports a game and plays its pause menu with no editor).

## Make your own kit
Copy `packages/plugins/parchment`, change `palette.ts` (and `look.ts` for the re-skin), run `npm create tilewright-plugin` to get a folder with a build, a test and a manifest (see [../plugins/README.md](../plugins/README.md)).
