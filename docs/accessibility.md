# Accessibility

Open **Aa** (the toolbar, the project screen, or **Commands -> Accessibility**). Changes apply at once and are remembered.

| Setting | What it does |
| --- | --- |
| **Size of everything in the window** (100% to 200%) | Menus, panels, text and the map are drawn bigger, like zooming a web page. Use it on a high-resolution screen or if small text is hard to read. |
| **Colour-blind-safe colours for overlays** | The collision, walk-test and solid-object overlays switch from green/red to an Okabe-Ito palette (light blue walkable, red-orange blocked, dark blue water, yellow stairs, green bridge, purple triggers) whose colours stay apart for red-green and blue-yellow colour blindness. The Layers panel's legend changes with it. The palette is checked by a test that simulates protanopia, deuteranopia and tritanopia. |
| **Less motion** | Turns off pulsing and sliding in the editor's own interface (the tutorial's highlights, for example). Your operating system's "reduce motion" setting does the same. |

## Things that never depend on colour alone
- Problems are marked with a symbol (a cross for an error, an exclamation mark for a warning) as well as colour, and always say what is wrong in words.
- The game's own menus, dialogue and hearts are text and shapes.

## Everything can be remapped
- **Editor keys**: **Shortcuts** lists every command with its key; click *Change* and press a new key (conflicts are highlighted). Everything that has a key also has a button or a place in the command palette (Ctrl+K).
- **Game controls**: in a running game open the pause menu (Esc), **Settings -> Controls**, choose an action and press the new key or gamepad button. Games remember the choice per player. Exported games keep the same menu.
- The editor works with the keyboard alone as well as the mouse, and every tool has a hotkey.

## For game makers
The engine has settings players can use in your game: difficulty, screen shake on/off, and full remapping of keys and gamepad buttons. Add text to your game in the Story panel (conversations, cutscenes) rather than into pictures so it can be read and resized.
