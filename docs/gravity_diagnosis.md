# Gravity on walls and ceilings: what went wrong, and why

The owner's puzzle "Upside Down" has a switch that glues the player to a wall or the ceiling for a few seconds. Two things looked wrong:

1. **A block turns see-through at certain spots on a wall, as if the player were behind it.**
2. **Blocks that are not "wall" blocks are passed through until the shift finishes.**

Both are reproduced by tests that run on the owner's own project (`compat/gravity-diagnosis.test.ts`, skipped when the project is not in `compat/projects`) and by tests with plain boxes (`packages/runtime/src/render/occlusion.test.ts`). This page says which part is the engine's and which is the project's.

## What the project does

The project has no real gravity, because the engine had none: gravity is a single number pulling straight down. So the script `Gravity Flip` pretends:

- it switches the player's collision off (`body.noclip = true`),
- it moves the player by writing `me.x`, `me.y` and `me.h` itself, along an invisible plane 0.15 cells in front of a wall (`wallInset`) or under a platform,
- the only solid things it knows about are objects tagged `protrusion` (the "Wall Platform" objects) and a few numbers typed into its settings (`ledgeSouth` and friends, "the floor block against the wall is 3 high here"),
- it never asks the map what is solid (the test checks that the source never mentions `cellBlocked`, `blockedAt` or `FLAG`),
- it raises the player's draw order by 3 (`depthOffset`) to keep walls from drawing over it, which the script's own help text says is a patch for the fading problem.

## Problem 2: blocks are passed through

**Cause: the project's script, and the engine only gave it nothing better.**

While the player is glued, the engine's collision is off, and the script's own checks only cover its platforms and its typed-in lists. A *blocker cell* is a cell that is solid at every height (the middle wall of the room is made of them). The test plays the owner's wall scenario and finds the player standing inside those cells while glued (`insideBlocker > 0`), and then plays the same walk on the ground, where the engine stops the player at the wall segment (`entered === 0`). So the engine's ordinary collision does what the owner expects; the script turns it off.

Other things that look like "only wall blocks are solid" in that script are the same cause: the engine never used a tile's `wall` flag for collision (`wall` only decides how a tile is drawn and which layer it is on), and the script was written to treat its own tagged platforms as the only solid things.

There is also an engine reason the owner had to write it that way: the engine had **no gravity direction, no per-body "up", and no collision against anything above the feet or beside a body that is not on the floor**. Phase 3 step 4.3 adds those (see below), so that this script can be replaced by a switch that only says which way gravity points.

**Proposed change to the project:** now that the engine has gravity (step 4.3), the three scripts can go: four Quick Action rows turn the player's gravity toward the wall or the ceiling and back, and the collision comes from the engine. The change was written as a diff, applied to a copy and played: the player stands on the west wall, climbs to the platforms, is stopped by them, and falls back to the floor when the countdown ends, with no tick inside a block. It is in `compat/proposals/upside-down-gravity.diff` with an explanation in `upside-down.md` (kept out of git, since it holds parts of the project). **Nothing in `compat/projects/Demo` has been changed, and nothing will be without the owner's say-so.**

## Problem 1: a block turns see-through

**Cause: the engine.** The project makes it easier to see, but the rule that fades walls is the engine's.

The engine fades a wall column when (a) it rises above the feet of the thing being followed, (b) the rectangles of the two pictures overlap, and (c) the draw order puts it in front. Two of those are wrong for a body that is not standing on the floor:

- (c) puts a block in front *by position on the floor first*: a cell one step further along the wall counts as "in front" as soon as the body's footprint ends before it starts. That flips when the body's footprint (0.6 wide) crosses a cell edge, which is why it happens at certain spots and not others. (A float rounding at exactly 3.0 does the same.)
- (b) compares bounding rectangles, not shapes, so a tall column whose picture just touches the corner of the body's picture counts as covering it.

On the west wall (the body at x = 1.15, 0.15 in front of the wall face) the older rule fades the tall wall cell next to the one the body leans on for 120 of 710 sampled positions, when that cell is nowhere near the line of sight. The test finds the same on the east and south walls with the stone block.

**Fix (done):** the new rule asks the real question. The camera looks along one direction; a block hides the followed thing exactly when that thing's own box, slid toward the camera, would run into the block (`render/occlusion.ts`, `blocksView`). It uses the box the thing really has, never an upright guess; a block the body is leaning into is not in the way; a block must cover a little of the view before it fades, and stays faded until it covers less (so edges do not flicker). Unit tests cover floor, wall and ceiling cases.

It is behind the compatibility flag `fadeBySight`: projects made before it keep the old rule (so nothing changes under the owner), new projects get the new one. To get it in an older project: Project settings -> Compatibility -> tick the box. **For "Upside Down" this is the recommended setting**, and it is the owner's to switch.

## What step 4.3 adds, and what it does to the two problems

Gravity is now a direction (see [blocks-and-gravity.md](blocks-and-gravity.md)), a body is a box that is stopped by every solid block in every direction, and the walls that fade are the ones the camera's line of sight really runs through.

- **Problem 2 (passed through):** under block physics a body glued to a wall is stopped by blocker cells, platforms, stacks with gaps and every other solid block, because it is the engine that moves it, with collision on every step. The test `e2e/p3-gravity-room.spec.ts` turns gravity to the floor, a wall, the ceiling and another wall in a room of mixed blocks (including blocker cells and a pillar out of the wall) and checks, on every fifth tick, that the player is never inside a block.
- **Problem 1 (see-through):** the body's real box in its current way up feeds the fade rule. `e2e/p3-gravity-play.spec.ts` plays the same room in the editor and compares, on the floor, on the west wall, on the ceiling and on the south wall, which ceiling blocks are drawn faded with which ones the rule says are in the way: they are the same.

Both are on only where the compatibility flags are on: new projects have them; an older project keeps playing as it did until the owner ticks the two boxes in Project settings -> Compatibility.
