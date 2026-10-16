# Exporting your game

**Export...** (toolbar, or Commands -> *Export the game*) turns your project into a program other people can run. It needs no editor and no internet.

## What you get

A folder next to where you choose, named like `Cave Quest-1.2-windows`, and a zip of it:

```
Cave Quest-1.2-windows/
  Cave Quest.exe        <- double-click this
  (the game runtime: a few dozen files and folders)
  resources/app/        <- your game: its data, scripts and the player
```

Send the zip to a friend: they unzip it and run the `.exe`. Nothing is installed, and the game keeps its saves, settings and crash reports in its own folder under the player's user data (on Windows: `%AppData%\<Game name>`), so the folder can live anywhere, even somewhere read-only.

## The settings

| Setting | What it does |
| --- | --- |
| Game name | The window title and the name of the program. |
| Version | Shown in crash reports and the folder name. |
| Window width / height | The size of the game picture when it opens. |
| Start full screen | Opens full screen. Players can always switch with F11 (or Alt+Enter). |
| Splash screen text | One line shown for a moment before the game starts (empty = none). |
| Window icon | A PNG in your project (for example `assets/icon.png`) used for the window and taskbar. |

They are remembered in `export-settings.json` in your project (which is never exported).

## It checks first

Before anything is made, Tilewright saves the open scene and checks the whole project: every scene (a player start, doors that lead somewhere, objects that exist), conversations, cutscenes, the settings, the icon, and that **every script compiles**. Anything that would stop the game from working is listed as an error and **the Export button stays disabled until it is fixed**. Warnings (things that are probably mistakes, like a gate that is never wired) are shown but do not stop you.

## What is in the game, and what is not

Included: your scenes, sprites, prefabs, story data, tiles and settings, and your scripts (compiled once, at export). Left out: saves, playthrough recordings, autosaves, project notes, the Claude assistant, the editor's own code and anything starting with a dot.

## If the game crashes

A mistake in a script, or anything unexpected, shows a friendly screen ("Sorry, the game has stopped") in plain English with the cause, saves a report file in the game's `logs` folder, and offers **Copy the details** and **Close the game**. If the game's own files are damaged or missing it says so instead of showing a blank window.

## Limits

* Windows and Linux games are made on Windows and Linux; macOS export is not supported yet.
* The `.exe` file itself keeps the generic icon and the name "Electron" in its file properties; the window and taskbar use your icon.
* Audio is not part of the engine yet (volume settings are stored but nothing plays).
* The game is not code-signed, so Windows SmartScreen may warn people the first time they run it.
