# Blocks, solidity and gravity

The world is made of blocks. A body (the player, an enemy, a crate you can push) is a box, and the physics tests that whole box against every solid block it moves into, in every direction. Gravity is a direction, so the floor, a wall or the ceiling can be "down". This page is about the parts you can use; [gravity_diagnosis.md](gravity_diagnosis.md) says what was wrong before and why.

## Turning it on

Block physics is a behaviour that changed after older projects were made, so it sits behind a compatibility flag. **New projects have it on.** An older project plays exactly as it always did until you tick **Project settings -> Compatibility -> Bodies collide with every block...**. The two physics agree on everything the older one did (the older one's whole test list runs against both), and add what it could not do:

- a ceiling stops a jump, and a body cannot walk under an overhang it does not fit under;
- a body next to a wall is stopped by the wall at any height, not only at the feet;
- gravity can point down, up, or at any of the four walls.

## What is solid

Every block is solid unless it says it is not. Only that decides it: the tile's look, its layer and whether it counts as a "wall" in the Layers panel make no difference.

| Thing | Solid when |
| --- | --- |
| A column of a tile | from far below up to its height |
| A block in a stack | at its own level (a stack can have gaps: arches, tunnels, balconies) |
| Stairs and ramps | as a staircase of fine steps, so a body climbs them smoothly |
| A deck (a bridge) | its one level; there is room under it |
| A blocker cell | at every level, or only between the levels it names |
| Water | at every level for a body that cannot wade (a bridge over it is clear above the bridge) |
| A pit | has no floor |
| The edge of the map, and a cell with no tile | at every level: the edge of the world is a wall |

To make a tile or one block that bodies pass through (a vine, a picture painted on a wall), set **Solid** off: for a tile in the tile studio (Properties), for one block with the Blocks tool (Not solid).

A body that stands on something low enough steps up onto it (its *step up*, about a third of a level), and follows small drops down (its *step down*). Bigger steps stop it; a jump gets it over.

## Gravity

Gravity pulls toward one of six sides: down (the floor), up (the ceiling), or toward the west, east, north or south wall. The scene has one (Inspector with nothing selected: **Gravity pulls**), and any object can have its own (its Body: **gdir**). While the game runs:

- the Quick Action **Turn gravity** (for the scene, the player, or the object the row is looking at), or a script (`game.setGravity("-x")`), changes it;
- the condition **Gravity points a way** reads it;
- the event **gravity turns for something** and **lands** tell your rows when it happened.

When gravity turns for a body, the body keeps the middle it had, forgets how it was moving, and falls toward the new surface. In a project with the compatibility flag **timedGravity** (every new project) the turn takes time: the body swings round its middle over the time the scene says (Inspector with nothing selected: **Gravity takes this long to turn**, 0.25 seconds when it does not say, 0 for at once; a body can have its own `turnSeconds`), and every tick it is checked against the blocks and objects: it is pushed out of anything it swings into, and if it cannot be freed it waits for room (up to three quarters of a second) instead of going into the block. A project without the flag turns at once, as it always did. It is never put inside a block either way. Its picture turns to match (a drawn sprite is turned so its head points the way "up" is; a plain box is drawn as the box it is).

**A picture for each way gravity pulls.** Select the object, and in the Inspector's *Drawn sprite* open *A picture for each way gravity pulls*: choose a drawing of its own for a direction (a character drawn clinging to a wall, one hanging from the ceiling). It is drawn upright when gravity pulls that way; for a direction with none, the sprite above is turned. In the file this is `byGravity` on the sprite (`{ "-x": "hero-on-wall" }`); a script reads which way an object is pulled with `me.gravity` and sets it with `me.gravity = "+x"` (which says so, as a problem, when the project plays with the older physics, the direction is not one of the six, or the object has no Body).

**Saving.** A save keeps which way gravity pulls when that is not the way the scene says, and the player's own gravity if it has one, so a game saved on a wall loads on the wall.

The controls follow the surface: on a floor or a ceiling the move keys go the same on-screen ways; on a wall, up is up the wall and right runs along it. Jump goes away from the surface it stands on.

Everything that moves a body (control, walking AI, a push) sets the two velocities in the plane the body walks on; the one along gravity is the body's fall, managed by the physics.

## Placing blocks in the editor (the Blocks tool, key D)

It works the way Minecraft does. Point at any face (the ground too) and it lights up, with a see-through ghost of the block that would go beside it.

| You do | What happens |
| --- | --- |
| Click | the block goes against the face you point at |
| Drag along the face | a line, a wall (dragged up the side of a block) or a floor (dragged across a top), in one undo step |
| Shift-drag | a box: the patch you drag, built up as many layers deep as **Shift-drag builds this many layers** says |
| Right-click, or Ctrl+click | removes the block you point at (or use the **removes it** mode) |
| Middle-click | copies the block: its tile, its shape and the way round it is |
| R | turns stairs and ramps (north, east, south, west) |
| 1 to 9 | pick from the **hotbar**: it keeps the blocks you used lately, each with its tile, its shape (whole block, stairs, ramp), the way it faces and whether it is solid, so key 3 can be "brick stairs facing west"; a new one takes the place of the one added longest ago. The ghost beside the face is drawn as the real shape |
| Alt+click | changes the tile of a block; the **paints one face** mode changes one face |
| Space+drag | moves the picture (the right and middle buttons belong to this tool) |

**Next block is** chooses a whole block, stairs or a ramp, which way stairs rise, and whether it is **not solid** (a vine, a picture). Stairs, ramps and bridges are blocks of a cell like any other, so a column with stairs on top can be built on, cut into and copied as structures; nothing about how it looks or plays changes when it is turned into blocks.

## Placing and breaking blocks while the game runs

While the game runs, a game can place and break blocks too, but only if the scene says so: **Inspector (no selection) -> Blocks while playing**, with a limit on how many edits one run may make. Then:

- Quick Actions **Place a block** and **Break a block**, the condition **There is a block in a place**, and the events **a block is placed / broken**;
- scripts: `game.setBlock(x, y, z, "stone")`, `game.breakBlock(x, y, z)`, `game.blockAt(x, y, z)`.

A block is refused (with a message in the Problems panel and the Console) when the scene does not allow it, the limit is reached, the place is taken, or a body is standing there. What the game placed and broke is saved with the game and put back when it loads.

## What to look at while you work

Layers panel -> **Gravity (while playing)** draws, for every body, an arrow for the way it is pulled, a dot where it touches what it stands on (green: it stands, red: it does not), the box the physics tests it with, and, for the thing the camera follows, the line of sight as a volume: its box slid toward the camera, drawn in steps (nudged a few pixels apart only so they can be told apart: on the screen they all lie on the same spot), with every block the box runs into outlined in orange. A wall fades only when it is one of those.

## What "blocks" means here (and what it does not)
The world is still saved as a height map: every cell has a floor and a column. It is *read as* blocks: bodies, picking, the Blocks tool, gravity in six directions and the picture all treat a column as a stack of blocks. A stair or ramp painted with the older tools (Slope, Bridge) stays what it was in the file until you edit it with the Blocks tool, which turns that column into blocks as one undo step; a project you never edit that way is never changed. A stair and a ramp of the same way round are the same solid to the physics (the ramp's picture is the only difference). Stairs and ramps turn four ways about the up axis (north, east, south, west); they cannot be tilted onto a side. Making the whole world blocks, with no height map, would change every saved scene and is a separate piece of work (DECISIONS.md, D056).
