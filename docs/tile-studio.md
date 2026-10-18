# The tile studio, tall props, attachments and structures

Everything you need to draw the world itself: floor tiles, walls and cliffs, trees and buildings, windows and torches, and to move blocks around in whole boxes.

The **tile studio** is a mode of the sprite maker: **Sprites** in the top bar, then **Tile studio** at the top of the left column. It adds guides, a canvas for each kind of picture, a live tiling preview and the properties a tile needs. Plain sprites work exactly as before.

## Canvases for each kind of picture
**New picture for the world** offers canvases sized for your project's tile size (default 64 x 32, a level is 16 pixels), each with outlines drawn over the picture so art comes out at the right isometric angle:

| Canvas | What it is |
| --- | --- |
| **Flat floor tile** | one cell's top: a diamond. Art outside the diamond is cut away |
| **Half-height / full block** | the top, left and right faces in one picture; *Shade the three faces* gives the left face a little shadow and the right more, and *Split into faces* makes `name_top`, `name_left` and `name_right` for a tile to use |
| **Wall face / cliff face** (left or right, 1 or 2 levels) | one side of a block, already at the iso angle |
| **Stairs, four facings** | four frames (north, east, south, west) on a block outline |
| **Tall prop 1 x 1, tree 2 x 2, house 2 x 3** | the picture plus the footprint outlined on the ground |
| **Wall attachment** (left or right facing), **floor attachment** | a window, door, torch, poster, rug, puddle |

*Clip art to the guides* cuts everything outside the outline. The guides can be switched off with *Show the guides*.

## How it tiles
The **How it tiles** panel repeats the picture the way the world will: floor tiles across a patch of ground, wall and cliff faces along a wall and stacked up (choose how many levels). *Mark the seams* draws the cell edges; *Wrap-around* shows the picture repeated edge to edge so you can check that left meets right.

## Tile properties, and the palette
Under **Tile properties and the palette**, set everything about the tile once: *walkable*, *stair*, *pit*, *water*, *blocks light*, a *footstep sound*, a draw-order nudge, tags and any settings of your own (`speed = 1.5`). **Send to the palette** adds the tile (or updates the tile this sprite already is: the same id, so every copy placed in the world follows). The properties take effect in the game on every cell that uses the tile: water and pits behave as such, *not walkable* is solid at every height, the footstep sound plays under the player, and blocking light casts shadows.

- **Moving top.** Tick *Use all frames of this sprite as the animation* and give a speed: water, lava and torches move in step across the whole map.
- **Pictures on the sides.** Choose sprites for the left and right faces (made with a wall or cliff canvas) and how many levels each picture is tall; a taller face repeats it upwards. A cliff of three levels shows a one-level picture three times.
- **Variants.** Add other tiles with weights; the Paint, Rectangle, Line, Fill and Scatter tools then use a variant now and then (the same one for the same cell every time).

## Edge sets (autotile)
A ground tile needs 47 different pieces so its edges, corners, ends and inner corners line up. **Edge sets (autotile)**:

1. pick a base tile and a set name, then **Make the empty pieces** (47 labelled pictures `name_edge-N`...);
2. fill them in any order (click a piece to open it), or **Draw a starter from the base tile**: it draws an edge band of a colour you choose on every side that borders something else and a corner mark where only a diagonal does; touch them up by hand;
3. the grid shows which pieces are still empty and a small map shows the result;
4. **Put the set in the palette and apply it to the map** makes a variant tile and an autotile rule for every piece. From then on, painting the base tile picks the right piece by itself, and *Autotiling...* in the Tiles panel lists the rules.

## Recolour
Presets (snow, autumn, desert, night, grey, blue-shift) or your own hue, colourfulness and lightness. *Recolour this sprite* changes it in place; *Save as a copy* makes `name_snow`; **Recolour every tile (as new tiles)** makes a recoloured copy of every tile picture and a new tile for each ("Grass snow"): a forest set becomes a snow set in one click.

## Import and export
*Open a tile sheet* reads a PNG; set the tile size, the gaps and where the first tile starts, and *Cut it into tiles* makes one sprite per non-empty tile (`sheet_row_column`). *Export every tile picture as one sheet* packs all floor, wall and cliff sprites into `assets/exports/tileset.sheet.png`.

## Tall props
Draw a tree, lamp post, statue or house on a prop canvas, then in **Tall prop settings** say:

- the **footprint** (cells across and deep) and the height in levels; *Put the feet in the middle of the footprint*;
- **what blocks**: the whole footprint (a house), only a trunk in the middle (a tree), or nothing, with exact numbers;
- **what fades**: the rows from the top down to a line (the canopy). When the player walks behind the prop, only that part turns see-through; the trunk stays;
- whether it **sways**, and other **looks** chosen at random by weight (seasonal or random variants).

Props and decals appear in the Place tool under **Your props**. A footprint wider than one cell is aligned to the grid with the clicked cell as its corner.

**Scatter props** (Helpers) sprinkles a prop around a dragged rectangle: *Density*, *Spacing* (the least distance between two), *Keep off paths and roads* (tiles tagged `path` or named path, road or trail), and it never overlaps a footprint that is already there and keeps clear of walls, water and stairs. Props with other looks mix them by weight.

## Wall and floor attachments
Draw a window, door, shelf, guitar, poster, torch, sign, vine or crack on a **wall attachment** canvas; **Make the other side (mirrored)** creates the picture for walls that face the other way, and you can touch it up (without one, the first picture is mirrored automatically). A rug or puddle uses the **floor attachment** canvas. **Gives light** makes a torch a light source.

The **Attach** tool (Objects group) fixes the chosen attachment to a block: click a wall face at any height and it snaps on; for a rug, click the floor or the top of a block. *Shift-click* removes one. Select it to see **Fixed to a block** in the Inspector: slide it along the wall, move it to another level, turn it to another face, change its pictures. It is an ordinary object, so you can give it behaviours: a window that lets light through, a guitar the player can interact with, a door that is a portal. When the wall changes, the attachment keeps its place on the block it was fixed to; if that block is removed the Problems panel says it is floating and offers to remove it. When the view is turned, attachments on faces that turn away disappear and the others switch to their left or right picture.

## Structures: blocks by the box
- **Box select** (Blocks group, `Q`): drag across the ground; the levels (*from* and *up to*) are tool options. The **Structures** panel then offers **Copy**, **Cut**, **Fill** with the chosen tile, **Hollow out** (a shell one block thick), **Remove the blocks**, **Replace** one tile with another, and **Save as a structure**.
- A structure keeps the blocks with their faces and gaps (arches, tunnels, overhangs) and the objects inside the box, attachments included, relative to its corner.
- **Place structure** (Blocks group): choose a structure (or the copy) in the panel, click in the world; it stands on the ground at that cell. **R** turns it a quarter turn (blocks, faces and attachments turn together). Placing is one undo step.
- Stairs, ramps and decks cannot be split into blocks and are left alone (the panel says how many).

Structures are files in `assets/structures/`; they can be saved to your personal library like anything else.

## Recipes
**A tile set from scratch.** Tile studio -> *Flat floor tile* "grass", fill with green, *Clip art to the guides*, save, send to the palette. Edge set "grass": *Make the empty pieces*, *Draw a starter* with a sandy edge colour, apply. Paint grass beside sand: the edges draw themselves.

**A tree that hides you.** Tile studio -> *Tree 2 x 2*, draw it, *Only a trunk in the middle*, *The top 60% (a canopy)*. Scatter props with spacing 2 over a forest area, keeping off the path. Walk behind one: the canopy fades.

**A house with a window.** Box select a 6 x 5 x 3 box, *Fill* with brick, *Hollow out*, *Remove the blocks* in the doorway (an arch), Attach a window to the front wall, then Box select the whole thing and *Save as a structure* "House". Place copies anywhere, turned any way.

Tested by `packages/editor/src/renderer/tilestudio/*.test.ts`, `packages/editor/src/renderer/structures/structure.test.ts` and `e2e/p2-tiles.spec.ts`.
