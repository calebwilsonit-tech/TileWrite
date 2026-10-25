# A title whose New game picks a difficulty, locked for the save

New game asks "How hard?" with three rows. The choice is used for the game that begins, and cannot be changed in Settings for that save. Loading that save later keeps it.

## How it is put together
1. **The title** (the screen used as *Title*, opens when the game starts): the game's name and line (`{game.title}`, `{game.subtitle}`), a menu column with Continue (*shown only when* `{host.hasSave}`), New game, Load game, Settings, Quit (*shown only when* `{host.quit}`), and a description box that follows the chosen row.
2. **New game opens a page**, not the game. The page (`Title: New game`) has the words of a warning and three rows: Easy, Normal, Hard. *When the player presses Back*: go back to the screen before, so Back returns to the title and nothing was chosen.
3. **What a row does** (in order):
   - *Change a player setting* (new in this phase): `difficulty` = `hard`. A player setting is what the Settings screen's sliders and choices change; it is the same thing, reached from a button.
   - *Change a variable*: `difficulty_locked` = 1. A variable is saved with the game, so a save made after this has it.
   - *Close a screen*: the page, then the title. The game begins.
4. **Settings follows the lock.** On the Settings screen the difficulty choice is *Can be used only when* `{difficulty_locked} != 1`, and a small note, *shown only when* `{difficulty_locked} = 1`, says "locked for this save". On the title, before any game, the variable does not exist, so the choice can be used. (The kit does this to the engine's own Settings screen when it gives it the paper look; on your own copy, make the same two changes.)
5. **Why a variable.** The difficulty the game plays at is saved in each save already. The variable is only the *lock*, and it lives in the save so that it comes back when the save is loaded; a New game starts a fresh run, whose variables are empty, until the next row sets it.

Tested in `parchment.test.ts` ("the title and a difficulty that is locked for the save") and `e2e/p4-parchment-kit.spec.ts`.
