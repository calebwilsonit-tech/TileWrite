# Real time, speed-up and turn-based play

Real-time and turn-based are equal citizens: both run on the same maps, objects and rules. Only whether time passes by itself differs. Every scene has a **clock**.

## The clock
| Mode | What happens |
| --- | --- |
| **Real time** | The world moves every tick. At **2x, 4x or 8x** the game runs that many simulation steps for each real one (building and colony games speed up the boring parts). |
| **Paused** | Nothing moves; the interface still works (build menus, speed buttons). |
| **Turn-based** | Behaviours that move things by themselves (Patrol, Chase, Behaviour Tree, State Machine, Melee and Ranged Attack, Dodge, Projectile, Moving Platform, Spawner, Damage on Touch) stop, anything still coasting stops dead, and the direct player controller is off. Only what the turn system commands moves. |

Change it with the **Pause or resume the game, or change its speed** action (and test it with *The game clock is*). Game time (`clock.elapsed`, in 60ths of a second) only counts while the world is really moving, so day and night, seasons and growth timers built on it pause with the game and never advance in turn mode. The clock is part of saves and replays.

## Turn-based play (the **Turn-based play** plugin)
Switch the plugin on in Project settings -> Plugins. It adds three behaviours:
- **Turn Taker**: marks an object as a unit. *Team*, *speed in the order* (higher goes first), *action points* each turn, and how it attacks: *range* in cells, *damage*, the action points an attack costs, and *extra damage per level above the target* (**height advantage**: standing two levels above gives +2, below gives less; never less than 1). With *End the turn when out of action points* on, a person's unit ends its turn by itself.
- **Grid Mover**: walks a path cell by cell over stairs, ramps and heights (it respects the same step limits as the terrain). *Action points per cell*, speed, highest climb, furthest drop. It never walks through another unit, a crate, a closed gate or a wall.
- **Unit AI**: plays the unit's own turn: it scores every cell it can reach (nearer the enemy, able to hit from there, higher ground; *cautious* units keep their distance), walks there, attacks if it can and ends the turn. Enemy turns need nothing else.

Actions and conditions (all in plain English in the event sheet): *Start a turn-based battle*, *End the current turn*, *End the battle*, *Change action points*, *Move a unit to a cell*, *Make a unit attack the nearest enemy in range*; *It is a unit's turn*, *It is a team's turn*, *A battle has been won*. In rows, **The unit whose turn it is** is a way to point at an object.

How a battle runs: *Start a turn-based battle* puts every Turn Taker into the queue (fastest first) and switches the clock to turn-based. Each unit's turn: action points refill, `turn-start` is announced, the unit acts (a person through the interface, or its Unit AI), `turn-end` follows, and after a short pause the next unit goes. When every unit has gone, a new round starts (`round-start`). Units that die leave the queue. When only one team has units left the battle ends (`battle-won`), and the clock goes back to real time.

Numbers the interface and rows can read while a battle runs: `turn.round`, `turn.unit` (name), `turn.team`, `turn.ap` (action points left) and `battle.winner`: bind a label to `{turn.unit}` or a bar to `turn.ap`.

## For programmers
`beginTurns(ctx)`, `endTurn(ctx)`, `commandMove(ctx, unit, x, y)`, `commandAttack(ctx, attacker, target)`, `moveRange(ctx, unit)` (every reachable cell with its cost and path: the grid cursor control scheme draws it), `attackTargets(ctx, unit)`, `currentUnit(ctx)` are exported from `@tilewright/behaviors`. The queue is plain data in `runtime.turns`.

## Tested by
`packages/behaviors/src/turns.test.ts` (the clock, the queue, move range blocked by units and crates, attacks with height bonus, an enemy playing its turn, a battle driven only by event rows replaying identically), `e2e/p2-tactics.spec.ts` (the tactics sample).
