# Sprite studio and animation (M4)

Switch to the **Sprites** tab (Ctrl+2) to draw and animate. Sprites live in the project under `assets/sprites/<name>.sprite.json` (plain JSON; pixels are palette indices stored run-length encoded, one frame per line).

## Making a sprite
- **+ New sprite**: pick a name, width and height (the default 32 x 48 suits a character; the game's tiles are 64 x 32 pixels).
- **Import…**: a PNG (one frame) or an **Aseprite** `.ase` / `.aseprite` file (layers, frames, durations, palette and tags become layers, frames, timings and animations). Images with more than 255 colours are matched to the nearest colours and you are told how many.
- Names may contain letters, numbers, spaces, `-` and `_`.

## Drawing
Tools (hotkeys while the studio is showing): Pencil (B), Eraser (E), Line (L), Rectangle (U), Ellipse (O), Fill (G), Picker (I), Select (M), **Iso box** (X), Feet point (F), Hitbox (H), Hurtbox (J).
- Brush size, filled/outline shapes, **mirror left/right** and **mirror up/down** (everything you draw is mirrored about the canvas centre).
- **Iso box**: click to stamp an isometric block (top plus two shaded sides, shades added to your palette) at the correct 2:1 angles. Set its size in cells and its height in pixels; "cell half-width" 32 matches the game's 64 x 32 tiles.
- **Iso guide** draws 2:1 guide lines through the feet point. **Onion skin** shows the previous frame in red and the next in green.
- Select (drag a box, drag inside to move, Alt-drag to copy); Flip, Rotate (square canvases) and nudge act on the selection or the whole layer. **Turn by (degrees)** turns the selection (or the layer) clockwise by any angle around its middle (what turns off the edge is lost), and **Scale to (percent)** makes it bigger or smaller around its middle (the selection follows); both pick the nearest pixel so the art stays crisp, are one undo step each, and work on pixel layers (a shape layer has its own turn and size settings).
- Space+drag or right-drag pans; the wheel zooms. Ctrl+Z / Ctrl+Y undo and redo; every stroke is one step.

## Layers, palette, frames
- **Layers**: add, rename, hide, reorder, merge down. You cannot draw on a hidden layer (you are told why).
- **Palette**: up to 255 colours plus transparent. Editing a colour changes it everywhere it is used; deleting one makes its pixels transparent and shifts later colours down.
- **Timeline**: add, duplicate, delete and reorder frames and set each frame's time in milliseconds. Animations that list frames keep pointing at the same pictures when you reorder or delete.
- **Properties**: resize the canvas (kept centred), set the **feet point** (where the character stands on its cell), see and copy boxes.
- **Hitboxes / hurtboxes** are boxes per frame (for example a sword swing on frame 3).

## Vector layers (shapes that stay editable)
**+ Shape layer** (Layers) adds a layer of shapes instead of pixels. On it the four **Shape** tools work: **Shape rect** (R, drag a box), **Shape ellipse** (N, drag its box), **Shape path** (P: click to place points, double-click or Enter to finish, click the first point to close it, Esc to cancel; tick **Smooth** for curves) and **Shape select** (V: click a shape to select it, drag to move it, drag a handle on its box to resize it, drag a point of a path to reshape it; Delete removes it and the arrow keys nudge it by a pixel).
- New shapes use the chosen palette colour as their fill, an optional outline colour (the **Outline** buttons: the chosen colour or none) and the outline width. Shapes are on a list under the layers; the selected shape has its own settings: fill and outline colours, outline width, rounded corners and turn for rectangles, turn for ellipses, closed and smooth for paths, bring forward / send back, duplicate and delete. Later shapes draw over earlier ones.
- Colours are palette numbers, as everywhere in the studio, so recolouring a palette entry recolours every shape using it (deleting a colour keeps shapes pointing at the same colours).
- The layer's pixels are always what its shapes look like drawn at the sprite's size, and the sprite file keeps both. The game, sprite sheets and the world editor only ever see pixels, so nothing else needs to know about shapes. Edges are not anti-aliased (a sprite has a palette of at most 255 colours).
- Pixel tools do not draw on a vector layer (you are told why); **Turn into pixels** makes it an ordinary layer (the shapes are gone, the picture stays); merging a shape layer down also makes pixels. Flip works on shapes; canvas resizing and duplicated frames carry shapes along.
- Every shape edit, a whole drag included, is one undo step. Tested by `e2e/m15-vector.spec.ts`, `packages/runtime/src/sprites/vector.test.ts` and `packages/editor/src/renderer/studio/*.test.ts`.

## Animations and directions
An animation is a named list of frames. Under **Animations**:
- **Every direction** is the list used by any direction you leave empty.
- Each of the 8 directions (East, South-east, South, South-west, West, North-west, North, North-east) can have its own list.
- **Mirror left/right**: West, South-west and North-west reuse East, South-east and North-east flipped, so you draw five directions instead of eight.
- Frame lists are written like `1, 2, 3` or `2-5` (frame numbers as shown on the timeline). Mistakes (such as a frame that does not exist) are explained.
- **Events** fire a named event when the animation reaches a frame (for example `footstep`); game logic can react to `anim-event`.
- The **Preview** plays an animation facing any direction exactly as the game will show it, including mirroring.

## Shapes with sliders
Tick **Build this sprite from shapes**: boxes, cylinders, balls and flat diamonds with sliders for width, depth (in cells), height and offsets (in pixels). **Draw shapes as pixels** puts them on the canvas (it replaces layer 1 of frame 1) so you can polish by hand.

## Export
**Export sprite sheet** packs every frame (borders trimmed, optional power-of-two size, padding) into `<name>.sheet.png` and writes `<name>.atlas.json` (where each frame is, its trim offsets, timing, boxes, the feet point and the animations). **Find uses** lists the objects in every scene that use the sprite.

## Using a sprite in the game
In the **World** tab select an object; in the Inspector choose **Drawn sprite → Sprite**. Things that move get **Standing / Walking / In the air** animation choices (picked by name; change them any time); other things play one animation. The Assets panel lets you search by name or tag, tag sprites, and **Use on selected object**. While you play, the character switches between standing and walking by itself and turns to face where it moves; a sprite removed from the project shows up in Problems and the object falls back to a plain shape.

## For developers
Runtime pieces (all in `packages/runtime`, covered by unit tests): sprite format and migrations (`sprites/format`), run-length coding, drawing and compositing helpers (`sprites/raster`), PNG encoder/decoder (`sprites/png`), sheet packer (`sprites/sheet`), Aseprite reader (`sprites/aseprite`), clip/direction resolution (`sprites/animation`), tweens with easing (`anim/tween`) and the animator state machine and system (`anim/animator`). The renderer draws `Sprite.asset` with `IsoRenderer.registerSprite`.
