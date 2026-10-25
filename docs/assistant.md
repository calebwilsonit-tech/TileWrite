# The Claude assistant

The **Claude** tab (next to Inspector) is a chat with Claude about your project. Claude can look at your scene and propose changes. **You approve every change**, and each approved change is one undo step.

Tilewright works fully without it: if you have no key or no internet, nothing else changes.

## Setting up

1. Make an API key in the Anthropic console (Anthropic account -> API keys). Billing is between you and Anthropic.
2. Paste it into the Claude tab and press **Save key**. It is stored with the system keychain (Windows: DPAPI, macOS: Keychain) in Tilewright's own data folder. It is never written into a project, the settings file, a log or an exported game, and it is only sent to Anthropic.
3. Pick a model and how hard Claude should think. The default is a good all-round choice; cheaper ones are fine for explaining things.

The **Remove key** button deletes it again. If your computer has no usable keychain, Tilewright refuses to store the key rather than keep it unprotected.

## What you can ask

Pick a mode with the buttons under the chat, or just type:

| Mode | What Claude does |
| --- | --- |
| Ask | Answers questions about the project. |
| Explain | Explains a problem or an error in plain English. Changes nothing. |
| Fix this error | Finds the cause and proposes the smallest fix. |
| Build this for me | Builds what you describe ("a room where two echoes must hold two plates at once"), then checks it. |
| Review my level | Reviews the open scene and runs the checks. Changes nothing unless you ask. |

**Explain** and **Fix with Claude** buttons also appear next to each problem in the Problems panel, on the event sheet's "Things to fix" list, and on the game's error report.

## Approving changes

Claude proposes changes as cards: a list of what it will do and, for text (event sheet, scripts, notes), a coloured diff. Nothing happens until you press **Apply**. **Reject** tells Claude you said no (it will ask what you want instead). After applying, **Undo this** takes it back, and Ctrl+Z / the History panel work as usual: a whole card is one step ("Claude: place 4 objects").

When Claude proposes several changes in one reply they appear one after another, because a later change can depend on an earlier one (a wire needs the objects it connects).

## What Claude can see and do

It can read: the project overview, the open scene (objects, wires, regions, variables), map cells, your selection, the event sheet, every behaviour and event block that exists, the prefabs, scripts, the scripting reference, the problem list, the project notes, a screenshot of the viewport, **the story** (items, every conversation and cutscene, minigames, skins, the world map and the sound mix, each with the problems the checker found) and **the text that can be translated** (and how much of a language is done); and it can run the puzzle checks and the playbot (the bot plays with a player's buttons, solving crate puzzles first).

It can change (always as a card): place, change and delete objects; paint map cells; connect and remove wires; replace the event sheet; write scripts; edit the project notes; **change single event rows (add, change or remove one without sending the whole sheet); make a prefab from an object; write the minigames, the skins, the world map and the sound mix (levels, ducking, per-sound settings, music loop points); the screen layout and theme, the controls, the title screen and project name;** **write a conversation, a cutscene or the item list; replace the scene's regions (rooms, music, darkness); add or change a language's translations** (new languages are created with their own name). Story and translation cards show a diff and the checker's warnings before you apply, and each has an **Undo this** that restores the previous version.

**Games of any kind.** It also knows the plugins, the genre starters and the data tables: it can list the plugins and switch them on or off (`set_plugins`), list the templates, read and write data tables (a wave list, a building menu, loot), set a scene's starting variables, make a dungeon, cave, island or town from a seed (`generate_map`), and read and write interface screens (`write_ui_screen`). Ask for "a tiny tactics battle", "a town builder where huts cost 20 gold" or "a roguelike dungeon from seed 7" and it switches on the plugins the genre needs, places and sets up the units, fills the tables and starts the battle with an event row, then checks the result. Tested with the API mocked in four genres by `e2e/p2-assistant.spec.ts`.

Story changes are single steps of the same history as everything else (Ctrl+Z, **Undo this**). It cannot run commands, read files outside the project, change anything while the game is running, or add sound files.

## Project notes

Open **Project notes** in the tab and write rules for your game ("No puzzle may be bypassable. Gates are always brown."). Claude reads them at the start of every conversation. They live in `project-notes.md` in your project folder.

## Cost

The footer shows tokens and an estimated cost for the current conversation (list prices; cached tokens are cheap). The system prompt and the tool list never change, and the conversation only grows, so Anthropic's prompt cache keeps most of each request cheap. **New chat** starts over. A question can use at most 30 model calls.

## When something goes wrong

Rate limits, overload, no internet, a wrong key and an empty account each show a plain message; when trying again can help there is a **Retry** button (it repeats the last question without asking you to retype it). If Claude declines a request, you are told. By default Anthropic may retry a declined request on another model (a beta feature; turn it off under *More settings*; if the API rejects it, Tilewright quietly stops asking for it).

## For developers

Code is in `packages/assistant` (prompt, tool schemas, the conversation loop, model list; no Electron) and `packages/editor/src/main/assistant.ts` (key storage, SDK calls) with the editor side in `packages/editor/src/renderer/assistant/`. The SDK is `@anthropic-ai/sdk`, called only from the main process. Tests mock the API: unit tests script a fake client; `e2e/m11-assistant.spec.ts` runs the real SDK against a local mock server (set `TILEWRIGHT_ASSISTANT_BASE_URL`; the panel says when a custom address is in use). To try the real thing: `$env:ANTHROPIC_API_KEY = 'sk-ant-...'; npm run test:live` (costs a few cents).

## Pictures, files, plans (phase 3)

**Pictures you attach.** The paperclip next to the message box (or a paste, or a drop) adds up to six PNG, JPEG, GIF or WebP pictures, each under about 3.5 MB, to the next message. Claude looks at them with the rest of your question. Anything else is refused with a word.

**Reading the project's files.** `project_index` lists every file by kind (it is also in the first message of a conversation), `list_project_files` lists one folder, and `read_project_file` reads one: text comes back as text, a picture as a picture Claude can see, a sprite as a description with a picture of its first frame, and a file a plugin has a reader for (`api.fileReader`) as that plugin explains it. **Sounds cannot be heard**: Claude gets measurements and a waveform picture (see below), is told it cannot listen, and is told never to say how a sound sounds. Every path must stay inside the project: `..`, absolute paths, drive letters, network paths, `file:stream` names, device names (`CON`, `NUL`...), encoded dots and links that lead outside are all refused, both when Claude names the path and again in the editor's main process (`packages/assistant/src/sandbox.ts`, 60 tests in `sandbox.test.ts`). **Files that may hold a secret are kept from Claude even inside the project**: `.env` and `.env.*`, `*.pem`, `*.key`, `*.p12`/`*.pfx`/`*.jks`/`*.keystore`, `id_rsa*` and the other SSH keys, `.npmrc`, `.netrc`, `.git-credentials`, `credentials*`, `service-account*.json`, `.ssh/`, `.aws/`, `.gnupg/` and `.git/` are neither read nor listed, and the project index leaves them out (the list is `SECRET_PATTERNS` in `path-rules.ts`). Add your own patterns (one a line, `*` for any run of letters, `private/**` for everything below a folder) in **Project settings, Game, Files the assistant may not read**; they are saved in the project file as `assistantDeny`.

**Making pictures.** `draw_sprite` draws small pixel art (a palette and one text row per row of pixels, up to 128 x 128, with frames for an animation); you see the picture before you approve it. `generate_image` asks a picture provider that a plugin added (`api.imageProvider`; **Project settings, Plugins, Examples, "Example: for the assistant"** adds a mock one that needs no service). It only asks the provider after you say yes, because a provider may charge for it; then both you and Claude see the result, and Claude is told what it made so it can say whether it is right. Providers that need a key keep it in the system keychain (assistant settings, *More settings, Picture providers*), never in a project.

**How much Claude may do alone** (the second drop-down at the top of the tab):
| Level | What happens |
| --- | --- |
| Look only | Claude reads and checks. Every change is refused and Claude is told why. |
| Ask me for every change | Every change is shown first and waits for your yes (the way it has always been). |
| Plan first, then do it | Claude must send a plan (a title, steps, anything hard to undo). Nothing changes until you approve it; then it carries on without asking about each step. |
| Do it, I can undo | Edits inside the project go in at once. |

**What is always asked, at every level.** Even when you have said "do it" or approved a plan, Claude still shows a card and waits for your yes before it **takes something away** (deleting objects, removing wires or event rows or behaviours, removing the world map or blocks, resetting the screen layout or controls), before it **changes which plugins are on**, before it runs **a tool a plugin added**, and before it **uses the network** (`generate_image`, which a service may charge for). The card says which of these it is. The rule is `packages/assistant/src/approval.ts` (tested on its own, and a test fails when a new tool with a risky name is not classified).
At the last two levels a copy of the project is taken before the first change of a question, and an **Roll back this whole run** button appears when it finishes: the project goes back to exactly how it was (files changed are restored, files made are removed, the project is opened again). A project too big to copy (over 120 MB) makes Claude ask about each change instead.

**What a question may cost.** *More settings* has the most one question may cost (default $2; 0 for none). The footer shows this conversation's tokens and cost, and what the last question has cost so far against the limit. When the limit is reached Claude stops, the tools it had asked for are answered ("not run"), and you can ask it to carry on.

**Blocks and gravity.** `place_blocks` (boxes of cells, stairs, ramps, removing) and `set_gravity` (which way, and whether the game may place and break blocks while it runs) do what the Blocks tool and the scene settings do, as one undo step each.

**Plugins** add tools with `api.assistantTool` (a tool that only reads runs at once, but only when its plugin was not granted anything beyond reading the project: a plugin that can write, use the network or run programs cannot make its own tool skip the question by calling it "read"; one that changes things is shown as a card, always, even at the "do it" level), readers with `api.fileReader` and picture makers with `api.imageProvider`.

## Reading more of the project, drawing and plans (round 2)

**Pictures and PDFs.** The paperclip also takes **PDFs** (up to 12 MB; sent whole as documents), and pictures other than PNG, JPEG, GIF and WebP: **BMP, PSD (its flattened picture), Aseprite and SVG** become PNG, and a picture that is too big is **made smaller instead of refused** (the longest side at most 1568 pixels, under 3.5 MB; the chat says what was changed). `read_project_file` does the same for files in the project, and every picture comes with a line of facts: its size, its frames and the colours in it (`packages/editor/src/renderer/assistant/pictures.ts`). A PDF is sent as a document block when it has at most 100 pages and 12 MB; a bigger or locked one gives its extracted text or the reason. The main process checks attachments again, makes a still-too-big picture smaller with Electron's own image code and tells Claude what could not be sent (`main/attachments.ts`), and every tool result is checked before it goes to the API (`cleanToolOutput`: only text, pictures and PDFs, bounded in size).

**Search and what uses what.** `search_project` looks for words inside the text files (with line numbers; case, a pattern, a kind, a folder) and for files by name or kind (`*` and `?` work). The project index (in the first message and `project_index`) says after each file what uses it or what it uses, and lists the sprites, tables, sounds and pictures that nothing uses; `project_references` gives the detail for one file and where in each file the reference was found. A reference is found where a file writes out another's name or path exactly (a sprite by its name, a sound by its path or file name, a table as `{Table.row.column}` or `table:Name`, an item by its id, a scene in `project.json`); one built from pieces in a script is not seen.

**Pictures of the project's own files.** A scene file comes back as its text and a picture drawn from it (the map at the game's angle with heights, blocks, pits, water, the objects with names, regions as outlines, wires as lines; a very big map is drawn from above), plus a picture for each logic graph. A `screens.json` file gives a wireframe for each screen (up to four), a conversation gives boxes and arrows, and `project.json` gives the tiles. They are sketches drawn from the data (`assistant/preview/`), not the game: tile pictures are not drawn, and the wireframe estimates text sizes.

**Sound.** Claude still cannot hear. For a sound file it gets the length (also for MP3, which has no length field), peak and average level in decibels, whether it clips, silence at each end, the loop points stored in the file (the WAV sampler chunk, or `LOOPSTART`/`LOOPLENGTH` tags) and a picture of the waveform with time marks and loop markers (`assistant/audio.ts`).

**Drawing.** `draw_sprite` takes a palette and any of: pixel rows, **layers** (each rows, **editable shapes**, or an **SVG**) and **flood fills**; shapes are saved as vector layers, so they can still be edited in the studio, and the sprite is opened in the studio when it is applied. `tile_template` gives the canvas of a floor tile or block for this project's tile size (the faces as rows of `T`, `L`, `R`), and `draw_tile` makes a tile from a drawing on it: cut to its faces, split into the top and side pictures a tile uses, added to the **tile palette** and selected, with a picture of it repeated over a patch of ground. `generate_image` can say `as: "floor-tile"` or `"block-tile"` (and `source`, `columns`, `rows`, `levels`): the picture then goes through the **tile import** (`tilestudio/import.ts`): cut if it is a sheet, fitted to the project's tile shape (a flat texture is laid on the diamond or the three faces; an isometric picture has its background taken away and is fitted), and its colours matched to the tiles the project already has (or reduced to a small set when it has none).

**Plans with checkpoints.** When the person approves a plan the panel shows its steps, ticked off as Claude reports them (`plan_step`: "start" and "done"). A checkpoint of the project is taken before each step (only the files that differ from the copy taken at the start of the run are kept), so each step has **Back to before this step**: the project goes back there, that step and the ones after it are undone, and Claude is told with the person's next words. **Stop after this step** lets Claude finish the step it is on and then holds the plan: nothing more can change until **Go on with the plan** (or the person rolls back). The whole-run roll back stays.

**Finding what is wrong or slow.** `read_console` (the Console, the game's last crash, script problems), `profile_game` (a few seconds of the open scene with no window and the profiler on), `run_project_checks` (what Export checks, for the whole project) and `run_playthroughs` (the project's saved playthroughs are its tests).

Tests: `pdf.test.ts`, `search.test.ts`, `references.test.ts`, `plan-run.test.ts`, `tool-output.test.ts` (assistant package), `pictures.test.ts`, `audio.test.ts`, `drawing.test.ts`, `checkpoints.test.ts`, `preview/preview.test.ts`, `tilestudio/make-tile.test.ts`, `main/attachments.test.ts`, and `e2e/p4-assistant-files`, `p4-assistant-drawing`, `p4-assistant-plan`, `p4-assistant-diagnostics`.
