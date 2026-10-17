# The acceptance game: a slice of The Last Storytender

`e2e/m13-acceptance.spec.ts` builds a small game **using only the editor** (the real window, mouse and keyboard, no code), checks it with the editor's own validators, lets the playbot finish it, plays it with the real menus, exports it and runs the exported program. It takes about a minute.

## What was built

**The hub** (a village):
- An **elder** whose conversation (written in the Story panel) asks "Will you mend them?" with a **choice**; "I will." **sets the flag** `accepted`, "Not yet." ends politely.
- A **seal** (a solid pillar) in the gap of a brick wall. One **event row** ("When `accepted` >= 1: switch the seal's collision off and hide it") opens the way once the flag is set.
- A **lantern post** (checkpoint) and a **portal** to the dungeon.
- The hero: health (20, respawns), a quill, a dodge, two echoes and a lantern.

**The dungeon**:
- A **plateau two levels up with stairs**. On it **two plates**: the first can only be held by an **echo**, the second only pressed by the player and it stays down. A logic **AND** joins them to the **Echo gate** in the first wall. (One player cannot do it alone: record an echo onto the first plate, then press the second.)
- A **crate puzzle**: a crate in a dead-end corridor and a plate at its end, wired to the **Crate gate** in the second wall.
- A **sentence stone** ("The bridge [ BREAKS | HOLDS ]") whose second word is wired to the **underline** input of a **text block** lying across a two-cell **pit**: swap the word and the text becomes a bridge.
- A **guard** walking a route with a vision cone and hearing.
- A **lantern post** and an **arena** (a region where the boss is active) with a **boss** that has two phases; defeating it opens the **exit gate** to the **exit**.

## What was checked

| Check | Result |
| --- | --- |
| Problems panel on both scenes | no problems |
| Puzzle check (full: bypasses, unreachable goals, useless gates, crate solvability, soft-locks) | none found |
| Whole-project check | all clear |
| The check catches a mistake | cutting a second doorway through the exit wall is reported ("The gate ... blocks nothing"); undoing it clears the report |
| **The playbot** (`e2e/slice-bot.ts`, buttons only) | talks to the elder and agrees, lights the hub lantern, goes through the portal, holds the plates (an echo and the player), clears the guard, pushes the crate onto its plate, swaps the stone's word and crosses the bridge, lights the second lantern, beats the boss, and walks out of the exit gate: **47 s of game time**, no bypass, no soft-lock. The run is written to `screenshots/m13-bot-run.txt`. |
| Played in the editor | the choice is clicked, the flag is set and the seal opens; the pause menu has Resume, Inventory, Travel, Save, Load, Settings and Restart; saving, remapping Attack to F, wandering off and loading puts the player back with the flag still set; in the dungeon the lantern lights, a defeated player wakes up at the lantern, and Restart returns there |
| Exported | `The Last Storytender.exe` starts in the hub with no editor; real key presses walk to the elder, open the conversation and the mouse picks the choice, which sets the flag |

## Problems the slice found in the engine (all fixed)

Building something real exposed things a toy never would:
- The reachability checks did not know a text block can bridge a pit, so a goal behind a bridged pit was reported as impossible. Bridges are now understood (`textBridgeCells`) by the "unreachable floor" warning, the puzzle check and the bot's path planner.
- A gate that only matters because an earlier gate is open was reported as "blocks nothing". Gates are now judged both with the other gates shut and with them open.
- A crate puzzle in a later room was reported unsolvable because the player starts behind a closed gate, and plates a crate could never reach (on a plateau, pressed by echoes) counted as targets.
- Event rows that check a flag a conversation sets were warned about ("never set anywhere").
- The bot walked off when a portal took it to another scene, could not play across scenes at all, could not fight, and got wedged on wall corners.

## Running it

```powershell
npm run build -w @tilewright/editor
npx playwright test e2e/m13-acceptance.spec.ts
```

Screenshots land in `screenshots/` (`m13-hub-built.png`, `m13-dungeon-built.png`, `m13-validators.png`, `m13-choice.png`, `m13-seal-open.png`, `m13-remap.png`, `m13-dungeon-play.png`, `m13-exported-game.png`). To keep the project the test builds (for working on the bot), set `TILEWRIGHT_KEEP_SLICE` to a folder.

## The sample game
The finished slice ships with the editor as a sample: the project screen's **See a finished game** card copies it into a folder you choose and opens the copy (`templates/last-storytender`, built into the editor's `dist/samples`). It includes the playbot's recorded playthrough, so the Playbot panel can replay it. It is regenerated from the acceptance test, never edited by hand:

```bash
TILEWRIGHT_SAMPLE_OUT=templates/last-storytender npx playwright test e2e/m13-acceptance.spec.ts
```

`e2e/m14-sample.spec.ts` opens the sample, runs the whole-project check (all clear) and replays the playthrough.
