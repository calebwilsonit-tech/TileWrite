# A dungeon map that fills in room by room

The map starts blank. A room appears when the player walks into it, and stays on the map, and a saved game keeps it. (`e2e/p4-ui-map-examples.spec.ts`, the third test.)

1. In the world editor, make each room a **region** (the *Regions* tool). A region has a name.
2. **UI**: a modal screen with a **Map** *Rooms*, *Pixels a cell is across* 10. It is a map of the scene being played.
3. **Layers**: terrain (the ground), then **Fog**, then **Regions** (to outline the rooms you have found), then **Markers**.
4. On the **Fog** layer: *Revealed by* **regions it has entered**, *Object that reveals* `player`, a near-black cover, *Saved with the game* **ticked**.
5. On the **Regions** layer set *Each region is drawn only when* `{region.revealed} = 1`: a room is outlined only once it is known (`region.revealed` is 1 when every fog layer that covers the room has revealed it). Add a **Labels** layer (names *from regions*) with the same condition so a room's name shows once it is known.

Play: walking into the Entry makes all of it known (8 by 6 cells). Walking into the Armoury adds it. Walking in a corridor adds nothing. The known cells are kept in a variable of the save (`__map.<id>.fog.<layer>`), so a loaded game shows the same rooms; a new game does not. A layer that is not saved shows only what the object saw since the scene began.

Other ways to fill it in: **cells near where it has been** (a torch-lit radius), **what it can see** (walls block), **a condition** (a key found opens the vault's room), **cells listed in a table**, or the Quick Action **Reveal or cover part of a map's fog** (a cutscene shows a room).
