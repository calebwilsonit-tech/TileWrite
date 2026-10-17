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

## State machines: moods you draw
Patrol, Vision Cone and Chase already make a guard, but a **State Machine** lets you decide the moods yourself: a boss that watches, attacks, backs off and then rages when it is hurt; a guard that gives up after a few seconds. Add **State Machine** to any object (Inspector -> Add a behaviour) and the Inspector draws it:

- A **card** for every **state** (Patrol, Chase, Look around...). The green outline is where the object starts. Drag cards to arrange them; **Make it bigger** gives the graph the whole window.
- An **arrow** from state to state for every "when this happens, change to that". Drag from the blue dot on a card to another card to add one, then choose its condition below. Arrows are labelled with their condition in words; click the label to edit it.
- **Start from an example** fills in a *Guard* (patrol, chase what it sees, look around, go back, patrol again) or a *Boss* (watch, attack, back off, rage below 40% health) that you can change.

What a state does:
| Setting | Meaning |
| --- | --- |
| Behaviours that run here | Tick the behaviours that are active in this state (Patrol, Vision Cone, Chase, Damage on Touch, a script...). A behaviour that some state ticks but this one does not is **switched off** here. Behaviours no state mentions are never touched. |
| Moves | Stands still, walks toward its target, walks away from it, or walks back to where it started (around walls and over stairs), at the speed you set. |
| Animation / Message / Sound | Played when the object enters the state. |

Conditions an arrow can wait for: it sees or hears its target, it has lost its target for N seconds, its target is within or beyond N cells, its health is at or below N percent, it has been in the state N seconds, a wire sends it a signal (the **Trigger** input), a variable has a value, the walk has arrived, it is defeated. Arrows leaving a state are tried from first to last and the first whose condition holds is taken, so order the important ones first (**Earlier / Later**); **Add an arrow from any state** makes one that applies everywhere. Each change of state announces a **state-changed** event that event rows can react to.

The Problems panel reads machines too: a start state that does not exist, an arrow to a missing state, a state nothing leads to, a state with no way out, a behaviour a state uses that the object does not have.
## Bosses
**Boss Phases** (on something with Health): at 60% and 25% of health (settings) it enters phase 2 and 3, moving faster and hitting harder each time, optionally calling in helpers (a prefab). With "only fights while the player is in its room" it stays frozen until the player is inside the Region around it that is marked "Bosses here only act while the player is inside". Signals: Is fighting, Phase 2, Phase 3, **Defeated** (stays on, so a door can stay open). It requires Health set to "Stays down".

## Tested by
Unit: `packages/runtime/src/ai/pathfinding.test.ts`, `packages/behaviors/src/m7.test.ts` (damage, invulnerability, knockback, respawn, pit damage, melee arcs, dodge, patrol, A\* around walls and crates, vision cone/walls/dark/hearing, chase/search/return, boss phases and rooms, event rows), editor validators and the Patrol tool in `packages/editor/src/renderer/**`. End to end: `e2e/m7-combat.spec.ts` builds a guard with a patrol route and a boss arena through the UI, then sneaks, gets heard, wins the fight, enters the arena, beats the boss through all three phases and watches the gate open.
