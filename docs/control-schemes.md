# Control schemes, movement, camera and building

How a person plays is a choice a game makes, not something the engine assumes. Each scheme is a behaviour you put on an object; combine them freely. Everything reads the pointer and the buttons through the same input every other behaviour uses, so recordings, replays and the playbot drive a click exactly as a person does.

## The pointer
The mouse reaches the game as actions: `pointer_primary` and `pointer_secondary` (left and right button), `pointer_middle`, the **cell under the pointer** (`pointer_cx`, `pointer_cy`, stored plus one so cell 0 is not lost), its position in the picture in pixels (`pointer_sx`, `pointer_sy`), the mouse wheel, the camera (`pointer_camx`, `pointer_camy`, `pointer_zoom`, `pointer_vw`, `pointer_vh`) and the `modifier_shift` / `modifier_ctrl` keys. A click on a menu or button drawn over the game is not a click on the world. Scripts and the playbot press them with `pointerSnapshot(cell, {primary: true})`.

## Movement, per object
- **Free movement**: objects with a Body move by velocity and collide with the world (Direct Control, Click to Move, Commandable Unit).
- **Cell-locked movement**: **Grid Mover** walks cell by cell along a path over stairs and heights and never stops between cells (tactics, roguelikes, puzzle games).
- An object may have both; orders from the interface use whichever behaviour it has.

## The schemes (plugin **Control schemes**; Direct Control is always available)
| Scheme | For | What it does |
| --- | --- | --- |
| **Direct Control** | action games | WASD or arrows walk, Shift runs, Space jumps. Follows the turned view: up is up the screen. |
| **Click to Move** | point-and-click adventures | Click the ground: the object walks there around walls, up stairs. A marker shows the goal. |
| **Hotspot** | adventures | Click it with the verb chosen (variable `verb`: look, use, talk): the walker goes up to it and its words are said or a conversation starts (`dialogue:Name`). `hover.name` holds the name under the pointer for a label. Rows react to *A hotspot was used*. |
| **Grid Cursor** | tactics | Click your unit: blue cells show where it can walk, red enemies in reach; click a blue cell to walk, an enemy to attack, right-click to put the selection away; the End turn button ends the turn. Numbers for a unit card: `sel.name`, `sel.hp`, `sel.hpMax`, `sel.ap`, `sel.apMax`, `sel.team`, `cursor.x`, `cursor.y`. |
| **RTS Control** + **Commandable Unit** | strategy | Click a unit or drag a box to select (Shift adds). Right-click the ground: the group walks there and spreads out; right-click an enemy: attack; Shift+right-click queues the order after the current ones; hold A while right-clicking to attack-move; S stops. Units attack enemies that come within their auto-attack range. A crowd shares one **flow field** per destination, so hundreds move without a path each; they keep their personal space. `rts.selected` counts the selection. |
| **Camera Rig** | builders | Move buttons pan (or the pointer at the edge, or the middle mouse button dragged); the wheel zooms; **Q** and **E** turn the world between the four isometric views. |
| **Builder** | builders, tower defence | Pick a row of a data table of buildings (columns `prefab`, `w`, `d`, `cost`; the variable `build.selected`, or the *Choose a building to place* action). A **ghost footprint** follows the pointer: green where it fits, red where it does not, with the reason in `build.why` ("Not enough gold", "Something is already there", "The ground there is not flat enough"). **R** turns it a quarter turn (a 2 x 3 house becomes 3 x 2), click places it and pays its cost, right-click or Esc puts it away; holding the button and dragging places 1 x 1 pieces (walls) along the way. Footprints of any size; a placed building gets a `footprint` component, the tag `building`, and the units walk around it. |

## Turning the world: four isometric views
`view.rotation` (0-3) turns the whole picture a quarter turn: tiles show the sides that now face the camera, objects are redrawn and depth sorted for the new angle, stairs and pits too. Picking, the camera, pointer cells, box selection and walking all follow it. Use the Camera Rig's Q/E, the *Turn the world to another view* action, or script `runtime.view.rotation`. The camera keeps looking at the same place.

## Time
See [time-and-turns.md](time-and-turns.md): real time at 1x-8x, paused, or by turns.

## Tested by
`packages/behaviors/src/controls.test.ts` (click to move around a wall, hotspots, the grid cursor, box selection with the camera in the snapshot, queued orders, two hundred units under 8 ms a tick, the camera rig, ghost placement with costs and reasons), `packages/runtime/src/iso/rotate.test.ts`, `e2e/p2-rotate.spec.ts`.
