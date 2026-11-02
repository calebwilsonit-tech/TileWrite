# A corner minimap that turns with the camera, with enemy dots

A small map in the top right of the screen that shows the ground around the player, turns when the camera does, and shows enemies as red dots that come and go as they appear and are defeated. (`e2e/p4-ui-map-minimap.spec.ts` builds it in the designer and checks the dots turn a quarter turn with the camera.)

1. Make a UI prefab **Red dot**: a **Panel** 9 by 9, a red fill, fully round.
2. A screen *Minimap HUD*, **Opens when the game starts** (so it is a heads-up display). Add a **Map** called *Minimap*, pinned to **top right**, 200 by 200, a little in from the corner.
3. In its inspector: *The map turns*: **with the game's camera (from above)**. *Pixels a cell is across*: 6, *Starting zoom* 2. *Looks at*: `follow:player` (the player is always in the middle).
4. **Markers**: the first kind (the player) is already there: *Comes from* objects with the tag `player`. **+ Marker kind**: *Id* `enemies`, *Comes from* **objects with a tag**, *Tag* `enemy`, looks like *Red dot*.
5. Play. Give your enemies the tag `enemy` (their *Tags* in the Inspector). Turn the camera (Q and E in the starter): the terrain is painted again turned, and each dot moves round the player by the same quarter turn. An enemy that is defeated loses its dot.

## Variations
- An **isometric** minimap that matches the game's view: *Seen* **isometric, like the game**, *Turned* **with the game's camera**.
- Only enemies within 12 cells: on the enemies kind, *Shown only when* `{map.distance} < 12`.
- Make the dot grow with the zoom: tick *Grows with the zoom*. Make enemies blink: put a movement on *Red dot*.
- An **animated sprite** or a whole **panel with a bar** works as a marker as well as a dot: a marker is just a UI prefab.
