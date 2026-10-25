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

**Games of any kind.** It also knows the plugins, the genre starters and the data tables: it can list the plugins and switch them on or off (`set_plugins`), list the templates, read and write data tables (a wave list, a building menu, loot), set a scene's starting variables, make a dungeon, cave, island or town from a seed (`generate_map`), and read and write interface screens (`write_ui_screen`). Ask for "a tiny tactics battle", "a town builder where huts cost 20 gold" or "a roguelike dungeon from seed 7" and it switches on the packs the genre needs, places and sets up the units, fills the tables and starts the battle with an event row, then checks the result. Tested with the API mocked in four genres by `e2e/p2-assistant.spec.ts`.

Story changes are single steps of the same history as everything else (Ctrl+Z, **Undo this**). It cannot run commands, read files outside the project, change anything while the game is running, draw sprites or add sound files.

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

**Reading the project's files.** `project_index` lists every file by kind (it is also in the first message of a conversation), `list_project_files` lists one folder, and `read_project_file` reads one: text comes back as text, a picture as a picture Claude can see, a sprite as a description with a picture of its first frame, and a file a plugin has a reader for (`api.fileReader`) as that plugin explains it. **Sounds cannot be heard**: Claude gets the file's type, length and size, is told it cannot listen, and is told never to say how a sound sounds. Every path must stay inside the project: `..`, absolute paths, drive letters, network paths, `file:stream` names, device names (`CON`, `NUL`...), encoded dots and links that lead outside are all refused, both when Claude names the path and again in the editor's main process (`packages/assistant/src/sandbox.ts`, 60 tests in `sandbox.test.ts`). **Files that may hold a secret are kept from Claude even inside the project**: `.env` and `.env.*`, `*.pem`, `*.key`, `*.p12`/`*.pfx`/`*.jks`/`*.keystore`, `id_rsa*` and the other SSH keys, `.npmrc`, `.netrc`, `.git-credentials`, `credentials*`, `service-account*.json`, `.ssh/`, `.aws/`, `.gnupg/` and `.git/` are neither read nor listed, and the project index leaves them out (the list is `SECRET_PATTERNS` in `path-rules.ts`). Add your own patterns (one a line, `*` for any run of letters, `private/**` for everything below a folder) in **Project settings, Game, Files the assistant may not read**; they are saved in the project file as `assistantDeny`.

**Making pictures.** `draw_sprite` draws small pixel art (a palette and one text row per row of pixels, up to 128 x 128, with frames for an animation); you see the picture before you approve it. `generate_image` asks a picture provider that a plugin added (`api.imageProvider`; **Project settings, Plugins, Examples, "Example: for the assistant"** adds a mock one that needs no service). It only asks the provider after you say yes, because a provider may charge for it; then both you and Claude see the result, and Claude is told what it made so it can say whether it is right. Providers that need a key keep it in the system keychain (assistant settings, *More settings, Picture providers*), never in a project.

**How much Claude may do alone** (the second drop-down at the top of the tab):
| Level | What happens |
| --- | --- |
| Look only | Claude reads and checks. Every change is refused and Claude is told why. |
| Ask me for every change | Every change is shown first and waits for your yes (the way it has always been). |
| Plan first, then do it | Claude must send a plan (a title, steps, anything hard to undo). Nothing changes until you approve it; then it carries on without asking about each step. |
| Do it, I can undo | Changes go in at once. |
At the last two levels a copy of the project is taken before the first change of a question, and an **Roll back this whole run** button appears when it finishes: the project goes back to exactly how it was (files changed are restored, files made are removed, the project is opened again). A project too big to copy (over 120 MB) makes Claude ask about each change instead.

**What a question may cost.** *More settings* has the most one question may cost (default $2; 0 for none). The footer shows this conversation's tokens and cost, and what the last question has cost so far against the limit. When the limit is reached Claude stops, the tools it had asked for are answered ("not run"), and you can ask it to carry on.

**Blocks and gravity.** `place_blocks` (boxes of cells, stairs, ramps, removing) and `set_gravity` (which way, and whether the game may place and break blocks while it runs) do what the Blocks tool and the scene settings do, as one undo step each.

**Plugins** add tools with `api.assistantTool` (a tool that only reads runs at once; one that changes things is shown as a card like any other change), readers with `api.fileReader` and picture makers with `api.imageProvider`.
