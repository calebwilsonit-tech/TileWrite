# The Map widget

One widget, **Map**, makes a corner minimap, a full-screen world map, a dungeon that fills in, a strategy overview, or a hand-drawn picture with pins. It is made of **layers** and **markers**, and nothing in it is a fixed look or a fixed rule: every marker is a UI prefab you draw, every rule is a setting or a condition, and every part can be driven by a Quick Action, a wire, an event row, a graph or a script.

Add it in the UI designer (*Map* in the palette). A new one is a map of the scene being played with a marker for the player; everything below is in its inspector section.

## What it is a map of (*Source*)
| Source | Is |
| --- | --- |
| the scene being played | its tiles and heights, and its regions |
| a scene I choose | any scene of the project (the editor and an exported game keep every scene's cells ready) |
| several scenes on one layout | scenes placed side by side at cells you give: one world |
| a table of cells | rows with `x`, `y` and `tile`, `height`, `region` or `value` columns |
| a list source | a plugin's rows with `x`, `y`, `value` |
| nothing | a picture with markers on it: you say how many cells wide and tall it is |

## How cells become places (*Seen*)
From above, isometric (the game's own projection; it follows the camera's quarter turns or a fixed angle), or **a picture with markers placed on it**. *The map turns* with the camera or by a fixed angle (from above), so a minimap can rotate as the player does. *Looks at* is `auto`, a cell `12,8`, or `follow:player`.

## Layers (the first is at the back; any order, any number)
Each has its own **opacity**, **blend**, a **shown only when** condition and a **zoom range**.

| Layer | Draws |
| --- | --- |
| Terrain | every cell coloured by: the tile, the tile's own art, a tile tag, a tile property, the height band, the region, or a value from a table; outlines; "lighter on higher ground" |
| Picture | any sprite: stretched over the map, tiled, or pinned to world cells |
| Regions | the scene's regions, filled and/or outlined, with colours by name and a condition each |
| Paths | links between places of the world map, between markers of a kind, or table rows |
| Fog | what is not known yet (below) |
| Markers | the markers of the kinds you choose, in this layer's place in the order |
| Grid | lines every N cells |
| Labels | the names of regions or of one kind of marker |
| *a plugin's own* | `api.mapLayer` |

## Fog and discovery
A fog layer has a **rule** and a **look**, and covers only the **cells it names** (all, a region, or `x,y,w,h`), so several layers can each cover a region of their own. The rules:

- cells near where an object (a tag) has been; what it can see (line of sight, walls and higher ground block it); regions it has entered
- a **condition** (a variable, a table cell) that reveals the whole area when it holds
- cells **listed in a table**; **a Quick Action** (*Reveal or cover part of a map's fog*); or **a plugin's rule** (`api.fogRule`)

The look of the hidden cells is: covered, dimmed, drained of colour, or a picture. A layer can **remember** what it has shown (a map that fills in) or show only what is known now. *Saved with the game* keeps it in the save; a layer that is not saved starts again.

## Markers
A **marker kind** says where its markers come from: a list you place by hand, objects with a tag or made from a prefab, the scene's regions, rows of a table or a list source, the places of the world map (places nobody has heard of are not drawn), or a plugin's source. Each marker is a **UI prefab** with whatever it needs (a picture, a text, an animated sprite, a panel with a bar), and:

- a **state** (words, any you like: `locked`, `here`, `quest`), each with its own prefab
- **shown only when** (sees `marker.*`, `map.zoom`, `map.distance` from the player, `marker.revealed` for fog, any variable), **drawn higher the greater** a value is, **merge when closer than** N pixels into a group that has its own prefab and says `{marker.count}`
- moves with its object, or keeps the place it was first seen; grows with the zoom or keeps its size; can be chosen or is only to look at

## Moving around
The **highlight** goes from marker to marker: by direction on the screen, in list order, or to the nearest one; round the ends or stopping at them; starting on the first marker, the one nearest the player, or nowhere. Every button is a **control of the project** you can rename or remap (*Buttons the map listens to*): the arrows, next and earlier, zoom in and out, centre on me, select. The arrows can pan the view instead. The mouse clicks to choose, drags to pan and wheels to zoom; two fingers pinch.

## Values, events and actions
- **Values** (name them in *Keep ... in variables named*, say `map`): `{map.marker}`, `{map.label}`, `{map.state}`, every field of the highlighted marker's row (`{map.place.name}`, `{map.row.cost}`), `{map.zoom}`, `{map.centrex}`, `{map.centrey}`, `{map.cellx}`, `{map.celly}`, `{map.count}`. A list beside the map can follow the highlight (mark the row where `{map.marker} = posts:{place.id}`) or drive it (a *Move a map's highlight* action when a row is pointed at).
- **Events** an event row can react to: a marker is highlighted, a marker is chosen, part of a map is revealed. The map's own *When a marker is highlighted / chosen / revealed* lists run Quick Actions with the marker's values in view: travel, set a waypoint, open a screen, anything.
- **Actions**: *Move a map's highlight*, *Choose a marker on a map*, *Zoom a map*, *Move a map's view*, *Reveal or cover part of a map's fog*, *Add, hide, show or remove a marker on a map*. Each names the map by its widget's name.

## Sizes
A small corner minimap, a full-screen map and a map in a book page are the same widget: give it a size, anchor it, put it in a panel.

## For programmers
`api.mapLayer`, `api.markerSource` and `api.fogRule` add new kinds that appear in the designer like the built-in ones, with the fields they list. See [../plugins/extension-points.md](../plugins/extension-points.md) and the starters (`npm create tilewright-plugin`).

## Recipes
[A parchment map (the Last Storytender)](a-storytender-parchment-map.md) · [a corner minimap that turns](a-rotating-corner-minimap.md) · [a strategy overview with fog of war](a-strategy-overview-with-fog-of-war.md) · [a hand-drawn world with pins](a-hand-drawn-world-with-pins.md) · [a dungeon map that fills in](a-dungeon-map-that-fills-in.md)
