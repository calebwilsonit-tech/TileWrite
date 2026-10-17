# Autotiling and layers

## Autotiling: edges, shores and cliff faces that draw themselves
Paint with one tile ("water") and let the editor pick the look of each cell from what is around it: an outline where the lake meets grass, dots in inner corners, a rock-coloured wall where the ground drops. Nothing needs drawing: the variants are tiles with the same colours as their base plus a rim or different wall colours, so they work before you have any art, and they keep working when you give tiles art later.

### Make it work for a tile
1. **Tiles panel -> Autotiling...** (or **Commands -> Autotiling**).
2. Pick the tile (for example *water*).
3. Press **Make edges and corners**. This adds 30 variants of the tile (an outline on every side that borders something else, a dot in each corner where only the diagonal neighbour differs) and the 30 rules that choose between them. Pick the **Edge colour** first (white makes a foam shore).
4. Press **Make cliff faces** for tiles on higher ground (for example *stone*): 3 variants that colour the camera-facing wall in the **Rock colour** where the ground next to the cell is lower.
5. **Save and apply to this scene** saves the rules and works out the look of every cell in the open scene (one undo step). Plain **Save** only keeps them.

From then on, painting does it for you. Every tool that changes a tile or a height (brush, rectangle, fill, water, cliff, raise, room...) re-checks the cell and its eight neighbours, and **one undo undoes the stroke and every look it changed**. Variants never show in the tile palette: you always paint the plain tile.

### The rules
Each rule says: *for a cell of this tile, when its eight neighbours look like this picture, show this variant*. Rules are tried from the top and **the first one that fits wins**; if none fits the plain tile shows. A tile with no rules is left alone.

In the picture (north is up, the centre is the cell itself) click a square to cycle its meaning:

| Square | Means |
| --- | --- |
| empty | don't care |
| **1** (green) | the same tile (or one of its variants) |
| **0** (orange) | something else: another tile, empty space, or the edge of the map |
| **L** (blue) | lower ground than this cell (empty space and the map edge count as lower) |
| **H** (yellow) | higher ground than this cell |

Add your own rule with **Add a rule**, then choose which variant it shows, rename it, and move it **Up** or **Down**. The dialog warns when a rule can never apply (an earlier rule matches the same neighbours, or an earlier rule matches every cell), or shows a tile that is gone.

A variant is a tile whose `group` is the plain tile; the Tiles panel shows only plain tiles. **Remove all variants and rules** deletes them, and cells that showed one go back to the plain tile. If a scene still uses a tile that is no longer in the list, the project check says so.

Rules are stored in `project.json` (`autotile`) and the variants in its tile list (`tileset`). They apply while editing; the game just draws the tile each cell holds, so autotiling costs nothing while playing.

## Tile art
Tiles are flat colours until you give them art. In the **Tiles** panel, **Tile art** lets you cover the top of the selected tile with a sprite (pick it from the list; draw it in the **Sprites** tab first, or **Import a PNG as a tile...**, which makes the sprite and a tile covered by it in one go). **New tile from a sprite** makes another tile from any sprite you already have. The tile's sides keep darker shades of the picture's average colour, so tall columns still read as solid. A 64 x 32 picture of a diamond fits a tile exactly (the corners can be see-through); a square picture is stretched over the top face and cut to the diamond. Variants made by autotiling follow their base tile's art. Taking the art away goes back to the flat colour, and the project check warns about a tile whose sprite is missing (it is drawn as a flat colour until the sprite is back). Art works the same in Play, in the game window and in exported games. Tested by `e2e/m15-tile-art.spec.ts` (it reads the colours on the screen) and the tile helper tests.

## Layers
The **Layers** panel shows and locks things in groups. A hidden layer is not drawn in the editor; a locked layer cannot be changed by tools.

| Layer | What is in it |
| --- | --- |
| Ground | the terrain: tiles, heights, stairs, pits, water, bridges, blockers |
| Walls | tiles marked **Counts as a wall** in the Autotiling dialog (brick is one by default). Hiding walls lets you see the floor behind a tall wall; locking them stops any tool from painting over a wall or painting a new one |
| Objects | everything placed in the world. Hiding or locking Objects also hides or locks Decoration and Lights |
| Decoration | objects with the *decoration* tag: Flowers, Rug, Rock, Bush, Banner in the Place tool's **Decoration** group. They have no collision |
| Lights | anything that shines (a Lantern); the player carrying a light stays on Objects |
| Regions | rooms: camera, music, darkness |

Locked layers refuse with a message that says which layer and where to unlock it. The layer settings are only for editing: **Play** always shows everything.

What this does *not* do (yet): there is no separate decoration *tile* layer under the objects, and no editing preview of lighting (lights show only while playing, and **How far lights reach** draws their circles).
