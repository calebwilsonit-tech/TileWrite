# A styled slider with two thumbs

A price range (a low and a high number) on one slider, drawn in a look of your own, that answers the keyboard, a gamepad, the mouse, the wheel and a finger. (`e2e/p4-ui-slider-dropdown.spec.ts` builds this in the designer and plays it at 16:9, 16:10, 21:9 and 4:3.)

Needs the compatibility flag `uiControls` (every new project has it; see [../compat_flags.md](../compat_flags.md)). Without it a slider is the browser's own range input and has no second thumb.

1. New screen *Filters*. Add a **Panel** *Form*, pinned to the middle, 460 by 300, **in a column**, gap 30.
2. Inside it add a **Slider** *Price*. Set *Reads and sets* to `price_low`, *Step* to `5`, width 380.
3. In the **Slider** section of the inspector:
   - tick **Two thumbs** and set *Second thumb reads and sets* to `price_high` (the thumbs never cross);
   - *Value shown as*: `${value}`;
   - *Marks along the track*: **at every step**;
   - under **Parts**, *Start from a style*: **Sci-fi**, then **Use this style** (this copies ready-made UI prefabs into the project and names them in the parts: *Sci-fi slider thumb*, *Sci-fi slider value*, *Sci-fi slider tick*, and so on);
   - change any part you like: each part box is a list of your UI prefabs (*Track*, *Filled part*, *Thumb*, *Second thumb*, *Tick mark*, *The value as words*). A part is an ordinary widget, so draw your own thumb (a gem, a knob, a boat) as a UI prefab and pick it here. **+ Part** adds an extra part of your own.
4. *Show it in the picture as* (**Normal**, **Mouse over**, **Pressed**, **Selected by keys**, **Disabled**) shows how the slider looks in each state without playing.
5. The Problems panel should say *No problems*.

## Playing it
- **Keyboard and pad**: left and right (the d-pad, the left stick) move the chosen thumb one step. Page up and page down (the pad's shoulder buttons) make a big step (ten steps unless *A big step* says otherwise). **Interact** (E, the pad's A) chooses the other thumb. Holding repeats, and speeds up.
- **Mouse**: drag a thumb, click the track to bring the nearest thumb there, turn the wheel over it.
- **Touch**: a finger on the track does the same as the mouse.

## Make it your own
- **Any direction**: *Angle* turns the slider (-90 is a vertical slider that grows upwards).
- **Not even steps**: *Places it sticks to* (`0, 25, 50, 100`) or *Value along the track* (logarithmic for a volume, or your own table of `position:value` pairs).
- **Its buttons are controls**: *Buttons that move it* names other actions of the project, so players can rebind them.
- **React to it**: *While it is being moved* and the widget's usual *when changed* actions take any Quick Actions (play a sound, change a filter).
- **Read it from anywhere**: the slider gives its parts `slider.*` values, so a part can show `{slider.value}`, `{slider.percent}` or `{slider.text}`.
