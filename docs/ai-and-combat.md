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
- **Vision Cone** sees in front of it within a distance and a cone; walls and tall objects block the view and it cannot see far into the dark (light helps). It also hears footsteps nearby, louder when running, and **walls muffle them**: each wall cell between the guard and the footsteps counts as extra distance (the setting *Each wall in the way muffles footsteps by*, 3 cells by default; 0 = walls do not matter), so a guard does not hear you through a thick wall. Close to it you are always noticed.
- **Chase**: when its Vision Cone notices the target it chases (around walls and over stairs), stops near, searches where it was last seen (turning on the spot), then returns to where it started. Patrol stays out of the way while Chase steers.
- Walkers with a mind of their own (guards, archers...) **keep out of each other's way**: when two are closer than about a cell as they walk, each is pushed gently aside, so a crowd of chasers spreads out instead of piling onto one spot.
- Pathfinding (`findPath`, A*) honours, A\*) honours heights (stairs and ramps climb, ledges only drop so far), pits, water, walls, one-way edges and bridges, exactly like the walk-test tool, and walkers also avoid crates, closed gates and pillars.

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
## Ranged enemies: Ranged Attack
**Ranged Attack** (Combat) makes an object shoot instead of (or as well as) bumping: when its target (default: the player) is in range and nothing blocks the way, it stands still taking aim (*Seconds taking aim first*), fires one shot or a quick volley, then waits (*Seconds between volleys*). Settings: range and the closest it will shoot, speed, damage, how long a shot flies, a sound, and whether it needs a clear line. A shot is a plain glowing ball, or a copy of a **prefab** you choose (give the prefab the **Projectile** behaviour). Shots are aimed at where the target is when they leave, and climb or sink so they arrive at the target's height. **Projectile** itself now has *Damage*, *Hurts* and *Knockback*: with Damage above 0 it hurts what it hits (the player by default), is spent when it does, and never hurts whoever fired it. Wires: *Is taking aim or shooting* and *Just fired*; the **shot** event can start event rows. Place an **Archer** (Place tool, Enemies) to get a Ranged Attack, a Vision Cone and a Behaviour Tree that keeps its distance.

## Behaviour trees: decisions you draw
A **Behaviour Tree** is another way to give an object a brain (use it or a State Machine on one object, not both). Where a state machine says "I am in this mood, and these things change it", a tree is asked what to do many times a second, starting at the root:
- A **sequence** does its children in order and stops at the first that fails ("it sees the player, then it walks toward the player").
- A **selector** tries its children until one works ("chase if you can, otherwise look around, otherwise wander"). Because the order is the priority, put the most important branch first.
- **Parallel** does all its children at once; **Not** turns a yes into a no; **Always OK** counts a failed child as done; **Repeat** runs its child again (forever or N times); **Rest after** lets its child run, then refuses to run it again for some seconds (a boss's special attack).
- A **question** (condition) is yes or no: it sees or hears its target, has lost it for N seconds, the target is within or beyond N cells, its health is at or below N percent, luck (a percent chance, rolled once each time the question comes up and kept while it keeps being asked, so it does not flicker), a wire sends it a signal, a variable has a value.
- An **action** does something: wait, stand still, walk toward or away from its target, walk home, wander around nearby, turn to face the target, play an animation, say something, play a sound, set a variable, or **switch a behaviour on or off** (a guard that is harmless until it is angry). Walks take as long as they take; instant actions happen once, when the tree first gets to them.
- Because the tree is asked again every moment, a higher branch takes over the instant its question becomes true, and whatever was running below it starts afresh when it is asked again.

In the Inspector (Add a behaviour -> Behaviour Tree) the tree is drawn with the root on the left: a card for every node, coloured by kind, joined by lines. Click a card to edit it below: rename it, change what it asks or does, **Add** a child inside (or **+ Question** / **+ Action**), **Wrap** it in another node (wrap a question in *Not* to ask the opposite), move it earlier or later (**↑ ↓**: order is priority), **Copy branch**, **Delete** (with everything inside). **Start from an example** loads a **Guard** (chases what it sees, looks around, goes home, wanders), an **Archer** (keeps its distance, follows when far) or a **Wanderer** (ambles about, runs when hurt). **Make it bigger** opens it over the whole window. While the game runs, each card shows what it answered in the latest moment: green worked, red failed, orange is still going. The Problems panel reads trees too: nodes not connected to the root, empty sequences, a node used in two places, a loop, a missing variable or behaviour, a tree and a state machine on one object.

## Bosses
**Boss Phases** (on something with Health): at 60% and 25% of health (settings) it enters phase 2 and 3, moving faster and hitting harder each time, optionally calling in helpers (a prefab). With "only fights while the player is in its room" it stays frozen until the player is inside the Region around it that is marked "Bosses here only act while the player is inside". Signals: Is fighting, Phase 2, Phase 3, **Defeated** (stays on, so a door can stay open). It requires Health set to "Stays down".

## Tested by
Ranged attacks, muffled hearing and guards keeping apart: `packages/behaviors/src/ranged.test.ts`; behaviour trees: `packages/behaviors/src/tree.test.ts`, `packages/editor/src/renderer/model/tree-edit.test.ts`, `e2e/m15-ai.spec.ts` (an archer edited as a tree through the Inspector, then shooting from a distance in the game).

Unit: `packages/runtime/src/ai/pathfinding.test.ts`, `packages/behaviors/src/m7.test.ts` (damage, invulnerability, knockback, respawn, pit damage, melee arcs, dodge, patrol, A\* around walls and crates, vision cone/walls/dark/hearing, chase/search/return, boss phases and rooms, event rows), editor validators and the Patrol tool in `packages/editor/src/renderer/**`. End to end: `e2e/m7-combat.spec.ts` builds a guard with a patrol route and a boss arena through the UI, then sneaks, gets heard, wins the fight, enters the arena, beats the boss through all three phases and watches the gate open.
