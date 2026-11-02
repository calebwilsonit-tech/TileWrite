# A drop-down you can search

A drop-down that lists ten countries, opens with a key, a pad button, a click or a touch, and narrows its options as the player types. It is drawn by the engine from parts you can replace, never the browser's select box. (`e2e/p4-ui-slider-dropdown.spec.ts` builds this in the designer.)

Needs the compatibility flag `uiControls` (every new project has it; see [../compat_flags.md](../compat_flags.md)).

1. On a screen, add a **Drop-down** *Country*. Set *Reads and sets* to `country` and the width to 260.
2. *Options*: `Norway, Sweden, Denmark, Finland, Iceland, Estonia, Latvia, Lithuania, Poland, Germany`. (Or choose a **list source** or a **table** instead, for options that come from your game.)
3. In the **Pop-up list** section: tick **Type to search**, set *Rows before it scrolls* to `5`, and under **Parts** choose *Start from a style* **Old paper** and **Use this style**.
4. **Open** next to *Show it in the picture as* shows the list open in the designer, so you can style it without playing.

## Playing it
- **Interact** (E, the pad's A) opens the list. Typing narrows it (`sw` leaves Sweden). Up and down walk the options, Interact (or A) chooses, **Back** closes the list with no change and does nothing else (the screen under it stays).
- **Left and right on the closed box** step through the options without opening it (turn it off by unticking *Left and right on the closed box step through the options*).
- **Mouse**: click the box, click an option; clicking outside closes it. **Touch**: the same by tapping, and a long list scrolls with a finger.
- The list stays inside the screen at every shape (16:9, 16:10, 21:9, 4:3): it opens below the box, or above it when there is no room.

## Make it your own
- **Where it opens** (*The list opens*): below the box, above it, beside it, in the middle of the screen, or **as a screen of its own** (the screen opens and the options are available to it; you draw its rows yourself, there is no ready-made list for them yet).
- **Several choices at once**: tick **Choose many**; the closed box says `{count} chosen` (*Box says, when many are chosen* changes the words).
- **Rows with more in them**: for a table or list source, say what each option's value, words, description, group heading and picture are (`{row.id}`, `{row.name}`...).
- **Hide some options**: *Show an option only when* takes a condition (`{option.value} != locked`).
- **Parts**: the closed box, the list, each option, a group heading, the search box and the "nothing matches" line are each a UI prefab you can replace. The list scrolls with the same settings as any [scroller](scrolling.md).
- **A context menu** is the same control: *Button that opens it* names any mapped action, and the list opens beside the box.
- **Events**: the widget's usual *when changed* actions run with the chosen value.
