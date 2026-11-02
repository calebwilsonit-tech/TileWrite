# Form controls: slider, pop-up list, tick box, text and number fields, key binding, tabs

Every control a player sets a value with is drawn by the engine, from **parts** that are ordinary UI prefabs you can replace. Nothing in a game is a browser range input, select box or text box. Each one answers the mouse, the keyboard, a gamepad and touch; the buttons it listens to are mapped controls (Project settings, Controls), so players can rebind them.

Recipes that use them: [a-styled-two-thumb-slider.md](a-styled-two-thumb-slider.md), [a-searchable-drop-down.md](a-searchable-drop-down.md), [a-long-settings-menu-on-a-pad.md](a-long-settings-menu-on-a-pad.md).

## The flag
The engine-drawn versions need the compatibility flag **`uiControls`**; scrolling needs **`uiScroll`** (see [../compat_flags.md](../compat_flags.md)). Every new project has both on. A project made before keeps the older look (a browser slider and select box) until the flag is ticked in Project settings, Compatibility. A widget's inspector says so (*This project plays ... the older way*) and has a **Switch it on for this project** button.

## The controls
| Widget | What it reads and sets | What is in the inspector |
| --- | --- | --- |
| **Slider** | a variable or a player setting (`settings.music`); with *Two thumbs*, a second one | direction (any angle), two thumbs, a curve (even, logarithmic, your own table), places it sticks to, how the value is shown, a big step, marks along the track, the wheel, the buttons that move it and how held buttons repeat, *While it is being moved* actions |
| **Drop-down** (Choice list) | the chosen option's value (or all of them) | where the list opens, choose many, type to search, left and right on the closed box, what an option is (value, words, description, group, picture), a filter, the button that opens it, rows before it scrolls, the words on the box, how it opens |
| **Tick box** | on or off | parts: the box, the words |
| **Text field** | words (a variable) | hint when empty, longest, what may be typed, show dots, *When the player finishes (Enter)* actions |
| **Number field** | a number (a variable) | hint, lowest, highest, one step; up and down arrows are parts. The pad steps it |
| **Key binding** | a control of the project | parts: the name of the control, the key or button |
| **Tabs** | which page is on show | part: each tab |

Choice lists, pop-up lists and pickers are one control: the options can be written in the inspector, or come from a **list source** or a **table** (*Repeats for*), and a plugin's list source works the same way.

## Parts
Open a widget and look at **Parts**. Each role (for a slider: *Track*, *Filled part*, *Thumb*, *Second thumb*, *Tick mark*, *The value as words*) is a choice of:
- **(the built-in one)**: the plain default, always available;
- a **UI prefab** of the project;
- a part a **plugin** added (`api.uiPart`, see [../plugins/extension-points.md](../plugins/extension-points.md)).

A part sees values about its control (`{slider.value}`, `{slider.percent}`, `{popup.text}`, `{toggle.on}`, `{tab.name}`), so it can show whatever it likes. Sliders and fields accept **extra parts** of your own (**+ Part**).

## Styles
*Start from a style* then **Use this style** copies a ready-made set of UI prefabs into the project and names them in the parts: **Flat**, **Old paper**, **Sci-fi**, **Pixel art**. Nothing is locked; change or replace any part afterwards.

## Seeing every state
*Show it in the picture as*: **Normal**, **Mouse over**, **Pressed**, **Selected by keys**, **Disabled**, and for a drop-down **Open**. The design picture plays the project's flags, so what you see is what is played.

## Back, typing and the pad
- Back closes an open pop-up list first, with no change, and does nothing else on that press.
- Typing in a text field uses the real keyboard. A pad cannot type (there is no on-screen keyboard), so offer a drop-down or a number field where a pad player must set a value.
- Touch works by pointer events: dragging the slider, tapping an option, dragging a list.
