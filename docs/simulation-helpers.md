# Simulation helpers

The **Simulation helpers** plugin (Project settings -> Plugins) gives any game the machinery of a colony builder, a tower defence or a village sim without a line of code. Nothing in it knows what a farm or a tower is: resources are ordinary variables, and every rule is a number in a data table or a field in the Inspector. Add the behaviours from **Add behaviour -> Simulation**.

| Helper | What it does |
| --- | --- |
| **Producer** | Every few seconds uses up what is in *Uses* (only if all of it is there) and adds what is in *Makes*. Chain them into a production line. If something is missing it says so on its *blocked* signal and waits. |
| **Calendar** | Keeps the date from the game clock: `time.hour`, `time.clock`, `time.day`, `time.season`, `time.seasonName`, `time.year`, `time.night`. Announces `new-day`, `day-start`, `night-start` and `new-season`. Can darken the picture at night. It stops while the game is paused or turn-based and runs faster when you speed the clock up. |
| **Wave Spawner** | Sends waves from a data table. Variables `wave.index`, `wave.total`, `wave.alive`, `wave.state`, `wave.countdown`; events `wave-started`, `wave-cleared`, `waves-done`. |
| **Path Follower** | Walks a route and announces `path-end`; can remove itself there. |
| **Utility Agent** | A villager that picks what to do from its needs and the time of day. |
| **Cellular Automaton** | Changes the map itself by neighbour rules (fire, crops, spreading water). |

Event blocks: the **the player can afford** condition, **it is night / a season / the morning**, **the wave is resting / arriving / being fought / done**, and the **pay**, **receive** and **start the next wave** actions. Costs are written `wood:2, stone:1`; paying is all-or-nothing and sets `spend.ok`.

## Recipes

### Resources and a production chain

1. You do not need to make variables: producers create `grain`, `flour` and `bread` when they first make them.
2. Put three objects on the map. Give the first **Producer** with *Makes* `grain:2`, *Uses* empty, 4 seconds. Give the second *Makes* `flour:1`, *Uses* `grain:2`. Give the third *Makes* `bread:3`, *Uses* `flour:1`.
3. Show the numbers with a **Resource bar** or a text widget bound to `bread`.
4. To sell: an event row *when the player clicks the shop* **and** *can afford* `bread:3` -> *pay* `bread:3`, *receive* `gold:12`.

### Day and night

1. Put a **Calendar** on any object (say, a "World" marker). Leave **Darken the picture at night** on.
2. Use *it is night* as a condition: lamps turn on, villagers go to bed, enemies spawn.
3. Press the 2x or 4x speed buttons: the day passes faster; pause and it stands still.

### Waves of enemies (tower defence)

1. In the **Data** panel make a table `Waves` with columns `prefab` (prefab), `count`, `gap` and `delay`. One row per wave: `Runner, 5, 0.8, 0`, `Brute, 3, 1.5, 0`...
2. Put an object at the entrance and give it **Wave Spawner** (*Table of waves* `Waves`, *Rest* 8). Tick **Keep going after the last wave** for endless play; later copies are 50% bigger each time.
3. Make the prefab with **Path Follower** (*Remove at the end* on) and put objects tagged `route` named "Waypoint 1", "Waypoint 2"... along the road. When one reaches the end the `path-end` event fires: an event row takes a life away.
4. Turn off *Start on its own* and use the **start the next wave** action from a button to make the player call each wave.

### Villagers with needs

1. Table `Activities` with columns `need`, `gain` (per second), `target` (a tag), `seconds`, `weight`, `when` (`any`, `day` or `night`) and `makes`.
2. Rows: `eat` (need `hunger`, gain 40, target `food`), `sleep` (need `energy`, target `bed`, when `night`), `chop` (no need, weight 30, target `tree`, makes `wood:1`).
3. Give the villager **Utility Agent** with *Needs* `hunger:1, energy:0.6`. Tag the farms `food`, houses `bed`, trees `tree`.
4. It chooses what is most wanted, walks to the nearest object with that tag, spends the time there, then chooses again. Activities with no matching object on the map are skipped.

### Fire spreading

1. Table `Automata` with columns `from`, `to`, `near`, `min` and `chance` (tile numbers from the palette).
2. Rule: `from` grass, `to` fire, `near` fire, `min` 1, `chance` 40. Rule: fire to ash with `near` 0, `chance` 20.
3. Put **Cellular Automaton** on any object. All cells change together using the game's seeded random numbers, so a replay burns identically. Only the changed cells are redrawn.

Behaviours in this plugin are covered by `packages/behaviors/src/sim.test.ts`.
