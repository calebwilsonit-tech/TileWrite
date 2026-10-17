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

Story changes are single steps of the same history as everything else (Ctrl+Z, **Undo this**). It cannot run commands, read files outside the project, change anything while the game is running, draw sprites or add sound files.

## Project notes

Open **Project notes** in the tab and write rules for your game ("No puzzle may be bypassable. Gates are always brown."). Claude reads them at the start of every conversation. They live in `project-notes.md` in your project folder.

## Cost

The footer shows tokens and an estimated cost for the current conversation (list prices; cached tokens are cheap). The system prompt and the tool list never change, and the conversation only grows, so Anthropic's prompt cache keeps most of each request cheap. **New chat** starts over. A question can use at most 30 model calls.

## When something goes wrong

Rate limits, overload, no internet, a wrong key and an empty account each show a plain message; when trying again can help there is a **Retry** button (it repeats the last question without asking you to retype it). If Claude declines a request, you are told. By default Anthropic may retry a declined request on another model (a beta feature; turn it off under *More settings*; if the API rejects it, Tilewright quietly stops asking for it).

## For developers

Code is in `packages/assistant` (prompt, tool schemas, the conversation loop, model list; no Electron) and `packages/editor/src/main/assistant.ts` (key storage, SDK calls) with the editor side in `packages/editor/src/renderer/assistant/`. The SDK is `@anthropic-ai/sdk`, called only from the main process. Tests mock the API: unit tests script a fake client; `e2e/m11-assistant.spec.ts` runs the real SDK against a local mock server (set `TILEWRIGHT_ASSISTANT_BASE_URL`; the panel says when a custom address is in use). To try the real thing: `$env:ANTHROPIC_API_KEY = 'sk-ant-...'; npm run test:live` (costs a few cents).
