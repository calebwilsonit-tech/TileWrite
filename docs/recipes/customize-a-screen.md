# Change the pause menu (or any screen the game comes with)

A new project already plays with a Pause screen, a Title, an Inventory, a Settings screen and the rest: they come from the *Prebuilt screens* plugin and are ordinary designer screens. You change one by making your own copy.

1. Open the **UI** workspace (the *UI* button at the top).
2. On the left, under **Screens from plugins**, find *Pause* and press **Customize**. A copy called *Pause* appears in the list of screens and is opened. It plays the Pause part from now on; the plugin's own is left as it was.
3. Select a widget in the outline (for example *Resume*, then its *Label*) and change **Words** to what you want. Everything you can do to a widget in the designer works: colours, sizes, the order of rows (arrows in the inspector), a tooltip, "Shown only when...", a new button with its own actions.
4. Press **Play** and the pause button: your menu opens.
5. Changed your mind? Under **Screens from plugins**, **Compare with the plugin's** lists what differs, widget by widget, in plain words. **Revert to the plugin's** throws your changes away; **Use the plugin's again** deletes your copy.
6. When the plugin changes its screen in a new version, the entry says so ("the plugin has a newer one"). If you never changed your copy, **Update to the newer one** swaps it in; if you did, **Compare** shows what is new so you can copy over what you want.

Good to know:
- A screen's **This screen is used as** setting says which part it plays. Your own screen for a part always wins over a plugin's.
- Rows that list things (the save slots, the items) are lists; their row template is the first widget inside. Change that and every row follows.
- Keep it in the **Library** (Save to the library, kind *UI widgets*, pick *Screen: Pause*) to use it in another project.
