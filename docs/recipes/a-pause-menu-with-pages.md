# A pause menu with pages: Travel and "Restart?"

A pause menu that is a list of rows, with a line under it that says what the chosen row does, and rows that open **pages** which replace the list: **Travel** (a list of places) and **Restart?** (a question). Back goes from a page to the pause menu, not out of the menu. The Parchment UI kit's Pause screen is this.

## How it is put together
1. **The menu column.** A Panel in a column. Each row is a Panel in a row (words on the left, a detail on the right) that is chosen by the mouse, W and S, the arrows or the pad (*mouse over* and *selected by keys* use the same darker paper). One row for each of: Resume, Inventory, the entries other plugins add (a *List* repeating for `the entries plugins add to the Pause menu`), Travel, Save game, Load game, Settings, Restart, Quit.
2. **The description box.** Under the rows a Text shows `{menu_hint}`, *shown only when* it has words. Every row has a *When pointed at* action: *Change a variable* `menu_hint` to what the row does. Pointing at a row and **choosing it with the keys or the pad** both run it (new in this phase: choosing a widget with the keys does what pointing at it does), so the box follows whichever way the player moves.
3. **Pages.** Travel and Restart are **screens of their own** (named `Pause: Travel` and `Pause: Restart`), opened by the row with *Open or close an interface screen*. Their setting *When the player presses Back* is **go back to the screen before**, and *Darken the game behind it* is 0, so the page looks like the next leaf of the same menu. Back (the pause key, Esc, the pad's B) closes the page and the pause menu is there again.
4. **Travel** is a *List* repeating for `the places the player can travel to` (the kit's `parchment-waypoints`; the engine's `places` works too), each row *Travel to a place on the world map* and then closing the page and the pause menu.
5. **Restart?** is a heading, a question, and two rows: *No, keep playing* (*Go back one screen*) and *Yes, start again* (close the page, close the pause menu, *Start this area again*).
6. **Settings** is one page shared with the title (the screen used as *Settings*), so a change made from either place is the same change.

Tested in `parchment.test.ts` ("the pause menu") and `e2e/p4-parchment-kit.spec.ts`.
