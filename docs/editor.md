# The editor (M3): panels, tools and shortcuts

Everything here works with the mouse and keyboard only. Press **Ctrl+K** any time to search every command.

## Projects
- **New project**: pick a name and a template (Empty isometric world, Starter room, Puzzle dungeon), then choose where to create it. Tilewright makes `<folder>/<name>/` containing `project.json` and `scenes/main.scene.json`.
- **Open an existing project**: choose a folder that has a `project.json`. If the file is damaged or from a newer Tilewright, you get a plain-English message and nothing is changed.
- **Recent projects** remembers the last 12. The ✕ only removes the list entry, never files.
- Files are plain JSON. A scene writes one map row per line, so version-control diffs of a small edit are small.
- **Autosave** writes unsaved work to `.tilewright/autosave/` every 20 s (never over your real files). After a crash, reopening the project offers **Recover**. Saving clears the autosave.

## The window
Panels dock, tab, split and float: drag a tab. The layout is remembered; **Commands → Reset panel layout** restores the default.

| Panel | What it is for |
| --- | --- |
| Viewport | The world. Middle-drag, right-drag or Space+drag to pan; mouse wheel zooms; Home frames the map. |
| Tools | Every tool, grouped. The active tool shows a one-line explanation and its options. |
| Tiles | The tile palette with search, **Tile art** (cover a tile with a sprite, make a tile from a sprite or import a PNG as a tile) and the **Autotiling...** button (see [autotiling-and-layers.md](autotiling-and-layers.md)). |
| Inspector | Edits whatever is selected: an object, a region, or (with nothing selected) the scene and map size. Fields apply on Enter or when you click away, so one edit is one undo step. |
| Layers | Show/hide and lock Ground, Walls, Objects, Decoration, Lights and Regions (see [autotiling-and-layers.md](autotiling-and-layers.md)); overlays for the grid, collision colours and height numbers. |
| History | The undo list. |
| Problems | Mistakes found in the scene, in plain English, with **Go to**. |
| Console | Messages from the editor and from the game while it runs. |
| Assets | The project's sprites, with search, tags and "find where it is used" (see [sprite-studio.md](sprite-studio.md)); its prefabs; and its sounds and music (see [sound-and-effects.md](sound-and-effects.md)). |
| Events | The scene's event sheet: rows that read like sentences, variables, and a "Convert to code" button (see [logic.md](logic.md)). |
| Story | Items, conversations (a graph of lines, choices, flags and gifts), cutscenes, minigames and skins (see [story-systems.md](story-systems.md)), and the **Translations...** button (see [translations-and-settings.md](translations-and-settings.md)). |
| Data | Your own game data and blocks with no code: **tables** (spreadsheets of units, items, recipes, waves...), **components** (named settings an object carries), **behaviours** (event rows with settings of their own) and **events** (see [data-and-blocks.md](data-and-blocks.md)). |
| Mixer | The mix of the game's sound: bus levels (master, music, sound effects, voice), ducking, and every sound's loudness, bus, pitch drift, variants and music loop points (see [sound-and-effects.md](sound-and-effects.md)). |
| Playbot | Lets a bot play the open scene with only a player's buttons and reports how it went; keeps and replays playthroughs (see [checks-and-playbot.md](checks-and-playbot.md)). |
| Claude | A chat that can look at your project and propose changes you approve (see [assistant.md](assistant.md)). |

Two more workspaces sit beside **World** at the top: **Sprites** (draw and animate, see [sprite-studio.md](sprite-studio.md)) and **Code** (scripts, see [code-window.md](code-window.md)). **Export...** makes a program of your game ([export.md](export.md)). **Aa** opens the [accessibility](accessibility.md) settings. **Commands -> Start the tutorial** builds a small puzzle room step by step.

## Tools
**Select** (V): click to select, Shift-click to add, drag an object to move it (snaps to half cells, hold Alt for free movement; it sits on the ground below it), drag empty space to box-select. R turns it, Delete removes it, Ctrl+C / Ctrl+V / Ctrl+D copy, paste, duplicate. Copying works across scenes.

**Paint**: Brush (B), Rectangle (U, optional outline), Line (L), Fill (G), Eraser (E), Scatter (S), Stamp (T: drag to copy an area, click to stamp, Esc forgets it).

**Height**: Raise (Q, Shift lowers), Lower (W), Set height, Smooth. Heights are levels (16 px). A cell changes once per drag, so click again to go higher.

**Terrain**
- **Stairs** (Z) / **Ramp** (X): click a cell, or drag a line of them; the direction follows the drag (R rotates the default). The base height copies the floor they climb from, so the bottom always meets the ground, and a second flight starts where the first ends. If the top does not meet a floor (or bridge) at the right level you get a warning.
- **Cliff** (C): drag a rectangle to raise it to a height; its edges become cliffs that block walking.
- **Pit** (P), **Water** (O), **Bridge** (J, deck at a chosen level): Shift removes.

**Collision**: Blocker (K) paints invisible walls, at every height or (untick "Blocks at every height") only between two levels: a low wall that a bridge above can pass over, or an overhead blocker that only stops tall things on high decks (Shift clears); One-way edge makes a side that cannot be entered; **Walk test** (H) shows everywhere the player could walk to from a clicked cell. Collision comes from the terrain automatically (heights, slopes, pits, water, decks); the overlay (Layers → Collision colours, or automatically while a terrain tool is active) shows it: green walkable, red blocked, blue water, yellow stairs, orange bridge, pink "blocks other heights only". **Layers -> Seen by a walker at** shows the colours as a walker at height 0, 1, 2... would meet them, so you can check each level of a multi-storey room.

**Objects**: Place (N) puts the chosen object on the grid (R turns it); placing the Player start again moves it. Region (M) marks a room.

**Helpers**: Room builds walls around a flat floor; Corridor carves a two-wide path between two points; Scatter props sprinkles an object over an area while avoiding walls, water, pits and stairs.

## Playing
- **Play** (F5) runs the scene in the viewport; **From here** (Ctrl+Enter) starts at the cell under the mouse. Pause (F6), Step one frame (F10), Stop (Shift+F5 or Esc).
- Playing never changes the scene you are editing. If something breaks, the game pauses and the Console explains.
- **Apply edits** (F7) while playing puts the edits you have made since Play into the running game: the scene is loaded again (objects go back to where they start) and prefabs, sprites, items, conversations and cutscenes are replaced, but you keep your place, items, flags, health and the event rows that already ran. Tick **As I edit** to do it automatically a moment after each change. (Scripts already reload by themselves while you type.)
- **In a window** (F8) runs the game in a window of its own, the way an exported game runs, while the editor stays open. It saves the open scene, compiles the scripts and starts a throw-away copy; press it again to restart with your latest edits. The window's title says it is running from the editor; it saves into the project's saves folder, can only read its own copy of the files, and closes when you close the editor.
- Controls: WASD / arrows move, Shift runs, Space jumps.
- A region with **Keep the camera inside this room** limits the camera while the player is in it.

## Undo, save, scenes
Ctrl+Z / Ctrl+Y undo and redo every change, whichever panel made it. Ctrl+S saves. **+ Scene** adds a scene to the project; the scene picker switches (it saves first).

## Customising
**Commands → Shortcuts** lists every command with its key; click Change and press a new key. Conflicts are highlighted. **Light / Dark** switches the theme.

## Not yet in the editor
Free rotation and scaling of pixel selections, and tile art editing (terrain is still drawn from colours). See KNOWN_ISSUES.md for the full list.
