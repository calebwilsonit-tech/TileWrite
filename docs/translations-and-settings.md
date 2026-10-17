# Translations and player settings

## Translating your game
The text you write (conversations, cutscene lines, item names, messages) is the **original**. A language is a table that maps each original line to its translation. A line with no translation shows the original, so a half-translated game still works.

1. **Story panel -> Translations...** (or **Commands -> Translations**).
2. Add a language: a short code (`fr`, `de`, `pt-br`) and its name as its speakers write it (`Français`).
3. The table lists every line of text the player can read, with where it came from ("Dialogue Elder", "Item Bread", "Game menus and messages"). Type the translation beside each line. **Only lines without a translation** shows what is left; **Find text** looks through every scene, conversation, cutscene and item again after you change the game.
4. **Save**. Each language is one file, `assets/localization/<code>.strings.json`, shipped with an exported game.

What is translated: conversation speakers, lines, prompts and choices; cutscene lines and messages; item names, descriptions and use messages; the **Show a message** action; pickup messages; the game's own menus, settings and built-in messages ("Received Bread", "Slot 2", "X is lit."). Placeholders such as `{who}` or `{name}` are filled in *after* translating, so keep them in the translation.

What is not: sentence stones and text blocks (changing the words changes the puzzle), object names you see in the editor, and anything a script writes with `log`.

Players choose their language in **Settings -> Language**; it appears only when the game has at least one language. Each language is shown by its own name, so a player who cannot read the current language can still find theirs. The choice is remembered.

### Working with a translator
**Export CSV** writes `assets/localization/<code>.csv` (two columns: `source`, `translation`; UTF-8). Open it in a spreadsheet, fill the second column, save as CSV, and bring it back with **Import CSV...**. Rows whose original text is no longer in the game are skipped and counted. The project check (Problems -> Check the whole project) warns when a language is missing lines.

## Settings the player can change
**Pause menu -> Settings** (remembered on the player's computer, not in your project):

| Setting | What it does |
| --- | --- |
| Master / Music / Effects volume | see [sound-and-effects.md](sound-and-effects.md) |
| Difficulty | easy halves the damage the player takes, hard makes it one and a half times |
| Screen shake and hit freeze | turns off shake and the short freeze when a hit lands |
| Camera zoom | 75%, 100%, 125% or 150% of the normal view |
| Full screen | in an exported game only (F11 and Alt+Enter also work). The editor's own window is never switched, so the row is not there during Play |
| Show frame rate | a small frames-per-second counter in the top-right corner |
| Language | see above |
| Controls | every action can be given a new key, mouse button or gamepad button |

Full screen starts as the game was exported (Export dialog) until the player changes it once.
