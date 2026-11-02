# A long settings menu on a pad

A screen taller than the window, with a scrollbar of your own, where every row can be reached with a keyboard or a gamepad and is in view when it is chosen. (`e2e/p4-ui-settings-scroll.spec.ts` builds this in the designer and walks it at 16:9, 16:10, 21:9 and 4:3.)

1. A UI prefab **Brass thumb**: a **Panel** 14 by 48 with a rounded accent fill.
2. A modal screen with a **Panel** *Options* in the middle, 520 by 340, **in a column**. Tick **Scrolls**; add a **scrollbar** shown **always**, 14 wide, with the thumb part set to *Brass thumb*; *When the focus moves inside*: **keep rows of room** (1).
3. Inside it: a **Slider** *Volume* (reads and sets `volume`, steps of 5), a **Choice list**, a **Tick box**, and a **List** *Rows* (*Repeats for* `slots:12`, its height *fit the contents*) whose first widget is a **Button** "Option {slot}".

## Playing it
- **Keyboard and pad**: up and down (the d-pad, the left stick) walk the rows; when the chosen row would leave the window the panel slides by itself. Going past the last row comes round to the first.
- **Right stick** (or the scroll buttons): scrolls without moving the choice. **Shoulder buttons**: a page. Holding repeats, and speeds up.
- **Mouse**: the wheel, dragging the content, dragging the thumb, clicking the track. **Touch**: drag the content with a finger.

The scroll buttons are ordinary controls (`ui_scroll_up`, `ui_scroll_down`, `ui_page_up`, `ui_page_down`...): Project settings, Controls lists them and the player can rebind them. A scroller can name other controls of its own in *Buttons that scroll it*.
