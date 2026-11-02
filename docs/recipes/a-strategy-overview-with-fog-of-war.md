# A strategy overview with fog of war and units you can click

The whole battlefield on one map: what your units have explored stays dim, what they can see now is clear, enemies are drawn only while they are in sight, and your units are dots you can click (or page through with a pad's shoulder buttons). (`e2e/p4-ui-map-examples.spec.ts`, the first test.)

1. Two UI prefabs, **Green dot** and **Red dot** (a 10 by 10 round **Panel** each).
2. A modal screen with a **Map** *Battlefield*, 480 by 360, *Pixels a cell is across* 10, *Keep ... in variables named* `bf`.
3. **Layers**, in this order: the terrain, then **Fog** *explored* (*Revealed by* **cells near where the followed object has been**, *Object that reveals* `unit`, radius 6, hidden cells **dimmed**), then **Fog** *in sight* (*Revealed by* **cells it can see (line of sight)**, `unit`, radius 5, **untick** *Stays revealed*, dimmed 0.5), then **Markers**.
4. **Markers**: kind `units` (*objects with a tag* `unit`, *Green dot*), and kind `foes` (*Tag* `enemy`, *Red dot*, **untick** *Can be highlighted and chosen*, *Shown only when* `{marker.revealed.<the id of the in-sight layer>} = 1`: it reads the layer's own answer, so an enemy is drawn only while that layer shows its cell).
5. *When a marker is chosen*: **Change a variable** `selected` to `{marker.label}` (the unit's name).

Play: your units are the objects tagged `unit`. A unit that walks toward an enemy brings it into sight and the ground it passed stays dim. Clicking a green dot chooses that unit; the shoulder buttons (*the buttons the map listens to*: next and earlier) go from unit to unit and A chooses. Because only the units can be chosen, `{bf.count}` is the number of units.

Change what sees: the *in sight* layer could follow `watchtower` instead; the rule is one setting.
