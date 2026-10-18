# Behaviours

<!-- Generated from the behaviour registry by packages/behaviors/src/docs.test.ts. Run `UPDATE_DOCS=1 npx vitest run packages/behaviors/src/docs.test.ts` after changing a behaviour. -->

A behaviour is ready-made logic you add to an object in the Inspector (**Behaviours -> Add**). Its settings appear as fields; its signals can be joined to other objects with the Wire tool. Each behaviour has an id (the key under which it is saved) shown in `code`.

There are 48 behaviours. Behaviours made by scripts (see [code-window.md](code-window.md)) appear in the same list under "Scripts".

- [AI](#ai) (Vision Cone, Chase, Patrol, Boss Phases, State Machine, Behaviour Tree)
- [Combat](#combat) (Health, Damage on Touch, Melee Attack (quill), Dodge, Ranged Attack)
- [Control schemes](#control-schemes) (Direct Control, Click to Move, Hotspot, Grid Cursor, Commandable Unit, RTS Control, Camera Rig, Builder)
- [Light](#light) (Light, Light Resource (lantern fuel), Light Sensor, Growing Object)
- [Logic](#logic) (Logic Gate)
- [Movement](#movement) (Grid Mover)
- [Player](#player) (Echo Recorder)
- [Puzzle](#puzzle) (Pressure Plate, Trigger Zone, Lever, Timer, Gate / Door, Pushable)
- [Story](#story) (NPC Talk, Sound Source, Minigame, Scene Portal, Cutscene Trigger, Lantern Post (checkpoint))
- [Story puzzles](#story-puzzles) (Sentence Stone, Formattable Text Block)
- [Turn-based](#turn-based) (Turn Taker, Unit AI)
- [World](#world) (Spawner, Pickup, Moving Platform, Falling Floor, Projectile, Follow Camera)

## AI

### Behaviour Tree

Id: `behaviorTree`. Each update it brain.

Gives an object a way of deciding what to do, as a tree of questions and actions that is asked many times a second. A sequence does things in order and stops at the first that fails; a selector tries things until one works; conditions ask ("does it see the player?"), actions do ("walk toward it", "wait", "switch a behaviour off"). Because the tree is asked again every moment, a high-priority branch (chase the player) interrupts a low-priority one (wander) the instant its condition holds. Draw it in the tree under the settings, or start from the Guard, Archer or Wanderer example. Use either a Behaviour Tree or a State Machine on one object, not both.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Looks at and moves toward things tagged | `target` | text | "player" |  |

Receives: **Trigger** (`trigger`, A "a wire sends it a signal" condition is true while this is on.).

### Boss Phases

Id: `bossPhases`. Each update it moves things (runs first).

Turns an enemy into a boss: it gets faster and harder-hitting as its health runs down, can call in helpers at each phase, and only fights while the player is in its room. Wire its signals to doors: "Phase 2", "Phase 3", "Defeated".

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Phase 2 starts at health (%) | `phase2At` | number | 60 | 1 to 99 |
| Phase 3 starts at health (%) | `phase3At` | number | 25 | 1 to 98 |
| Faster each phase (times) | `speedUp` | number | 1.3 | 1 to 3 |
| Stronger each phase (times) | `damageUp` | number | 1.25 | 1 to 5 |
| Only fights while the player is in its room | `onlyInRoom` | boolean | true |  |
| Calls in helpers each phase (prefab) | `summonPrefab` | prefab | (empty) |  |
| How many helpers | `summonCount` | number | 1 | 1 to 6 |

Sends: **Is fighting** (`active`); **Phase 2 or later** (`phase2`); **Phase 3** (`phase3`); **Defeated** (`defeated`).

Adds automatically: `health`.

### Chase

Id: `chase`. Each update it moves things (runs first).

When its Vision Cone sees or hears the target it chases it (around walls and over stairs), then searches where it was last seen, then returns to where it started. Combine with Patrol for a guard and with Damage on Touch so it can hurt.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Chase speed (cells per second) | `speed` | number | 3.2 | 0.5 to 15 |
| Looks around for (seconds) | `searchSeconds` | number | 3 | 0 to 30 |
| Stops this close to its target (cells) | `stopDistance` | number | 0.7 | 0 to 5 |
| Goes back to where it started afterwards | `returnHome` | boolean | true |  |

Sends: **Is chasing or searching** (`alert`); **Is chasing** (`chasing`).

Adds automatically: `vision`.

### Patrol

Id: `patrol`. Each update it moves things (runs first).

Walks between waypoints, pausing at each. Draw the route with the Patrol path tool. It stays out of the way while Chase is steering.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Route (x,y; x,y; ...) | `points` | text | (empty) | Easier: pick this object and use the Patrol path tool to click the route on the map. |
| At the end of the route | `mode` | select | "loop" | `loop`, `pingpong` |
| Speed (cells per second) | `speed` | number | 1.8 | 0.2 to 10 |
| Pause at each point (seconds) | `waitSeconds` | number | 0.8 | 0 to 30 |

### State Machine

Id: `stateMachine`. Each update it brain.

Gives an object moods: it is in one state at a time (Patrol, Chase, Search, Flee...). Each state says which behaviours run, how it moves by itself, which animation plays and what it says, and arrows between states say when it changes its mind (it sees you, you are close, its health is low, a few seconds have passed...). Draw it in the graph under the settings, or start from the Guard or Boss example.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Looks at and moves toward things tagged | `target` | text | "player" |  |

Receives: **Trigger** (`trigger`, A "a wire sends it a signal" transition fires while this is on.).

### Vision Cone

Id: `vision`. Each update it makes signals.

Sees things in front of it, within a distance and a cone. Walls block its view, and it cannot see far into the dark. It also hears footsteps nearby. Chase uses this to notice you.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| How far it sees (cells) | `range` | number | 6 | 1 to 30 |
| Width of the view (degrees) | `angle` | number | 100 | 10 to 360 |
| How far it hears footsteps (cells) | `hearing` | number | 3 | 0 to 20 |
| Each wall in the way muffles footsteps by (cells) | `muffle` | number | 3 | 0 to 20. Walls between it and the footsteps count as extra distance, so a guard does not hear you through a thick wall. 0 = walls do not matter. |
| Looks for things tagged | `target` | text | "player" |  |
| Always notices within (cells), even in the dark | `closeRange` | number | 1.3 | 0 to 5 |
| Cannot see where it is darker than | `darkThreshold` | number | 0.3 | 0 to 1 |

Sends: **Sees its target** (`seen`); **Hears its target** (`heard`).

## Combat

### Damage on Touch

Id: `damageOnTouch`. Each update it reacts to signals (runs last).

Hurts anything that is close enough and has Health: enemies that bump into you, spikes, lava, projectiles.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Damage | `amount` | number | 1 | 0 to 99 |
| Hurts | `hurts` | select | "player" | `player`, `enemies`, `anything` |
| Reach beyond its edge (cells) | `range` | number | 0.6 | 0 to 5 |
| Knockback (cells per second) | `knockback` | number | 6 | 0 to 20 |

### Dodge

Id: `dodge`. Each update it moves things (runs first).

Press the Dodge button for a quick burst of movement in the direction you are moving (or facing). You cannot be hurt while dodging.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Speed (cells per second) | `speed` | number | 9 | 2 to 30 |
| How long (seconds) | `seconds` | number | 0.22 | 0.05 to 1 |
| Wait before the next one (seconds) | `cooldown` | number | 0.7 | 0 to 5 |
| Cannot be hurt while dodging | `invulnerable` | boolean | true |  |

### Health

Id: `health`. Each update it moves things (runs first).

Hit points. Hurt by Damage on Touch and weapons, briefly invulnerable after a hit, takes damage from falling into pits, and dies, respawns or stays down at zero.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Hit points | `max` | number | 3 | 1 to 999 |
| Invulnerable after a hit (seconds) | `invulnerableSeconds` | number | 0.7 | 0 to 5 |
| At zero | `onDeath` | select | "remove" | `remove`, `respawn`, `stay` |
| Damage from falling into a pit | `fallDamage` | number | 1 | 0 to 99 |
| Side | `team` | select | "auto" | `auto`, `player`, `enemy`, `neutral` |
| Show hearts above it (not for the player) | `showBar` | boolean | true |  |

Receives: **Heal fully** (`heal`, A rising signal restores all hit points.); **Kill** (`kill`, A rising signal takes all its hit points.).

Sends: **Is down** (`dead`); **Was just hit** (`hurt`).

### Melee Attack (quill)

Id: `meleeAttack`. Each update it moves things (runs first).

Press the Attack button (J) to swing in the direction you face, hurting enemies in front of you. A short wind-up and recovery keep it fair.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Damage | `damage` | number | 1 | 0 to 99 |
| Reach (cells) | `range` | number | 1.4 | 0.5 to 6 |
| Swing width (degrees) | `arc` | number | 120 | 20 to 360 |
| Wind-up (seconds) | `windup` | number | 0.08 | 0 to 1 |
| Hurts for (seconds) | `active` | number | 0.16 | 0.02 to 1 |
| Recovery (seconds) | `cooldown` | number | 0.3 | 0 to 3 |
| Knockback (cells per second) | `knockback` | number | 7 | 0 to 20 |
| Hurts | `hurts` | select | "enemies" | `enemies`, `anything`, `player` |
| Freeze on a hit (seconds) | `hitStop` | number | 0.05 | 0 to 0.2 |
| Screen shake on a hit (pixels) | `shake` | number | 2 | 0 to 14 |

### Ranged Attack

Id: `rangedAttack`. Each update it reacts to signals (runs last).

Shoots at its target from a distance: when the target is in range (and nothing blocks the way) it stands still for a moment taking aim, then fires one shot or a quick volley, then waits before the next. A shot is a plain glowing ball, or a copy of a prefab with the Projectile behaviour. Combine with Patrol, Chase or a State Machine; a State Machine state can switch it on and off.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Shoots at things tagged | `target` | text | "player" |  |
| Shoots up to (cells) | `range` | number | 8 | 1 to 30 |
| Does not shoot closer than (cells) | `minRange` | number | 0 | 0 to 20 |
| Seconds between volleys | `cooldown` | number | 2 | 0.1 to 30 |
| Seconds taking aim first | `windup` | number | 0.4 | 0 to 5 |
| Shots in a volley | `volley` | number | 1 | 1 to 8 |
| Seconds between the shots of a volley | `volleyGap` | number | 0.15 | 0.03 to 2 |
| Shot speed (cells per second) | `speed` | number | 7 | 1 to 30 |
| Damage of a shot | `damage` | number | 1 | 0 to 99 |
| Seconds a shot flies | `lifetime` | number | 2.5 | 0.2 to 20 |
| Only when no wall is in the way | `needSight` | boolean | true |  |
| Shoot a prefab (empty = a plain ball) | `prefab` | prefab | (empty) |  |
| Sound at each shot (a file in Assets -> Sounds) | `sound` | text | (empty) |  |

Sends: **Is taking aim or shooting** (`aiming`); **Just fired** (`shot`).

## Control schemes

### Builder

Id: `builder`. Each update it moves things (runs first).

Place buildings from a data table: pick one (the variable "build.selected" holds its row id), move the pointer to see a ghost footprint (green where it fits, red where it does not), R turns it a quarter turn, click to place it and pay its cost, right-click to put it away. Holding the button and dragging places 1 x 1 pieces (walls, fences) along the way. Footprints can be any number of cells.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Table of buildings | `table` | text | "Buildings" | Needs the columns prefab, w, d and cost. |
| Paid from the variable | `currency` | text | "gold" |  |
| Highest slope a building may stand on (levels) | `flatness` | number | 0 | at least 0 |

### Camera Rig

Id: `cameraRig`. Each update it moves things (runs first).

A free camera for builders and strategy games: the move buttons (or the pointer at the edge of the picture, or the middle mouse button dragged) pan it, the mouse wheel zooms, and the camera-turn buttons (Q and E) turn the whole world between the four isometric views. Put it on any object.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Pan speed (cells per second) | `panSpeed` | number | 12 | at least 1 |
| Pan when the pointer is at the edge | `edgePan` | boolean | true |  |
| Furthest out (zoom) | `zoomMin` | number | 0.5 | at least 0.25 |
| Closest in (zoom) | `zoomMax` | number | 2.5 | at least 1 |
| Turn the view with Q and E | `rotate` | boolean | true |  |

### Click to Move

Id: `clickToMove`. Each update it moves things (runs first).

Point-and-click movement: click the ground and this object walks there, around walls, up stairs and over bridges. Clicking a Hotspot walks up to it and uses it.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Walking speed (cells per second) | `speed` | number | 4 | at least 0.5 |
| Show where it is going | `marker` | boolean | true |  |

Sends: **Walking** (`walking`).

Adds automatically: `body`.

### Commandable Unit

Id: `commandable`. Each update it moves things (runs first).

A unit that follows orders (move, attack, attack-move, stop), one after another when queued. Crowds of them share one flow field per destination, so hundreds can move at once without bumping into each other. Units on a team attack enemies that come close by themselves if "Auto-attack range" is more than 0.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Team | `team` | text | "blue" |  |
| Walking speed (cells per second) | `speed` | number | 3 | at least 0.5 |
| Personal space (cells) | `spacing` | number | 0.7 | at least 0.2 |
| Attack range (cells) | `attackRange` | number | 1.2 | at least 0.5 |
| Attack damage | `attackDamage` | number | 2 | at least 0 |
| Seconds between attacks | `attackCooldown` | number | 0.8 | at least 0.1 |
| Auto-attack range (0 = only when ordered) | `aggro` | number | 4 | at least 0 |

Adds automatically: `body`.

### Direct Control

Id: `playerController`. Each update it moves things (runs first).

The player walks, runs and jumps with the move buttons (WASD or the arrows, Shift, Space). The classic action-game control. Without it nothing moves by itself: other control schemes (click to move, a grid cursor, an RTS selection) are other behaviours.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Walking speed (cells per second) | `speed` | number | 4 | at least 0.5 |
| Run speed multiplier | `runMultiplier` | number | 1.6 | at least 1 |
| Jump strength (0 = cannot jump) | `jumpSpeed` | number | 11 | at least 0 |

Adds automatically: `body`.

### Grid Cursor

Id: `gridCursor`. Each update it moves things (runs first).

Tactics controls: a cursor over the grid. Click one of your units to select it (the cells it can walk to light up blue, enemies in reach red), click a blue cell to walk there, click an enemy in reach to attack, right-click to deselect, and the End turn button ends the turn. Put it on any object (an empty "Controls" object works).

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Team the person plays | `team` | text | "blue" |  |
| Tint movement and attack range | `showRange` | boolean | true |  |

### Hotspot

Id: `hotspot`. Each update it combines signals.

Something to click: with the Look, Use or Talk verb chosen (the variable "verb"), the walker goes up to it and its words are said, or a conversation starts ("dialogue:Name"). Event rows can react with the "A hotspot was used" condition.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Name shown under the pointer | `label` | text | "Thing" |  |
| Look says (or dialogue:Name) | `look` | text | "Nothing special." |  |
| Use says (or dialogue:Name) | `use` | text | (empty) |  |
| Talk says (or dialogue:Name) | `talk` | text | (empty) |  |
| How close to stand (cells) | `reach` | number | 1.5 | at least 0.5 |

Sends: **Was used** (`used`).

### RTS Control

Id: `rtsControl`. Each update it moves things (runs first).

Real-time strategy controls: click a unit or drag a box to select units, right-click the ground to send them there (spread out), right-click an enemy to attack, Shift+right-click to queue the order after the current ones, A then click to attack-move, S to stop. Put it on any object (an empty "Controls" object works).

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Team the person plays | `team` | text | "blue" |  |
| Smallest drag that makes a box (pixels) | `boxMin` | number | 6 | at least 2 |

## Light

### Growing Object

Id: `growing`. Each update it reacts to signals (runs last).

Rises over time like proving dough, and grows faster near light. As it grows it becomes a taller solid block, so it can become a platform or a wall. Its Shrink signal makes it deflate again.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Seconds to grow fully (in the dark) | `growSeconds` | number | 20 | 1 to 600 |
| Times faster in full light | `lightBoost` | number | 4 | 1 to 20 |
| Full height (levels) | `maxHeight` | number | 2 | 0.5 to 8 |
| Starts fully grown | `startFull` | boolean | false |  |

Receives: **Shrink** (`shrink`, While on, it deflates instead of growing.).

Sends: **Fully grown** (`full`).

Adds automatically: `collider`.

### Light

Id: `light`. Each update it reacts to signals (runs last).

Lights up the area around it so dark rooms are visible. Walls and tall objects cast shadows. Lights can be turned on and off with a wire. Put it on the player for a lantern.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| How far it reaches (cells) | `radius` | number | 5 | 1 to 20 |
| Brightness | `intensity` | number | 1 | 0.1 to 1 |
| Colour | `color` | select | "warm" | `warm`, `white`, `cool`, `green`, `red` |
| Walls and tall objects cast shadows | `shadows` | boolean | true |  |
| Flicker | `flicker` | number | 0.15 | 0 to 1 |
| When it shines | `mode` | select | "always" | `always`, `whenOn`, `whenOff` |

Receives: **Switch** (`switch`, Turns the light on or off, depending on the "When it shines" setting.).

### Light Resource (lantern fuel)

Id: `lightResource`. Each update it makes signals.

Makes light a resource, like health: the lantern burns down, its glow shrinks as it empties, and the player must find light to refill it (stand near a lantern post or torch, or rest at a lantern post). The amount is the variable "light" (out of "lightMax"), so event rows, items and conversations can read it and add to it; the game shows a bar under the hearts. Put it on the player, next to a Light.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Most light it holds | `max` | number | 100 | 1 to 1000 |
| Burns down per second | `burn` | number | 2 | 0 to 100 |
| Regained per second near another light | `refillNearLight` | number | 12 | 0 to 200 |
| How bright another light must make this spot (0 to 1) | `nearLightLevel` | number | 0.45 | 0.05 to 1 |
| Damage every two seconds in the dark when empty (0 = none) | `hurtWhenEmpty` | number | 0 | 0 to 20 |
| Its glow reaches this far when empty (cells) | `emptyRadius` | number | 1.5 | 0 to 20 |
| Flickers and signals Low below (percent) | `lowPercent` | number | 25 | 0 to 100 |
| Resting at a lantern post fills it up | `refillOnRest` | boolean | true |  |

Sends: **Is running low** (`low`); **Is empty** (`empty`).

Adds automatically: `light`.

### Light Sensor

Id: `lightSensor`. Each update it makes signals.

Sends a signal while the spot it stands on is lit (or while it is dark). Use it for puzzles like "light the statue to open the door".

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Sends a signal when it is | `mode` | select | "lit" | `lit`, `dark` |
| How bright counts as lit | `threshold` | number | 0.5 | 0.1 to 1 |

Sends: **Condition met** (`active`).

## Logic

### Logic Gate

Id: `logic`. Each update it combines signals.

Combines signals: AND, OR, NOT, XOR, a latch that remembers, a toggle, a delay, or a timed pulse. Place it in the world and wire things into it.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Kind | `kind` | select | "and" | `and`, `or`, `not`, `xor`, `nand`, `nor`, `latch`, `toggle`, `delay`, `pulse` |
| Seconds (delay / pulse) | `seconds` | number | 1 | 0 to 600 |

Receives: **A** (`a`); **B** (`b`); **In (for NOT, toggle, delay, pulse)** (`in`); **Set (latch)** (`set`); **Reset (latch)** (`reset`).

Sends: **Out** (`out`).

## Movement

### Grid Mover

Id: `gridMover`. Each update it reacts to signals (runs last).

Moves an object cell by cell along a path, over stairs and heights, one step at a time (it never stops between cells). Turn-based units use it; so can a real-time game that moves on a grid. Orders come from the interface, a Unit AI, or the "Move a unit" action.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Action points per cell | `moveCost` | number | 1 | at least 0 |
| Walking speed (cells per second) | `speed` | number | 6 | at least 1 |
| Highest step it can climb (levels) | `stepUp` | number | 1 | at least 0 |
| Furthest it will step down (levels) | `maxDrop` | number | 2 | at least 0 |

Sends: **Moving** (`moving`).

Adds automatically: `body`.

## Player

### Echo Recorder

Id: `echoRecorder`. Each update it moves things (runs first).

Press the Echo button to start recording your movement and press it again to finish: a ghost echo then repeats it. Echoes can stand on pressure plates. Starting a new recording restarts every echo so they all play together.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Longest recording (seconds) | `seconds` | number | 8 | 1 to 60 |
| How many echoes at once | `capacity` | number | 1 | 0 to 8 |
| Extra echoes come from this variable (optional) | `capacityVariable` | text | (empty) | Set that variable in the event sheet (for example when the player finds a story item) to allow more echoes. |
| When an echo finishes | `ending` | select | "hold" | `hold`, `loop`, `vanish` |
| Ghost see-through amount | `ghostAlpha` | number | 0.55 | 0.1 to 1 |

## Puzzle

### Gate / Door

Id: `gate`. Each update it reacts to signals (runs last).

A solid barrier that slides open while its Open signal is on (or off, if inverted).

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Open when the signal is OFF | `invert` | boolean | false |  |
| Seconds to open | `speed` | number | 0.6 | 0 to 10 |
| Height when closed | `closedHeight` | number | 1.6 | 0.2 to 6 |
| Echoes can pass through | `ghostsPass` | boolean | false |  |

Receives: **Open** (`open`).

Sends: **Fully open** (`isOpen`).

Adds automatically: `collider`.

### Lever

Id: `lever`. Each update it makes signals.

The player flips it with the interact button when standing close. Sends a signal while it is on.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| How close the player must be | `reach` | number | 1.3 | 0.5 to 4 |
| Only on while held | `momentary` | boolean | false |  |
| Starts on | `startOn` | boolean | false |  |

Sends: **On** (`on`).

### Pressure Plate

Id: `pressurePlate`. Each update it makes signals.

Sends a signal while something stands on it (or for good once pressed, if it latches). Wire it to a gate, a spawner or a logic node.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Pressed by | `activatedBy` | select | "anyone" | `anyone`, `player`, `crates`, `echoes` |
| How many are needed | `needs` | number | 1 | 1 to 8 |
| Stays down once pressed | `latch` | boolean | false |  |
| Height when pressed | `pressedHeight` | number | 0.05 | 0 to 1 |

Sends: **Pressed** (`active`, On while the plate is down.).

Adds automatically: `collider`.

### Pushable

Id: `pushable`. Each update it moves things (runs first).

Slides one cell when the player walks into it, as long as the cell beyond is free floor.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Slide speed (cells per second) | `slideSpeed` | number | 6 | 1 to 20 |

Adds automatically: `collider`.

### Timer

Id: `timer`. Each update it makes signals.

Counts down after its start signal arrives. On while counting; sends a short "done" pulse at the end.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Seconds | `seconds` | number | 3 | 0.1 to 600 |
| Start when the game starts | `autoStart` | boolean | false |  |
| Repeat | `loop` | boolean | false |  |

Receives: **Start** (`start`, A rising signal starts (or restarts) the countdown.).

Sends: **Counting down** (`running`); **Finished (one tick)** (`done`).

### Trigger Zone

Id: `triggerZone`. Each update it makes signals.

An invisible area that sends a signal while something is inside it. Use it with wires or event sheets ("when the player is inside...").

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Counts | `who` | select | "player" | `anyone`, `player`, `crates`, `echoes` |

Sends: **Someone is inside** (`occupied`).

Adds automatically: `collider`.

## Story

### Cutscene Trigger

Id: `cutsceneTrigger`. Each update it reacts to signals (runs last).

Plays a cutscene when the player walks into its area (the first time only, if you like). Write cutscenes in the Cutscenes panel.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Cutscene (name) | `cutscene` | text | (empty) |  |
| Only the first time | `once` | boolean | true |  |

Receives: **Play now** (`play`, A rising signal plays the cutscene.).

Sends: **Has played (stays on)** (`played`).

Adds automatically: `collider`.

### Lantern Post (checkpoint)

Id: `checkpoint`. Each update it moves things (runs first).

The player presses Interact (E) next to it to light it and rest. Resting heals, and if the player is defeated they return to the last post they rested at. Lit posts are listed in the Travel menu so the player can fast travel between them.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Name (shown in the travel list) | `name` | text | "Lantern" |  |
| How close the player must be (cells) | `reach` | number | 1.6 | 0.5 to 6 |
| How far it shines when lit (cells) | `lightRadius` | number | 5 | 1 to 15 |
| Resting heals the player fully | `heals` | boolean | true |  |

Sends: **Is lit** (`lit`).

Adds automatically: `collider`.

### Minigame

Id: `minigameStation`. Each update it moves things (runs first).

The player presses Interact (E) next to it to play a small game: a timing bar, a pattern to repeat or a card-matching game. Make the minigame in Story -> Minigames and choose it here. Winning can open a gate, give an item or set a flag.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Minigame (name) | `minigame` | text | (empty) | Create it in Story -> Minigames; the name must match. |
| How close the player must be (cells) | `reach` | number | 1.7 | 0.5 to 6 |
| Cannot be played again after winning | `onlyUntilWon` | boolean | false |  |
| Show "E: play" when the player is close | `hint` | boolean | true |  |

Sends: **Is being played** (`playing`); **Has been won (stays on)** (`won`); **Has been played (stays on)** (`played`).

Adds automatically: `collider`.

### NPC Talk

Id: `npcTalk`. Each update it moves things (runs first).

The player presses Interact (E) next to it to start a conversation. Write the conversation in the Dialogues panel and choose it here.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Conversation (name of a dialogue) | `dialogue` | text | (empty) | Create it in the Dialogues panel; the name must match. |
| How close the player must be (cells) | `reach` | number | 1.7 | 0.5 to 6 |
| Turns to face the player | `facePlayer` | boolean | true |  |
| Only talks once | `once` | boolean | false |  |
| Show "E: talk" when the player is close | `hint` | boolean | true |  |

Sends: **Is in a conversation** (`talking`); **Has talked (stays on)** (`talked`).

Adds automatically: `collider`.

### Scene Portal

Id: `portal`. Each update it reacts to signals (runs last).

A doorway: when the player steps into it they are taken to another scene (or another spot in this one), appearing at the named object there. Flags, items and lanterns come along.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Go to scene (file, e.g. scenes/cave.scene.json; empty = this one) | `scene` | text | (empty) |  |
| Appear at (name of an object in that scene, or "x,y") | `spawn` | text | (empty) |  |

Adds automatically: `collider`.

### Sound Source

Id: `soundSource`. Each update it makes signals.

A sound that comes from this object. It gets quieter and moves to one side as the player walks away from it. Ambient: a loop that plays while the player is in range (a waterfall). Otherwise it plays once when its Play input arrives, or every few seconds (a dripping pipe). A wire into Silence turns it off.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Sound (a file in Assets -> Sounds) | `sound` | text | (empty) | The name of a sound file in Assets -> Sounds, without its ending. |
| Loops while the player is in range | `ambient` | boolean | true |  |
| Full volume within (cells) | `near` | number | 2 | 0 to 40 |
| Cannot be heard beyond (cells) | `far` | number | 14 | 1 to 80 |
| Volume (0 to 1) | `volume` | number | 1 | 0 to 1 |
| Repeat a one-shot every (seconds, 0 = off) | `every` | number | 0 | 0 to 120 |

Receives: **Play once** (`play`); **Silence (while on)** (`silence`).

Sends: **Is making sound** (`audible`).

## Story puzzles

### Formattable Text Block

Id: `textBlock`. Each update it moves things (runs first).

A block of text whose formatting changes the world: plain text does nothing, underlined text becomes a flat bridge you can walk over, bold text becomes a wall, and italic text becomes slippery and slides when pushed. The player formats it with the interact button, or a wire does.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| The text | `text` | text | "BRIDGE" |  |
| Starts as | `format` | select | "plain" | `plain`, `underline`, `bold`, `italic` |
| The player can change the formatting | `playerCanFormat` | boolean | true |  |
| How close the player must be (cells) | `reach` | number | 1.5 | 0.5 to 5 |
| Height of the bold wall (levels) | `wallHeight` | number | 2 | 0.5 to 6 |
| Slide speed when italic (cells per second) | `slideSpeed` | number | 5 | 1 to 20 |

Receives: **Underline** (`underline`, While on, the text is underlined (a bridge).); **Bold** (`bold`, While on, the text is bold (a wall).); **Italic** (`italic`, While on, the text is italic (slides).).

Adds automatically: `collider`.

### Sentence Stone

Id: `sentenceStone`. Each update it makes signals.

A stone showing a sentence with one swappable word, like "The bridge [ HOLDS ]". The player changes the word with the interact button. Each word has its own signal: wire "Word 1" to the thing that should happen for the first word, "Word 2" for the second, and so on.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Words before | `before` | text | "The bridge" |  |
| The swappable words (separated by commas) | `words` | text | "breaks, holds" | Up to 8. The first four have signals you can wire. |
| Words after | `after` | text | (empty) |  |
| Starts on word number (0 = first) | `selected` | number | 0 | 0 to 7 |
| How close the player must be (cells) | `reach` | number | 1.5 | 0.5 to 5 |
| Also store the chosen word in this variable (optional) | `variable` | text | (empty) |  |

Receives: **Next word** (`next`, A rising signal swaps to the next word.).

Sends: **Word 1 is chosen** (`word1`); **Word 2 is chosen** (`word2`); **Word 3 is chosen** (`word3`); **Word 4 is chosen** (`word4`).

Adds automatically: `collider`.

## Turn-based

### Turn Taker

Id: `turnTaker`. Each update it combines signals.

Makes an object a unit in a turn-based battle: its team, its place in the order, its action points and how it attacks. Start the battle with the "Start a turn-based battle" action.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Team | `team` | text | "blue" | Units with the same team are on the same side. |
| Speed in the order (higher goes first) | `initiative` | number | 5 |  |
| Action points each turn | `apMax` | number | 4 | at least 0 |
| Attack range (cells) | `attackRange` | number | 1 | at least 1 |
| Attack damage | `attackDamage` | number | 3 | at least 0 |
| Action points an attack costs | `attackCost` | number | 2 | at least 0 |
| Extra damage per level above the target | `heightBonus` | number | 1 |  |
| End the turn when out of action points | `autoEnd` | boolean | true |  |

### Unit AI

Id: `unitAi`. Each update it brain.

Plays the unit's turn by itself: it picks the best cell it can reach (close to an enemy, on higher ground, within attack range), attacks if it can, and ends its turn.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Style | `style` | select | "rush" | `rush`, `cautious` |

Adds automatically: `turnTaker`, `gridMover`.

## World

### Falling Floor

Id: `fallingFloor`. Each update it reacts to signals (runs last).

A platform that crumbles shortly after something stands on it, and comes back later.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Seconds before it drops | `delay` | number | 0.6 | 0 to 10 |
| Comes back after (seconds, 0 = never) | `respawnAfter` | number | 3 | 0 to 60 |

Sends: **Has dropped** (`fallen`).

Adds automatically: `collider`.

### Follow Camera

Id: `followCamera`. Each update it moves things (runs first).

The camera follows this object. (With none in the scene it follows the player.)

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Dead zone width (pixels) | `deadzoneW` | number | 50 | 0 to 400 |
| Dead zone height (pixels) | `deadzoneH` | number | 30 | 0 to 400 |
| Smoothing (1 = snap, small = lazy) | `smoothing` | number | 0.2 | 0.02 to 1 |
| Zoom | `zoom` | number | 1 | 0.25 to 4 |

### Moving Platform

Id: `movingPlatform`. Each update it moves things (runs first).

A solid platform that travels back and forth and carries whatever stands on it.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Travel in X (cells) | `dx` | number | 4 | -32 to 32 |
| Travel in Y (cells) | `dy` | number | 0 | -32 to 32 |
| Travel up (levels) | `dh` | number | 0 | -12 to 12 |
| Speed (cells per second) | `speed` | number | 1.5 | 0.1 to 20 |
| Rest at each end (seconds) | `pause` | number | 0.5 | 0 to 30 |
| Only moves while Go is on | `needsSignal` | boolean | false |  |

Receives: **Go** (`go`).

Adds automatically: `collider`.

### Pickup

Id: `pickup`. Each update it reacts to signals (runs last).

Disappears when the player touches it and adds to a counter (coins, keys, gems...).

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Picked up by | `who` | select | "player" | `anyone`, `player`, `crates`, `echoes` |
| Counter to add to | `variable` | text | "coins" |  |
| Amount | `amount` | number | 1 | -999 to 999 |
| Message to show | `message` | text | (empty) |  |
| Item to add to the inventory (optional) | `item` | text | (empty) | The id of an item from the Items panel. Leave the counter empty if you only want the item. |

Adds automatically: `collider`.

### Projectile

Id: `projectile`. Each update it moves things (runs first).

Flies in a straight line and disappears when it hits a wall or a solid object (or runs out of time), announcing the hit.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Speed (cells per second) | `speed` | number | 8 | 0.5 to 40 |
| Seconds before it vanishes | `lifetime` | number | 3 | 0.1 to 60 |
| Fly the way the object faces | `useFacing` | boolean | true |  |
| Direction X | `dirX` | number | 1 | -1 to 1 |
| Direction Y | `dirY` | number | 0 | -1 to 1 |
| Damage to what it hits (0 = none) | `damage` | number | 0 | 0 to 99 |
| Hurts | `hurts` | select | "player" | `player`, `enemies`, `anything` |
| Knockback (cells per second) | `knockback` | number | 5 | 0 to 20 |

### Spawner

Id: `spawner`. Each update it reacts to signals (runs last).

Creates copies of a prefab, on a timer and/or each time its Spawn signal turns on.

| Setting | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| What to create | `prefab` | prefab | (empty) |  |
| Every how many seconds (0 = only on the signal) | `everySeconds` | number | 0 | 0 to 600 |
| Create one when the game starts | `onStart` | boolean | false |  |
| Most alive at once (0 = no limit) | `max` | number | 0 | 0 to 99 |
| Shift X (cells) | `offsetX` | number | 0 | -10 to 10 |
| Shift Y (cells) | `offsetY` | number | 0 | -10 to 10 |

Receives: **Spawn** (`spawn`, A rising signal creates one.).
