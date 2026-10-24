# Give the whole game one look: the Parchment UI kit

`packages/plugin-examples/src/parchment.ts` is a plugin that makes every menu of the game look like old paper. Turn it on in **Project settings, Plugins, Examples** to see it. It is also the recipe for any re-skin, in about forty lines:

1. **Start from the game's screens, not from nothing.** The Prebuilt screens plugin offers its screens to other plugins: `api.use('prebuilt-screens', 'screens')` gives a function that returns them (a list of ordinary `UiScreen`s). The manifest says `"dependencies": { "prebuilt-screens": "^1.0.0" }`.
2. **Change the look, not what a screen does.** `parchmentLook(node)` walks a screen's widgets and changes only `style` and `states`: the box gets a paper fill, a brown border and a shadow; headings get an ink colour; clickable rows get a darker paper when chosen. Actions, list sources and bindings are untouched, so every button still works.
3. **Add your own widgets.** `api.widget({ id, label, render(el) {...} })` makes a widget the UI designer offers under *From plugins*. The kit adds a flourish and puts one under each heading.
4. **Offer the result with a higher priority.** `api.screen({ id, screen, role, revision: 1, priority: 10 })`. When several plugins offer a screen for the same part, the highest `priority` plays it (default 0). A project that has its own screen for a part ignores all of them.

What it leaves alone on purpose: the heads-up display and the travel list keep their look, because the kit decided to; a kit can re-skin as many roles as it likes.

Using it, a project can still press **Customize** on any of the kit's screens: the copy remembers it came from the Parchment kit, and the designer compares it with the kit's next version just like with the engine's own.

To make your own kit: copy `parchment.ts`, change `PARCHMENT` and `parchmentLook`, run `npm create tilewright-plugin` to get a folder with a build, a test and a manifest (see [../plugins/README.md](../plugins/README.md)).
