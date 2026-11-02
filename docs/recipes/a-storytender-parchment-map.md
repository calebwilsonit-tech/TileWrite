# A parchment map: discovered regions, lit checkpoints, "you are here", travel

The Last Storytender's map, built with the Map widget and nothing else: regions that are fog until they are found, lit and dark lamps for checkpoints, a mark for the place you are in, posts too close to where you stand left out, and choosing a lit lamp travels there. It is moved with a pad. (`e2e/p4-ui-map-storytender.spec.ts` builds exactly this in the designer and plays it with a simulated gamepad at four shapes of screen.)

## The pieces
On a screen called *Parts* make three **Panels** and turn each into a UI prefab (*Make a UI prefab*):
- **Lit lamp**: 16 by 16, filled yellow, fully round. Inside it a **Panel** called *Ring*, pinned to the middle, 30 by 30, no fill, a red border 3 wide, round, **shown only when** `{marker.highlight} = 1`.
- **Dark lamp**: the same with a grey fill. **Here lamp**: the same with a blue fill and a **Text** "You are here" pinned under it.

## The map
1. A new screen *Parchment map*, **modal**. Inside, a **Panel** *Page* (940 by 540, in a row, a paper fill) and in it a **Map** *World* (660 by 500, a paper fill and a brown border).
2. *What it is a map of*: **nothing**, 1000 wide and 600 tall (the units of the world map's board). *Seen*: **a picture**. *Pixels a cell is across*: 1. *Starts on*: **the marker nearest the player**. *Keep ... in variables named*: `wm`.
3. **Layers**: remove the terrain. Add **Paths** (links from *the world map's paths*), then three **Fog** layers, and move **Markers** to the end. Each fog layer: *Revealed by* **a condition**, *Condition* `{found_hollow} = 1` (then `{found_peaks} = 1`, `{found_shore} = 1`), *Cells it covers* `0,0,430,300` (then `570,0,430,300` and `0,300,1000,300`), a dark brown cover. The regions are hidden until the game sets those variables.
4. **Markers**: one kind, *Id* `posts`, *Comes from* **the places of the world map**, looks like *Lit lamp*, *State* `{place.state}`. Add the states `here` (*Here lamp*) and `locked` (*Dark lamp*). *Shown only when*: `{marker.revealed} = 1 && {place.state} = here || {marker.revealed} = 1 && {place.distance} >= 70`: a place is drawn only where its region is found, and only when it is the one you are in or farther than 70 units from it.
5. *When a marker is chosen*: **Travel to a place on the world map** `{place.id}`, then **Open or close an interface screen** (close, *Parchment map*).

## A list beside it that follows the highlight
Add a **List** *Places* to the page (*Repeats for* the places the player can go). In it a **Panel** *Place row* in a row with a **Text** `▶` **shown only when** `{wm.marker} = posts:{place.id}` and a **Text** `{place.name}`. On the row: *When it is pointed at*: **Move a map's highlight** (map `World`, to the marker `posts:{place.id}`); *When it is clicked*: **Choose a marker on a map** (map `World`, marker `posts:{place.id}`). Pointing at a row highlights its post; pointing at a post marks its row.

## Play it
The d-pad (or the arrows) moves the highlight to the post that lies that way; A (or E) travels there. The mouse points at a lamp to highlight it and clicks to choose it. Finding a region lifts its fog and its lamps appear.
