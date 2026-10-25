# No-code logic (M5)

Everything here is done from the editor; none of it needs code. Code lives in `packages/behaviors` (behaviours, signals, event sheets) and `packages/runtime/src/project/prefab.ts` (prefabs).

## Behaviours
A behaviour is a named bundle of settings plus a system that runs every tick. Pick an object, then use **Behaviours -> Add** in the Inspector. Each setting has a plain-English label and help text; the behaviour's one-line description is shown at the top.

Built in: Pressure Plate (momentary or latched, activated by anything / the player / crates), Trigger Zone, Lever, Timer, Logic Gate, Gate/Door, Pushable, Spawner, Pickup, Moving Platform, Falling Floor, Projectile, Follow Camera. (Health, Damage, Patrol, Chase, Vision, Boss arrive in M7; inventory/NPC/Checkpoint/Portal in M8; echo, light, sentence stones in M6.)

Order each tick: controller -> signal sources (plates, levers, timers) -> wires and logic nodes (settled to a fixpoint) -> actuators (gates, spawners, platforms) -> event sheet -> physics -> animation. Everything is deterministic (fixed 60 Hz), so replays and the playbot see the same thing.

Adding a behaviour that needs other parts (for example a Pressure Plate needs a collider) adds them. If something is missing later, the Problems panel says so in plain English.

## Signals and wires
Behaviours have **inputs** and **outputs** (for example Pressure Plate sends "active"; Gate receives "open"). Use the **Wire** tool (Y): drag from one object to another and choose which signal leaves and which enters. If either side has nothing to send/receive, a dialog explains what to add. Wires are drawn in the viewport (the selected object's wires are highlighted) and listed in the Inspector under Wires, where they can be removed. Several wires into one input combine with OR; use a Logic Gate object (AND / OR / NOT / XOR / toggle / delay) for anything else.

## Event sheets
The **Events** panel is a list of rows: *When* conditions, *Do* actions, in plain English ("When "Gate" sends the signal "isOpen" on, set solved to 1."). Conditions can be negated, rows can be limited to "only the moment it becomes true", repeated, or run for each matching object, with sub-events. Mistakes (no prefab chosen, unknown object, ...) are listed under the sheet and in the Problems panel. Variables used by rows are declared in the scene and shown in the variable list.

## Prefabs
**Make a prefab from this object...** in the Inspector writes `assets/prefabs/<name>.prefab.json`. Instances in a scene are stored as *overrides only* (plus their position), so changing the prefab changes every instance that has not overridden that setting. The prefab banner offers **Apply to prefab**, **Revert overrides** and **Unlink**. Prefabs can nest. Deleting a prefab leaves its instances in place and the banner says it no longer exists. The Assets panel lists prefabs and places them.

## Platforms
Solid objects (crates) can be stood on; Moving Platforms carry what stands on them (`standingOn`).

## Tested by
Unit: `packages/behaviors/src/*.test.ts`, `events/sheet.test.ts`, `packages/editor/src/renderer/model/logic.test.ts`. End to end (real window, real mouse): `e2e/m5-logic.spec.ts` builds the plate/gate/crate puzzle and solves it, and exercises prefabs through save and reload.

## One logic system, three levels (phase 2)

Everything that reacts to something - a button, a plate, a timer, a defeated enemy, a turn starting - is made at one of three levels, and they all edit the same underlying things, so you can move between them.

| Level | Where | Good for |
| --- | --- | --- |
| 1. **Quick actions** | Inspector, *Quick actions* | menus and simple reactions: "when clicked: go to a scene, add to a variable, play a sound, save, quit" |
| 2. **Wires** | the **Wire** tool in the viewport, with Event, Action and Logic nodes | seeing the signal travel: a plate through an AND gate to a door |
| 3. **Graph** | the **Graph** panel | anything bigger: ifs, repeats, for-each over tags or table rows, waits, functions |

### What things announce and what they can be told

Every object offers *events* (from its behaviours: Clickable gives "On click", "On right-click" and "While the pointer is over it"; a Pressure Plate "While pressed"; a Timer "When the time is up"; a Health object "Is defeated" and "Is hurt"; a Turn Taker "Its turn starts") and *actions* ("Gate: Open, Close, Open or close", "Timer: Start", "Show", "Hide", "Remove from the game", "Hurt", "Heal"). Only what is valid for the object is listed. Plugins add their own; switching a plugin off removes its events and actions from the menus and the Problems panel flags anything that still uses them.

### Level 1: Quick actions
Select an object. Under **Quick actions** pick *When this object* (an event), then **+ Then do...** for a common action (Go to a scene, Start a new run, Continue, Save, Quit, Set / Add to / Flip a variable, Play a sound, Show a dialogue, Create an object, Pay a cost, Start the next wave, End the turn...) or **Or make something happen to** another object and choose what to do to it. Chain as many as you like; they run in order. Objects with nothing to click get a **Make it clickable** button.

Recipe: *a button that opens a door.* Place a **Button (clickable)** and a **Gate**. Select the button, choose *Or make something happen to: Gate*, then *Open*. Play and click the button.

### Level 2: Wires and nodes
Drag with the **Wire** tool from one object to another. The dialog offers **Pass the signal on** (a plate's "pressed" level into a gate's "open" - it stays on while the plate is down) or **Make something happen** (an event of the first, an action on the second). Under the hood this places:

- an **Event node** - watches anything an event row can see (a variable, "the player is near", "an object is defeated") and sends *Is true* and *Happened (one tick)*;
- an **Action node** - does a list of actions when its *Do it* input turns on, then pulses *Done*;
- **Logic Gates** - AND, OR, NOT, XOR, latch, toggle, delay, pulse, and now **Counter** (on after N pulses), **Random** (on by chance) and **Compare** (on while a variable compares true).

Nodes made for an object are marked as its own, shown as small diamonds and boxes in the viewport and hidden in the game. Wires are drawn as yellow lines; blue dotted lines run from an Action node to each object its actions change. **Layers -> Wires** turns them off. While the game plays in the editor the wires **glow green** the moment a signal runs through them and fade over half a second.

### Level 3: Graphs
The **Graph** panel draws a flow as boxes joined by lines:

| Box | What it does |
| --- | --- |
| **When...** | starts a flow when its conditions hold (the moment they become true, or every tick) |
| **Do...** | one action: any block of the event sheet |
| **If...** | goes down *yes* or *no* |
| **Repeat** | runs its body a number of times |
| **For each...** | once for every object with a tag or every row of a data table (`{row.cost}`) |
| **Wait** | carries on after some seconds (the wait is saved with the game) |
| **Function** / **Call function** | a named flow other graphs can call; **Collapse into a function** turns selected boxes into one |

Use the **search box** to add a box: type "variable" and pick *Do: Change a variable*; select an object in the viewport first and its own actions ("Gate: Open") are offered. Drag from a round output pin to another box to join them; Delete removes the selected box or line. A flow that would go round in a circle is refused (use Repeat). Boxes glow while the game plays, and the red dot on a box is a **breakpoint**: the game stops there, a red banner says where, and **Resume** or **Step** carry on. Event rows have the same breakpoint tick box, and so do Event and Action nodes.

Moving between levels, one undo step each:

- **Open as a graph** (Quick actions) turns an object's quick actions and their nodes into a graph.
- **From event sheet** moves every row into a graph (switched-off rows are left out). **To event sheet** turns a graph back into rows when it has the shape of a sheet - events, then actions, then ifs, with a Repeat first or a For each at the top. If a box does not fit (a Wait in the middle, a Call), the message names it and nothing changes.
- An event sheet can still be converted to code (**Convert to code** in the Events panel), so a graph can go graph -> sheet -> code.

### Problems it finds
The Problems panel lists, each with a one-click fix: a wire to a deleted object, a wire to a signal that no longer exists, an action node whose action points at a deleted object or at a switched-off plugin, an action node nothing triggers, an event node wired to nothing, a graph line to a deleted box, a box nothing leads to, a Call to a function that does not exist.

### Honest limits
Graph boxes pass values through variables (there are no value pins), so "math" is the expression in *Change a variable* ("{row.cost} * 2"). A Wait remembers only the time left, not which object was being looped over. Functions live in the scene they were made in. Graphs and nodes in custom behaviours are not yet available (their event rows are).

Tested by: `packages/behaviors/src/{graph,nodes}.test.ts`, `packages/editor/src/renderer/model/{logic-edit,graph-edit}.test.ts`, and `e2e/p2-logic.spec.ts` (builds a button that opens a gate with menus only, adds a wire with the dialog, opens the logic as a graph, adds a Wait with the search box, sets a breakpoint and hits it in play, converts to and from the event sheet, and fixes a broken action with one click).

## Seeing what fired, and stopping there

The **What fired** panel (next to the Console) lists, while the game plays, everything that fired, newest first: event rows, graph boxes, wire nodes, **state machines** (a state was entered) and **behaviour trees** (an action started to run), with a filter by kind. A **breakpoint** (a checkbox on an event row, a graph box, a wire node, a state, or a tree's action) stops the game in the editor at the moment it fires; the viewport says which, and you can resume or step. State machines and behaviour trees decide for themselves (they keep their own memory of how long they have been in a state and what a node is doing), so they do not run the event sheet's conditions and actions; to make something happen in the world from one, set a variable (a state's message and a tree's `setVariable` action do) and let an event row or a graph act on it. See DECISIONS.md, D058.
