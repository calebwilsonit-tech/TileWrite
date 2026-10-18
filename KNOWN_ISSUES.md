# Known issues

What has not been verified, and the limits of what was built. Everything the first spec listed has been built; this file says how far each piece goes. Newest, most useful first.

## Never run here
- **The live Claude API.** The assistant is verified against a mock server that speaks the streaming protocol and by unit tests. `npm run test:live` with a key checks the real thing (the refusal-fallback beta and thinking/effort parameters are the parts most worth watching).
- **CI.** `.github/workflows` have never run (there is no remote repository).
- **Sound by ear.** The engine, the mixer (buses, ducking, per-sound variation, loop points) and positional sound are tested against a pretend sound card and a real WAV decoded in the Electron window; nobody has listened.
- **The NSIS installer.** Tried again on 2026-10-17 (twice, up to 25 minutes): `electron-builder --win` gets through the native rebuild and the Electron download and then fails with "Timeout awaiting request for 600000ms" while fetching its NSIS helper tools from GitHub, so no `Tilewright-<version>-win.exe` was produced. What is verified instead: `electron-builder --win dir/zip` with the local Electron and exporting a game from the packaged editor (`e2e/packaged-export.spec.ts`). The CI `windows-build` job should build the real installer.
- Exports are tested on Windows only (the Linux path is untested, macOS is not implemented), are unsigned (SmartScreen warns), keep the generic Electron file icon on the .exe, and are 250-300 MB each because they carry an Electron runtime.
- The tutorial was driven by a test, never timed with a real beginner.

## Environment
- The Electron binary download is flaky on this machine. Workaround: `curl.exe -C -` with retries, verify SHA256 against `node_modules/electron/checksums.json`, unzip into `node_modules/electron/dist`, write `path.txt` containing `electron.exe`.
- npm 11 blocks dependency install scripts by default; `esbuild` and `electron-winstaller` are approved in the root `package.json` `allowScripts`.
- `npm audit` reports a moderate issue (sprintf-js, through electron-builder's tooling). It is build tooling only and is not shipped.
- The e2e run once filled the disk with leftover temp folders; `e2e/clean-temp.ts` removes them before and after each run.
- Timing-sensitive e2e tests flake when too many Electron windows are open: at 3 workers two different specs failed in each of two full runs and passed alone, so `playwright.config.ts` now uses 2 workers (a full run takes about 4 minutes and passed 46 of 46).

## Limits by area
**Art.** Pictures are procedural box art unless drawn in the Sprite studio. Tile art covers only the top faces of tiles (stairs stay untextured; sides are flat shades). Vector shapes are not anti-aliased (they stay inside the palette), and turn/scale is not available on vector layers. The sample game is the box-art slice.

**Editing.** Prefab children are not shown or edited individually. Wires combine with OR only (use a Logic Gate for anything else). Mouse placement near tall walls can land on the wrong cell. Layer visibility and locks are not saved. There is no lighting preview in edit mode (only in Play). Dock panels closed with X come back with *Commands -> Reset panel layout*. `project.iso` (tile size) is stored but the renderer does not use it, so it is not offered in the settings.

**Story.** Story undo history belongs to the open scene and is lost on a scene switch; story edits save as you type. The dialogue graph and cutscene timeline are mouse-driven (the form fields work from the keyboard); on the timeline you can stretch timed steps but not move them in time, and lengths of speech and walks are guesses. The world map has no background picture. Translations are keyed by the original text, so editing a line makes its translations "no longer in the game"; names of objects, puzzle text and script text are not translated; there are no plural forms or right-to-left layout. The title screen shows in the exported game and plain Play, not "From here"; Continue loads the newest save of any slot.

**Interface and controls.** Pieces left on the default anchor stay in a column at the top left, and a scaled piece there pushes its neighbours (pin it to avoid that). The interface preview uses stand-ins, not the live game; fonts are four stacks, not custom font files. The controls editor cannot bind Esc (it cancels the capture). Players rebinding a key in the game still wins over the project's defaults.

**Logic, AI and puzzles.** The bypass check treats crates as removable and text blocks as always bridgeable, and ignores echoes and growing objects. Soft-lock analysis covers crate puzzles; the solver searches echo, stand, lever and push plans (up to 4 steps, 400 plans, 40 s), not arbitrary puzzles. A behaviour tree and a state machine on one object share one gate. State machines cannot run event-sheet actions; "toward"/"away" do not avoid other moving enemies. Enemy hearing ignores walls except through the muffle setting. The playbot's slice walkthrough is a script for that game; its generic parts (fight, travel, minigames, the solver) are reusable but there is no one-button "play any game".

**Play and hot reload.** Apply edits reloads the open scene (things that moved go back to their start; "once" rows that ran stay done; player, items, flags and health stay). Other scenes load from files on disk. Hit-stop is applied by the game window, so Step does not show it. Scripts are not sandboxed (D015), cannot step line by line, and cannot import other scripts or packages.

**Sound.** Music loops are end to end unless loop points are set in the Mixer; there is no live editing of a sound while the game runs (press Play again); particles are seven small presets without an editor.

**Assistant.** It cannot see the game running (only a screenshot of the editor), draw sprites or add sound files. Proposals show one at a time; "Undo this" only works while nothing else changed since. Conversations are not kept across restarts; costs are estimates from list prices.

**Export.** Exported games have no in-game language list beyond what the project defines; settings live in the game window's `localStorage`, saves in the game's own folder.
