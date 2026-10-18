# Procedural maps and big worlds

## Making a map from rules (the **Generate** panel)
Pick a kind, set a few rules, press **Make the map now**. The same seed always gives the same map.

| Kind | How it builds | Start / exit |
| --- | --- | --- |
| **Rooms and corridors** | Places non-overlapping rooms, joins them in a shuffled order with L-shaped corridors (1-3 cells wide), builds walls round everything | start in the first room; exit in the room farthest away |
| **Caves** | Random rock smoothed into caves, keeps the biggest cave and walls it in | the two ends of the cave |
| **Islands** | Noise raised out of the water: beaches, grass, hills; small islands are drowned so everything is reachable | a beach |
| **A town** | A grid of roads, a plaza in the middle, a building prefab on most lots | the plaza |

**Things to place**: each rule names a prefab and where it goes: inside rooms, anywhere on the floor, against walls and shores, at the start, at the exit, in corridors and on roads, or anywhere. Give a count, or a chance per cell, and a spacing; an optional tag lets event rows find them (`loot`, `exit`). A rule for *the start* with the tag `player`... or just keep your own player object: the generator moves the object tagged `player` to the start.

The panel tells you, in words, when the rules ask for more than fits ("Only 5 of the 150 rooms fit on a 24 x 24 map") and whether the exit can be reached from the start.

### Seeds
- **Locked seed** (the default): the map is always the same. Use it for a level you made and want to tweak.
- **Unlocked**: each *new run* makes its own map from the variable `run.seed`. The event action **Start a new run** sets a new `run.seed`, forgets everything the player had (health, items, flags: permadeath) except the run counter and anything named `run.*` or `best.*`, and starts the scene again. `generated.seed` and `generated.rooms` hold what the current map used.

### When the map is made
- **Make the map now** replaces the scene's map and every object the generator placed before (they carry the tag `generated`) as one undo step, and moves the player to the start. The result is ordinary map data you can paint over.
- **Make the map when the game starts** keeps only the rules in the scene (`generator` in the scene file) and makes the map each time the scene loads, with the objects placed by the rules. Exported games do the same, so no two runs have to be alike.
- **Keep these rules in the scene** saves the rules without changing the map.

## Large maps
Maps can be up to 1024 x 1024 cells. Tiles are drawn in chunks of 8 x 8 cells, only the ones near the picture (and a margin), so a map of any size opens at once and costs what is on screen; chunks leave when the camera moves away. Editing a cell that is off screen costs nothing until it is seen. Flow fields, pathfinding and physics work on the whole map.

## Tested by
`packages/runtime/src/procgen/generate.test.ts` (determinism, rooms never overlap, everything connected, walls round the floor, caves, islands, towns, scatter rules, maps made at start with a locked and an unlocked seed), `e2e/p2-bigmap.spec.ts`, `e2e/p2-roguelike.spec.ts` (the roguelike sample).
