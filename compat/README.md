# The compatibility corpus

Phase 3, Rule A: **nothing the owner has made may break.** This folder is how that is checked.

## What is in the corpus

| Kind | Where | In git |
| --- | --- | --- |
| sample | every folder of `samples/` | yes |
| template | every project under `templates/` | yes |
| code-template | every template of the New project dialog, built fresh into a temporary folder | yes |
| owner | every project in `compat/projects/` | no (they are the owner's; see `.gitignore`) |

## What is recorded for each project (`compat/baselines/<kind>/<name>.json`)

- **Loading:** every loader's complaints (should be none), and the whole-project check (the list Export insists on).
- **Per scene:** the scene round-trips through the file format; a trace of the game while a fixed list of buttons is
  pressed (walk four ways, run, jump, use, attack, dodge, menus) and while the mouse hovers, clicks, right-clicks and drags a
  box; a fingerprint every second of every object's name, tags and position and of the game's variables; a save is
  written, read back and applied to a fresh game.
- **Scenarios** (`compat/scenarios/`): extra button lists for what one project is about. The owner's gravity puzzle
  presses its switches and walks on the wall and the ceiling.
- **Scripts:** each script type-checks against the script API exactly as the Code window does and compiles to the same code.
- **Saves and playthroughs** already in the project folder still open and still replay.
- **Export:** which files an export would ship (a hash of each, line endings ignored), and the manifest.
- **The script API** only grows (`baselines/script-api.json` keeps every name it ever had).
- **Pictures:** `e2e/compat-screens.spec.ts` opens each scene in the editor and compares it with a golden picture
  (one set per operating system, written the first time).

## Commands

```
npm run compat                      compare everything with its baseline
COMPAT_ONLY=Demo npm run compat     one project (also works for the pictures test)
COMPAT_UPDATE=1 npm run compat      write the baselines
```

A difference fails the run. The only good reasons to update a baseline are an **intended fix** (write it in
`DECISIONS.md` with the reason, and check that the project still works) or a new project in the corpus. Never update to
make a red run green without reading the difference.
