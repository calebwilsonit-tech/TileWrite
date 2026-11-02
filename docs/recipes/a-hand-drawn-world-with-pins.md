# A hand-drawn world picture with pins from a table

Your own drawing of the world (made in the sprite studio, or imported) with a pin on each place, the pins listed in a table so changing the table moves them. (`e2e/p4-ui-map-examples.spec.ts`, the second test.)

1. **Sprites**: draw or import the picture (any size; here 64 by 40).
2. **Data**: a table *Pins* with columns `x` and `y` (numbers) and a `name` column; one row for each place. The picture is a thousand units wide and six hundred tall: put the inn at `200, 150`, the mill at `700, 300`.
3. **UI**: a **Map** *Drawing*. *What it is a map of*: **nothing**, 1000 by 600. *Seen*: **a picture**. *Pixels a cell is across*: 1. Remove the terrain layer; add **Picture** and move it behind **Markers**. On the picture layer: *Picture* your sprite, *Placed* **stretched over the whole map**.
4. **Markers**: *Comes from* **rows of a table**, *Table* `Pins`. *Across* `x`, *Down* `y` (the columns' names, or a little arithmetic such as `{row.x} * 2`). Choose a UI prefab for the pin (a drawn pin, a flag, a text) and, if you like, *State* `{row.state}` with a prefab for each.

The pins stand where the table says, as a share of the picture, at any size of the map. Tiled and pinned pictures work too: *Placed* **tiled** repeats a small picture (the parchment texture), **pinned to world cells** puts a picture at cells you give. To make the map clickable, fill *When a marker is chosen* (open a screen about the place, say) and give the kind a prefab with a ring that shows when `{marker.highlight} = 1`.
