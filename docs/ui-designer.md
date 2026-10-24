# The UI designer

The **UI** workspace (button in the top bar, Ctrl+4) is where every screen of the game is made: title screens, pause and settings menus, the heads-up display, inventories, shops, card hands, unit panels. Screens are drawn by the same code the game uses, so what you see is what the player gets. They are saved in `assets/screens.json`.

(The older **Story -> Interface** page, which positions the built-in hearts, lantern bar and quick slots, still exists and works beside this. A project can use either or both.)

## Screens

A screen is a tree of widgets. **+ New screen** makes one. Under the picture:

| Setting | Meaning |
| --- | --- |
| *The game waits while this screen is open* | menus freeze the world; a heads-up display does not |
| *The game's own buttons stop, and Back belongs to this screen* | walking and jumping do nothing while it is open. Usually the same as the line above; turn only this one on for a shop window the world keeps moving behind |
| *When the player presses Back* | what Esc (or the pad's B) does on this screen: **the usual** (close Pause, nothing on Title, go back from any other menu, ignore on a heads-up display), **go back to the screen before**, **close it and anything opened from it**, **go to a screen I choose**, or **nothing** (the screen keeps Back for itself) |
| *Which screen gets the buttons first* | with several screens open, the higher number first; equal: the one opened last |
| *Opens when the game starts* | the title screen, or a HUD that is always there |
| *Darken the game behind it* | 0 to 1 |
| *When it opens* | appears, fades in, slides up |

Screens named **Title**, **Pause** and **Settings** replace the built-in title screen, pause menu and settings. Any other screen is opened by an action. The **Open or close an interface screen** action (also in Quick actions as *Open a screen*, *Close a screen*, *Go back one screen*) opens it, closes it, goes back to the screen underneath, or closes everything. Several screens can be open at once, the last on top.

**One press, one screen.** The screen that handles a press of Back takes it: nothing under it reacts to the same press, so backing out of the inventory does not also open Pause, and closing Pause leaves it closed. (Before phase 3, Back from a screen you made could land on Pause, a Pause that did not freeze the game could not be closed with Back, and closing a Pause with a heads-up display open opened it again at once.) Switch on **Screens (while playing)** in the Layers panel to see the open screens, what Back does on each, and which one handled the last press.

## Widgets

Drag one from the **Palette** onto the picture (it lands where you drop it, inside the container under the pointer) or click it to add inside the selected container.

| Widget | Use |
| --- | --- |
| Panel | a box that holds other widgets, and arranges them freely, in a row, a column or a grid |
| Text | words, with `{names}` replaced by live values |
| Button | does its actions when clicked or confirmed with a key or gamepad |
| Image | a sprite from Sprite Studio |
| Bar | health, progress, resources: fills from a value up to a maximum |
| Slider | a number the player sets (a volume): reads and writes a variable or a player setting |
| Tick box | on or off |
| Choice list | one of several choices |
| Key binding | press to change a control (`Controls` screens) |
| List | repeats a piece for every row of a table, every carried item or a number of slots |
| Grid | the same in rows and columns; with *Allow dragging* the player drags a cell onto another and the two table rows swap (drag-and-drop inventory) |
| Tabs | pages the player switches between |
| Minimap | the map with dots for tagged objects (`player:#6fe08a, enemy:#e05a5a`) |
| Card hand | cards fanned out from a table; they lift when pointed at |
| Turn order bar | the units of a battle in order, whose turn it is lit up |

### Placing and sizing
**Pinned to** is a 3 x 3 grid plus *fill*. Drag a widget in the picture and it pins itself to the nearest of the nine places and keeps the distance you left. A widget inside a row, column or grid is placed by its container; drag it to reorder. Width and height can be **pixels**, **fit the contents** or **fill the room**. The handles on the selected widget resize it. The bar above the picture has **Preview as** (16:9, 16:10, 21:9, 4:3, a sideways phone) and **Safe area** (a margin kept free at the edges, drawn as a green dashed line).

### Look
Fill, border, text colour, size, rounding, shadow, see-through, for the normal state and for **mouse over**, **pressed**, **disabled** and **selected by keys**. Colours can be a colour from the theme (so changing the theme changes everything) or any colour. **Movement** adds a fade, slide, pop or pulse when the widget appears, goes, is pointed at or is clicked.

### Binding data, without typing
Next to every text, value and condition field is **Bind to...**. It opens a tree of everything the project has: variables, game state (`run.count`, `time.clock`, `wave.index`), player settings (`settings.music`), carried items, every cell of every table, objects of the open scene, and inside a list the values of the row being repeated (`row.name`, `item.count`, `unit.hp`). Pick one and it is written into the field (`{gold}` in a text, a plain name for a bar). Texts can combine them: `{gold} coins`, `{row.name}: {row.cost}`.

**Shown only when** and **Can be used only when** take conditions: `{gold} >= 10`, `{hasKey} && {door} = open`, `{hp} / {maxhp} < 25%`. Anything unknown counts as no. **Try values** under the picture fills in made-up numbers so the preview shows something real.

### Lists, prefabs and templates
Put one widget inside a **List**, **Grid** or **Card hand** and set *Repeats for* to a table: it is repeated for every row, with `{row.column}` meaning that row's cell. Or **Make a UI prefab** from any widget: it becomes a reusable piece (`ShopRow`, `Slot`, `Card`), the widget becomes an instance of it, and a list can repeat it (*Each one looks like*). Change the prefab once (the ✎ button opens it in the same picture) and every use follows; an instance can override a text, or be **unlinked** into plain widgets.

### Screen flow and focus order
**Screen flow** draws the screens as boxes and an arrow wherever a button opens another. Drag the boxes; double-click to design one. **Focus order** shows the order keys and gamepads move between buttons: drag from a button to another to say "pressing that way goes there" (it makes the arrow back too), or press **Make the arrows for me** to fill them in from the layout. Without arrows the nearest widget in that direction is used. In the game: arrow keys / stick move, **E** / A confirms, the pause key goes back.

### Interface on objects
Give an object the **World UI** behaviour and choose a UI prefab: it floats over the object (health bars over units, speech bubbles, price tags). Inside the prefab `{self.name}`, `{self.hp}` and `{self.health.max}` (any setting of any part) mean that object; `showWhen` hides it (`{self.hp} < {self.maxhp}`) and a distance hides it when the player is far.

## Recipes

**A settings screen.** New screen *Settings* (pauses the game). Add a Panel (arranged in a column), inside it a Slider tied to `settings.music` (full at `1`, step `0.1`), a Tick box tied to `settings.showFps`, a Key binding for `interact`, and a Button *Back* whose click is *Go back one screen*. On the Pause screen a *Settings* button opens it.

**A shop.** A table `Shop` with `name` and `cost`. A List repeating a UI prefab `ShopRow` (a Panel in a row with a Text `{row.name}: {row.cost}` and a Button *Buy*). The button is *usable only when* `{gold} >= {row.cost}` and subtracts `{row.cost}` from `gold`.

**A drag-and-drop inventory.** A table `Bag` with `item` and `qty` and twelve rows. A Grid (4 columns, source `table:Bag`, *Allow dragging*) whose first child shows `{row.item} x{row.qty}`.

**A heads-up display.** A screen that *opens when the game starts* and does not pause the game: a Bar tied to `hp` with *Full at* `{Hero.health.max}`, a Text `Gold: {gold}`, a Minimap in a corner.

## Checks
The panel under the picture and the Problems panel list: a button that opens a screen that does not exist, a list with nothing to repeat or no source, a bar tied to nothing, a UI prefab that is missing, focus arrows that point at deleted widgets, a table that does not exist.

## For scripts and tests
`packages/behaviors/src/ui/screens-logic.ts` has no pictures in it: `resolveScreen`, `openScreens`, `findOnScreens`, `activateWidget`, `setSlider`, `swapRows`. The playbot uses them to press buttons.

Tested by `packages/behaviors/src/ui-screens.test.ts`, `packages/editor/src/renderer/uidesigner/ui-edit.test.ts`, `e2e/p2-ui.spec.ts` and `e2e/p2-ui-lists.spec.ts`.

## Screens that come with plugins, and the part a screen plays
Nothing about the game's own menus is hidden. The title, pause menu, inventory, world map, save, load, settings and controls screens, the travel list and the heads-up display are ordinary screens that plugins ship (the *Prebuilt screens* plugin, and others for their own kinds of game). A game plays with them unless the project has a screen of its own for the same **part**.

- **The part a screen plays** ("This screen is used as" in the screen's settings): Title, Pause, Inventory, World map, Save game, Load game, Settings, Controls, Heads-up display, and whatever plugins add. The game opens the screen that plays a part: the pause button opens Pause, the inventory button opens Inventory, the map button opens the world map (or Travel, when the project has no world map). Buttons can open it too: choose *The screen used as Pause* instead of a name. A screen named Title, Pause or Settings plays that part without choosing it. A project's own screen for a part replaces the plugin's.
- **Screens from plugins** (left side of the UI workspace) lists every screen the plugins ship and what the project has done with it. **Customize** makes your own copy that plays the same part, which you change like any screen. A copy remembers where it came from: once you have changed it, **Compare with the plugin's** says what differs (widget by widget, in plain words); when the plugin has a newer screen, **Update** or **Revert to the plugin's** puts it back; **Use the plugin's again** deletes your copy.
- **Lists the game fills for you** (*Repeats for*): the save slots, the controls, the places on the world map, the quick slots, the items carried, the entries plugins add to the Pause menu, and any list a plugin adds. The *Bind to...* list says which names a row can read (`{save.name}`, `{item.count}`...). A list can say what to show when it has no rows.
- **Buttons the game does**: Save the game (to a slot), Load a saved game (a slot, or *latest*), Start this area again, Travel to a place on the world map, Put all controls back, Quit. Settings are written by sliders, tick boxes and choices that read and set `settings.music`, `settings.language`... Left and right on a selected row run its *when changed* actions with `{delta}` as -1 or 1.
- **The pause button**: in a new project every scene starts with the Quick Action *When the pause button is pressed, open the Pause screen*. Change or delete it to do something else with that button. (Projects made before this keep the older rule, in which the button opens Pause by itself; Project settings, Compatibility has the switch, `pauseAction`.)
- **The library** keeps whole screens too: *Save to the library*, kind *UI widgets*, pick *Screen: ...*. Adding it to another project brings the screen, the part it plays and the note of where it came from.
