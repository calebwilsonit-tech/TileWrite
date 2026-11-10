# Room camera

For games where a room is one picture: puzzle rooms, board games, a shop. The camera normally follows the player; with this plugin on, an object can hold it still.

Switch the plugin on in **Project settings -> Plugins** ("Room camera"). Then:

1. Put a marker (any object; it needs no picture) in the middle of the room, at the height of the floor.
2. Add the **Room Camera** behaviour to it (Inspector -> Behaviours -> Add, under *Control schemes*).
3. Set **Zoom**: 1 is as the editor shows the world, 2 is twice as big.

While the game runs the picture stays centred on the marker, however the player walks about. Untick **Hold the camera here** (or switch the behaviour off from an event row) and the camera follows the player again. One Room Camera in a scene is the usual number; with several switched on, the last one to run holds the camera.

A cutscene's "move the camera" step still works: while it directs the camera the cutscene wins, and the Room Camera takes over again when it lets go.

Code: `packages/plugins/room-camera/src/index.ts` (it sets the same two settings of the view that a cutscene's camera step sets, so nothing else in the engine changed). Tested by `packages/plugins/room-camera/src/index.test.ts`; the Nightgarden game in `games/nightgarden` uses it in every room.
