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

## Phase 2: limits by area
**Never run (phase 2).** The hub has only ever run on this computer: nothing was deployed, no domain bought, no real person published or downloaded anything (`docs/HUB_HOSTING.md` is a list of steps for the owner). The optional live assistant test still needs a key (the genre tools were checked with the API mocked, in four genres). Frame rates were measured on this machine only (60 fps with 200 walking villagers; a computer without a graphics card was not tried).

**Genre coverage.** The eight samples are small on purpose. Not built although the genre audit listed it: item combining from a table of recipes (point and click), gather and build orders for workers and a unit card for the selected unit (RTS), a turn-order bar and a unit card in the tactics sample (the widgets exist and are tested in the UI designer), a minimap in the roguelike (the widget exists). The tower defence upgrade makes every archer tower stronger, not one tower. The roguelike plays with the mouse (Grid Cursor); stepping with the keyboard is a recipe, not a template.

**Playbot.** `PointerBot` takes a turn greedily (hit what is in reach, otherwise walk the shortest way toward the nearest enemy) and plays strategy games by drag boxes and right-clicks. It is not a solver: it cannot plan a battle, and the samples are tuned so that it wins. It presses the widgets the game shows; keys that only the browser layer handles (the pause key opening the Pause screen, the gamepad) are exercised by the Playwright tests, not by the headless bot.

**Interface.** A grid whose own width is "fit the contents" lays its cells out far wider than the picture, and the designer's size check does not call that a problem (the UI showcase gives its grid a width and its cells fixed sizes). A table-driven list or grid needs its template widget given a size. The designer cannot yet preview a different window shape live while playing (it shows the four shapes in the designer).

**Tiles and art.** The Stairs preset has no art in the renderer (stairs draw as flat shades). A prop's collision rectangle is centred in its footprint only. Attachments on the top face of a stack are approximated. Edge sets are 47 pieces for ground tiles; a wall or cliff face has no autotile. Thumbnails of interface pieces, behaviours and sounds in the library are blank.

**Library and hub.** Library items do not know about each other: a behaviour brings the components and tables it names by name search, and a UI prefab does not bring the pictures it shows. Nothing merges two versions of an item. The hub has no web page, no moderation page, no email, no password reset, no paid items and no database (one JSON file, fine for hundreds of items, not millions); packs with code depend on a moderator reading them; there is no scanning of what a picture shows. Credits are written for items that came with an author and licence; art a person made themselves and did not save to the library is not listed.

**Logic.** Graph values are read from variables only; custom behaviours contain event rows, not graphs or nodes. The checker treats any variable name with a dot (`wave.state`, `turn.round`) as made by the engine or a table, so a typo in one is not reported.

## Found by building the samples (all fixed in the engine)
A click or key tap shorter than one frame was lost; menus and the keyboard focus only reacted to the last step of a frame; a modal title could sit under a heads-up display; the hearts above a unit showed garbled characters and, with many hit points, did not fit; resources made by producers were reported as "never set" and shown as `{food}` until the first batch; a build-menu button chose the text `{row.id}` instead of its row; objects placed by the generator lost the tags of their prefab; a new run did not start the battle again ("the game starts" is only the first step); a villager could never reach a solid building (and every failed search cost 6 ms, so 200 villagers took 40 ms a step); a tower's shots could not hurt enemies (they hurt only the player's side); clipping an animated tile kept only one frame and crashed the studio; an edge set could not start from an animated tile; sim events (a path ending, a wave, a day) were missing from the event menu; a marker with no body was warned about for standing on empty space; two library panels did not see each other's changes; tags of prefabs were not offered in event rows.
