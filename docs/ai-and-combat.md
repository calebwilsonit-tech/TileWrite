# AI and combat (M7)

Everything is added from the Inspector's **Behaviours -> Add** menu or the Place tool's **Enemies** group; none of it needs code. Code: `packages/behaviors/src/builtins/{combat,ai}.ts`, `packages/runtime/src/ai/pathfinding.ts`.

## Health, damage, the quill and dodging
- **Health**: hit points, a short invulnerable moment after each hit (the object blinks), knockback, and what happens at zero: disappears, comes back at its start with full health, or stays down (and sends its **Dead** signal). Falling into a pit costs the "fall damage" and puts the object back on the last solid ground it stood on (this closes the owed pit-damage item). Enemies show hearts above them; the player's hearts are in the HUD while playing. Inputs: Heal fully, Kill. Side is automatic (the player is the player's side, everything else is an enemy); override it for neutral objects.
- **Damage on Touch**: hurts anything with Health that is close enough and on the side it hurts (player / enemies / anything), with knockback. Use it for enemies, spikes, lava.
- **Melee Attack (quill)**: **J** (or the left mouse button) swings in the direction you face: a short wind-up, an arc and reach, one hit per target per swing, then recovery. A pale swing shape shows where it reaches.
- **Dodge**: **Q** gives a quick dash in the direction you are moving (or facing) during which you cannot be hurt, then a cool-down.
- Event rows can react to *something is hurt*, *something is defeated*, *a guard notices something*, *a boss enters a new phase*, *a boss is defeated*, etc., test *an object's health*, and *hurt* / *heal* an object.

## Guards: Patrol, Vision Cone, Chase
- **Patrol** walks between waypoints, pausing at each. Draw the route with the **Patrol path** tool (F): select a guard, click cells to add points, Shift-click to remove the last. Routes and guards' view cones are drawn in the editor (selected guard bright). Needs two or more points; the Problems panel checks that every leg can actually be walked.
- **Vision Cone** sees in front of it within a distance and a cone; walls and tall objects block the view and it cannot see far into the dark (light helps). It also hears footsteps nearby, louder when running. Close to it you are always noticed.
- **Chase**: when its Vision Cone notices the target it chases (around walls and over stairs), stops near, searches where it was last seen (turning on the spot), then returns to where it started. Patrol stays out of the way while Chase steers.
- Pathfinding (`findPath`, A\*) honours heights (stairs and ramps climb, ledges only drop so far), pits, water, walls, one-way edges and bridges, exactly like the walk-test tool, and walkers also avoid crates, closed gates and pillars.

## Bosses
**Boss Phases** (on something with Health): at 60% and 25% of health (settings) it enters phase 2 and 3, moving faster and hitting harder each time, optionally calling in helpers (a prefab). With "only fights while the player is in its room" it stays frozen until the player is inside the Region around it that is marked "Bosses here only act while the player is inside". Signals: Is fighting, Phase 2, Phase 3, **Defeated** (stays on, so a door can stay open). It requires Health set to "Stays down".

## Tested by
Unit: `packages/runtime/src/ai/pathfinding.test.ts`, `packages/behaviors/src/m7.test.ts` (damage, invulnerability, knockback, respawn, pit damage, melee arcs, dodge, patrol, A\* around walls and crates, vision cone/walls/dark/hearing, chase/search/return, boss phases and rooms, event rows), editor validators and the Patrol tool in `packages/editor/src/renderer/**`. End to end: `e2e/m7-combat.spec.ts` builds a guard with a patrol route and a boss arena through the UI, then sneaks, gets heard, wins the fight, enters the arena, beats the boss through all three phases and watches the gate open.
