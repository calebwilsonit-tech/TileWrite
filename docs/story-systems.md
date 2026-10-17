# Story systems (M8)

Made in the **Story** panel (bottom dock: Items, Dialogues, Cutscenes), the Place tool's **Story** group, and the Inspector's Behaviours. Code: `packages/runtime/src/story/*`, `packages/behaviors/src/story/*`, `packages/behaviors/src/builtins/story.ts`, `packages/behaviors/src/ui/game-ui.ts`, and the editor's `viewport/play-session.ts`.

## Flags, counters and inventory are one thing
Variables (declared on the scene, or created by event rows, dialogues and cutscenes) hold flags, counters, text and — as `item:<id>` — how many of each item the player carries. Quick slots are `slot:1`..`slot:4`. Everything saves, loads and shows up in event rows with no special cases.

## Items
Items (`assets/items.json`): id, name, description, colour, carry limit, and what using them does (heal, set a variable, message, used up). Get them from a **Pickup** (its Item setting), a conversation, a cutscene, or the *Give the player an item* event action. A new item goes in the first free quick slot; keys **1-4** use the item in that slot (a healing item is not wasted at full health); the inventory screen lets the player use items and move them between slots.

## Dialogues
`assets/dialogues/<name>.dialogue.json`: lines, choices (an option can require an item or a variable), set a variable, give or take an item, branch on a condition, end. `{variable}` in text shows its value. The Story panel edits them as a list of steps (with plain-English problems: steps that lead nowhere, missing items, lines nobody can reach); **Test in the game** starts one at once. Put one on a character with **NPC Talk** (press E beside it; "E: talk" shows when close). While a conversation is open the world is frozen; W/S choose, E confirms, or click.

### The graph view of a conversation
Above the steps, **Graph** shows the conversation as cards joined by arrows: a card for every step (blue lines, orange choices with a row per option, purple variable changes, green items, pink branches, grey ends) and an arrow for every "then go to". The start card says **start**; cards nothing leads to are faded.
- **Move** a card by dragging it (its place is remembered). **Tidy up** forgets the places and lays everything out again by distance from the start.
- **Connect** by dragging from the blue dot on a card's right edge to another card. Dropping on empty space cuts that link. A choice has one dot per option; a branch has *yes* and *no*.
- **Add** a step with the buttons under the graph. If a card is selected the new card appears beside it and joins its first free link.
- **Select** a card to edit its words and settings in the form under the graph. **Delete the selected card** (or the Delete key) removes it and every link to it.
- Drag the background to pan, use the wheel or the **Zoom** buttons, **Fit** to see everything, and **Make it bigger** for a full-window editor. **List** goes back to the step list; both show the same conversation.


## Cutscenes
`assets/cutscenes/<name>.cutscene.json`: steps run one after another; a step marked *keep going* runs alongside the next. Steps: wait, wait for a button, say a line, run a dialogue, move the camera (and zoom), camera back, walk somebody (around obstacles), turn somebody, fade the screen, play an animation, shake the screen, sound, set a variable, give an item, show a message. A **Cutscene Trigger** plays one when the player walks in (once, if you like) or the *Play a cutscene* action does. During a cutscene the world keeps moving but the player's controls are off; P / Start skips it (everything still happens, instantly) unless it says it cannot be skipped.

### The timeline view of a cutscene
**Timeline** lays a cutscene out in time: a row each for *Camera and screen*, *People*, *Talking* and *World and sound*. A step starts when the one before it ends, unless the one before was marked **keep going**, which draws the two side by side. Instant steps (a sound, a flag) are diamonds. Speech and walks last as long as the player takes to read or the walk takes, so they are drawn with a dashed edge and the total says "more when the player reads or walks".
- Click a block to edit that step below. Drag the right edge of a **wait, camera move, fade or shake** to change how long it lasts (to the nearest tenth of a second). Add steps with the buttons under the timeline.

## Lantern posts, travel, portals
- **Lantern Post**: Interact lights it and rests (heals). The last post rested at is where the player returns after being defeated (even in another scene). Lit posts are listed in the pause menu's **Travel** screen (fast travel between scenes). Lighting a lantern autosaves.
- **Scene Portal**: a doorway to another scene (or another spot in this one); say where in "Appear at" (an object's name or `x,y`). Flags, items, lanterns and health come along.
- A hub with several areas is simply scenes joined by portals.

## Saving
Pause menu: **Save game** / **Load game** with three slots plus an autosave (written when a lantern is lit, on a *Save the game* action, and when entering a scene). A save keeps flags and inventory, the last lantern, difficulty, the player's place and health, and the state of every object tagged **persistent** (including whether it is gone: a collected coin stays collected). The format is versioned with migrations; the previous save of a slot is kept as a backup and used automatically if the newest file is damaged; a save from a newer game is refused with an explanation.

## The game's own screens and settings
HUD (hearts, quick slots, boss bars, messages), the conversation box, fades, and the pause menu are drawn by one DOM layer (`GameUi`) that the editor's Play and exported games share. Pause menu: Resume, Inventory, Travel, Save, Load, Settings, Restart this area. Settings (remembered on the player's machine): volumes, difficulty (damage the player takes: easy half, hard one and a half), screen shake, and **Controls**: pick an action, press a new key or button (keyboard, mouse and a standard gamepad all work; rebinding a key keeps the gamepad button; a key taken from another action is removed from it). Keys: P / gamepad Start pauses (Esc also stops Play inside the editor), I inventory, M travel map, 1-4 quick slots.

## Tested by
Unit: `packages/runtime/src/story/*.test.ts` (items, dialogues, checks, saves, backups, settings, rebinding, gamepads), `packages/behaviors/src/m8.test.ts` (conversations freezing the world, held buttons not repeating, items and quick slots, lanterns and respawn, portals, cutscenes, difficulty, event rows), `packages/editor/src/renderer/project/story.test.ts`. End to end: `e2e/m8-story.spec.ts` builds items, a conversation, a cutscene, a hub with a keeper/lantern/bread/portal and a cave through the UI, then plays it: intro cutscene, lantern autosave, pick up bread, a conversation answered with the mouse, the pause menu (inventory, save, difficulty, remapping a key), the portal, fast travel back and loading the save.
