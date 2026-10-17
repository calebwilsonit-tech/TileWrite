# Event blocks

<!-- Generated from the event registries by packages/behaviors/src/docs.test.ts. Run `UPDATE_DOCS=1 npx vitest run packages/behaviors/src/docs.test.ts` after changing a block. -->

An event sheet is a list of rows, each reading like a sentence: **when** its conditions hold, **do** its actions. Rows can have sub-events that run only while the row holds. Objects are chosen as "the player", "anything tagged ...", or a particular object. See [logic.md](logic.md).

There are 14 conditions and 23 actions.

## Conditions

What a row waits for.

### Basics

#### Always

Id: `always`.

No parameters.

#### The game starts

Id: `start`.

No parameters.

#### Every few seconds

Id: `every`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Seconds | `seconds` | number | 2 | at least 0.1 |

#### Random chance

Id: `chance`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Chance each tick (%) | `percent` | number | 1 | 0 to 100 |

#### Something happens in the game

Id: `onEvent`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| What happens | `name` | select | "pickup" | `pickup`, `pushed`, `landed`, `fell`, `floor-fell`, `projectile-hit`, `spawned`, `anim-event`, `damaged`, `died`, `attack`, `dodge`, `noticed`, `lost`, `state-changed`, `boss-phase`, `boss-defeated`, `echo-made`, `sentence-changed`, `text-formatted`, `dialogue-started`, `dialogue-ended`, `cutscene-started`, `cutscene-ended`, `lantern-lit`, `rested`, `item-given`, `portal` |

### Variables

#### A variable compares

Id: `variable`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Variable | `name` | variable | (empty) |  |
| Is | `op` | select | ">=" | `=`, `!=`, `>`, `>=`, `<`, `<=` |
| Value | `value` | text | "1" |  |

#### How many objects there are

Id: `count`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Tag | `tag` | text | "enemy" |  |
| Is | `op` | select | "=" | `=`, `!=`, `>`, `>=`, `<`, `<=` |
| Number | `value` | number | 0 |  |

### Objects

#### An object exists

Id: `exists`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Object | `who` | entity | "tag:enemy" |  |

#### An object's signal is on or off

Id: `signal`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Object | `who` | entity | (empty) |  |
| Which side | `side` | select | "output" | `output`, `input` |
| Signal | `name` | signal | (empty) |  |
| Is | `state` | select | "on" | `on`, `off` |

#### An object's health compares

Id: `health`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Object | `who` | entity | "player" |  |
| Is | `op` | select | "<=" | `=`, `!=`, `>`, `>=`, `<`, `<=` |
| Hit points | `value` | number | 1 |  |

#### Something is inside an area

Id: `inside`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Who | `who` | entity | "player" |  |
| Inside which trigger area | `zone` | entity | (empty) |  |

#### Two objects are close together

Id: `near`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| First | `a` | entity | "player" |  |
| Second | `b` | entity | (empty) |  |
| Within (cells) | `cells` | number | 2 | at least 0.1 |

### Story

#### The player carries an item

Id: `hasItem`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Item (id) | `item` | text | (empty) |  |
| At least how many | `atLeast` | number | 1 | at least 1 |

### Input

#### The player presses a button

Id: `action`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Button | `name` | action | "interact" |  |
| When it is | `mode` | select | "pressed" | `pressed`, `held`, `released` |

## Actions

What a row does.

### Variables

#### Change a variable

Id: `setVariable`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Variable | `name` | variable | (empty) |  |
| Do | `op` | select | "set" | `set`, `add`, `subtract`, `multiply`, `toggle` |
| Value | `value` | text | "1" |  |

### Objects

#### Turn an object's signal on or off

Id: `setSignal`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Object | `who` | entity | (empty) |  |
| Signal it sends | `name` | signal | (empty) |  |
| Turn it | `state` | select | "on" | `on`, `off`, `toggle` |

#### Remove an object

Id: `destroy`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Object | `who` | entity | "picked" |  |

#### Create an object from a prefab

Id: `spawn`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Prefab | `prefab` | prefab | (empty) |  |
| Where (an object) | `at` | entity | (empty) |  |
| Shift X (cells) | `dx` | number | 0 |  |
| Shift Y (cells) | `dy` | number | 0 |  |

#### Move an object to another object

Id: `teleport`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Move | `who` | entity | "player" |  |
| To | `to` | entity | (empty) |  |

#### Show or hide an object

Id: `setVisible`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Object | `who` | entity | "picked" |  |
| Make it | `visible` | select | "shown" | `shown`, `hidden` |

#### Turn an object solid or non-solid

Id: `setEnabled`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Object | `who` | entity | "picked" |  |
| Make its collision | `state` | select | "on" | `on`, `off` |

### Combat

#### Hurt an object

Id: `damage`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Object | `who` | entity | "player" |  |
| Damage | `amount` | number | 1 | at least 0 |

#### Heal an object

Id: `heal`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Object | `who` | entity | "player" |  |
| Hit points | `amount` | number | 1 | at least 0 |

### Story

#### Give the player an item

Id: `giveItem`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Item (id) | `item` | text | (empty) |  |
| How many | `amount` | number | 1 | at least 1 |

#### Take an item from the player

Id: `takeItem`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Item (id) | `item` | text | (empty) |  |
| How many | `amount` | number | 1 | at least 1 |

#### Start a conversation

Id: `startDialogue`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Dialogue (name) | `dialogue` | text | (empty) |  |

#### Play a cutscene

Id: `playCutscene`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Cutscene (name) | `cutscene` | text | (empty) |  |

#### Go to another scene

Id: `travel`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Scene file (empty = this one) | `scene` | text | (empty) |  |
| Appear at (object name, or "x,y") | `spawn` | text | (empty) |  |

#### Save the game (autosave)

Id: `saveGame`.

No parameters.

### Basics

#### Show a message

Id: `message`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Text (use {variable} to show a value) | `text` | text | "Hello!" |  |

#### Play a sound

Id: `sound`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Sound (a file in Assets -> Sounds) | `name` | sound | (empty) |  |
| Volume (0 to 1) | `volume` | number | 1 | 0 to 1 |

#### Change the music

Id: `music`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Music (a file in Assets -> Sounds; empty = silence) | `name` | sound | (empty) |  |

### Advanced

#### Change any setting of an object

Id: `setProperty`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Object | `who` | entity | "picked" |  |
| Part (e.g. sprite, transform) | `component` | text | "sprite" |  |
| Setting | `key` | text | "color" |  |
| New value | `value` | text | (empty) |  |

#### Announce an event

Id: `emit`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Event name | `name` | text | "my-event" |  |

### Effects

#### Burst of sparks, dust or glow

Id: `particles`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Where | `at` | entity | "player" |  |
| Kind | `effect` | select | "spark" | `hit`, `spark`, `dust`, `puff`, `heal`, `magic`, `confetti` |
| How many (0 = the usual amount) | `count` | number | 0 | 0 to 80 |

#### Shake the screen

Id: `shake`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| How hard (pixels) | `pixels` | number | 5 | 0 to 14 |

#### Freeze the game for a moment

Id: `hitStop`.

| Parameter | Key | Kind | Starts as | Choices and notes |
| --- | --- | --- | --- | --- |
| Seconds (0.05 is a good hit) | `seconds` | number | 0.08 | 0 to 0.2 |
