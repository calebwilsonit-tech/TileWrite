# A map on parchment: chapters, waypoints and "you are here"

With the **Parchment UI kit** on, the map button opens an unfolded parchment: the story's chapters down the left, the map in the middle, the places the player can go to listed under it.

## What you give it
- **A world map** (Story, Map): places with positions and a way to unlock each. A place is drawn only once the player has found it: *hidden* places are not drawn at all, places unlocked later by a flag show as "?" until then.
- **A table called `Chapters`** (Data) with a `name` column, one row for each chapter, and the variable **`chapter`** (a number) for how far the story is. The list shows the chapters up to that number and marks the current one.

## How the page is put together
1. A screen used as *World map*: a heading `{map.title}`, a flourish, and a row of two Panels.
2. **Left:** a *List* repeating for `the chapters the player has reached` (`parchment-chapters`): a Panel in a row with a small mark *shown only when* `{chapter.current} = 1` and the text `{chapter.name}`. With none yet it says "The story has not begun."
3. **Right:** the **map picture** (a plugin widget, "Parchment map") and a *List* of waypoints repeating for `the places the player can travel to` (`parchment-waypoints`).
   - The picture draws a lit circle for each place the player can travel to, a dim one for a place too close to be worth a journey, a ring and "you are here" for the place they are in, and "?" for a place only guessed at. Clicking a lit place travels there.
   - The waypoint list leaves out the place the player is in and **posts too close to travel to**: places less than 70 map units (the board is 1000 wide) from the place the player is in. The number is `MIN_TRAVEL` in `packages/plugins/parchment/src/sources.ts`.
4. A waypoint row's *When clicked*: *Travel to a place on the world map* (`{place.id}`), then close the map and the pause menu.
5. **Arrows and Interact.** The rows are ordinary widgets: W and S (and the arrows and the pad) move from waypoint to waypoint, **E fast-travels**, the pause key closes the map. The line under each row says how far ("not far", "a good walk", "a long way").

## Without the kit
Use the **World map** widget the Prebuilt screens plugin ships, a *List* repeating for `places` (the engine's own list of the places the player can travel to), and a *Table* for the chapters: the same shape, with the engine's plainer map and no "too close" rule.

Tested in `parchment.test.ts` ("the map") and `e2e/p4-parchment-kit.spec.ts`.
