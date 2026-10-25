# A heads-up display on paper

The kit's HUD is a screen used as *Heads-up display* (not modal, not dimmed: the game goes on behind it, and Back is not taken by it). Every part is **shown only when it has something to say**.

| Part | What it is | What makes it appear |
| --- | --- | --- |
| Gauge | a paper label and a *Bar* tied to `@Player.health.hp` with *Full at* `{@Player.health.max}` | always (name your player object "Player", or Customize the screen and change the two names) |
| Counter | "Coins" and the number | the variable `gold` exists |
| Region name | a plugin widget ("Region name") that fades in the name of the region of the scene the player walks into, and out a few seconds later | the player stands in a region (Inspector, Regions) |
| Prompt | a small paper box with `{prompt}` | the variable `prompt` has words (set it with a Quick Action *Change a variable* while the player is near something) |
| Boss bar | the name `{boss_name}` over a *Bar* tied to `boss_hp`, *Full at* `{boss_max}` | the variable `boss_name` has words (the boss fight's rules set it, and clear it when it ends) |
| Narrator text | floating words at the bottom, fading in (`{narrator}`) | the variable `narrator` has words |
| Message slips | the game's messages on slips of paper that fade away (a plugin widget; the engine's plain toasts are hidden while it is on screen) | anything that says something: a *Show a message* action, a pickup |

## How it is put together
One Panel in free layout fills the screen; each part is a child pinned to an edge with *Pinned to* (top left, top middle, bottom middle, bottom right) and an offset from it. Parts that are bars or counters are Panels in a row or column with a paper look; **shown only when** is the condition in the last column. Nothing is drawn by the engine: change a colour once in `packages/plugins/parchment/src/palette.ts`, or Customize the screen and drag things about in the designer.

The kit's plugin widgets (Region name, Message slips, Paper doll, Parchment map) are filled in from what the game says (`ctx.sim`); they are listed in the designer's palette under *From plugins*, so you can put them in your own screens too.

Tested in `parchment.test.ts` ("the heads-up display") and `e2e/p4-parchment-kit.spec.ts`.
