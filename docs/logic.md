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
