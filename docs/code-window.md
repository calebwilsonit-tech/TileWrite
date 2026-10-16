# The Code window

For when the no-code tools are not enough. Open it with the **Code** button at the top (or Ctrl+3). The Play, Pause, Step and Stop buttons stay in reach, so you can write, play and fix without leaving.

## Scripts are behaviours

A script is one file in your project: `assets/scripts/<Name>.script.ts`. Make one with **Make a script** (pick a starting point: empty, "Turn on the spot", "Say hello when the player is near", "Follow the player").

```ts
export default defineScript({
  name: 'Spinner',
  description: 'Turns to face the next direction every so often.',
  settings: { everySeconds: { value: 0.5, label: 'Turn every (seconds)', min: 0.1 }, clockwise: true },
  start(me, game) { /* once, when the object appears */ },
  update(me, game) { /* every update, 60 times a second */ },
  onEvent(me, game, name) { /* a signal arrived */ },
});
```

Once it compiles, it shows up in the Inspector's **Behaviours -> Add** list (as `script_Spinner`, under "Scripts"). From then on it is an ordinary behaviour: its settings become Inspector fields, its signal inputs and outputs can be wired, and prefabs can include it.

## Everything the no-code layer can do

`game.do('Action name', {...})` and `game.test('Condition name', {...})` run any event-sheet action or condition, so nothing is only possible in rows. `game.find` / `game.findAll` look objects up by name, tag or `picked`; `me` is the object the script is on (position, facing, tags, state, `walkTo`, `lookAt`, `distanceTo`, signals...); `game.player`, `game.vars`, `game.say(...)`, `game.dt`. Press **Ctrl+Space** in the editor: every function is described as you type, and a wrong name or type is underlined with a plain explanation.

**Convert to code:** the Events panel has a *Convert to code* button. It writes the scene's event sheet as a script (using `game.test`/`game.do`), behaving the same as the rows.

## Playing with scripts

* Edits are saved a moment after you stop typing and recompiled at once. **While the game is running, the new code takes over immediately** (object state such as `me.state` is kept).
* A mistake in a script is listed under **Problems** with its line, and underlined in the editor. When a script fails while the game runs, the game pauses and the Problems panel shows the usual friendly error report (with the object, a snapshot and Go to) that says which script, which line and which function (`update`, `start`...) failed.
* Objects that use a script which no longer exists get an error in the scene's Problems list.
* `console.log(...)` writes to the Console list below the editor.

## Breakpoints and the watch window

Click beside a line number to set a breakpoint (a red dot). When the game reaches that line it pauses after the current step and the line is highlighted; **Resume**, **Step** (one frame) and **Stop** are in the bar above the code. The **Watch** list shows live values of any expression using `me` and `game` (for a breakpoint, the script's own object; otherwise the selected object or the player). Add your own, like `game.vars.coins`.

Breakpoints only work on the first line of a statement; ones that cannot be placed are reported in the Console.

## How it works (short)

TypeScript is compiled in the editor with the `typescript` package (loaded the first time a script exists), source maps map errors back to your lines, and each script runs as an ES module. Details and the trade-offs are in `DECISIONS.md` (D015) and `KNOWN_ISSUES.md`.
