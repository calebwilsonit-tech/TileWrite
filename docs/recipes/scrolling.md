# Scrolling: any panel, list or grid

Tick **Scrolls when what is inside does not fit** in a panel's, list's or grid's *Scrolling* section and the engine scrolls it: the mouse wheel, dragging the content, touch, and the project's mapped buttons all work, and the browser's own scrollbar never appears in a game. (A project with the flag `uiScroll` on, which every new project has; an older project plays as it did until the flag is switched on in Project settings, Compatibility.)

## What you can set
| Setting | Choices |
| --- | --- |
| Direction | up and down, left and right, both |
| Limits | room before the first row and after the last, a furthest it may go |
| Sticks to | nothing, **rows**, **pages**, a grid of N pixels |
| At the ends | it stops, or stretches and springs back |
| Moving | eases (at once under *Reduce motion*), or at once; carries on after a drag; a speed |
| When the focus moves inside | bring it into view the least it takes · keep it in the middle · keep N rows of room · go page by page · do not move. Nested scrollers each do their part; rows added or taken away above the chosen one keep it in view; a list the player has scrolled away is left alone |
| Buttons | the project's mapped scroll buttons (the right stick by default), page and shoulder buttons, held repeat with a delay, a rate and an acceleration. Name your own controls to change them |
| Stays at | where the player left it · the end as rows arrive (a chat log) · the start |
| By itself | pixels a second, and again when it reaches the end (a credits roll) |
| Long lists | make rows only as they come into view (give a row's height); the rest is room |
| Values | `name` (0 to 1), `name.row`, `name.rows`, `name.top`, `name.bottom`, `name.page`, `name.pages`, `name.count` in variables you name; inside the pieces `{scroll.pos}`, `{scroll.hidden_before}`, `{scroll.hidden_after}`... |
| Events | when it scrolls, reaches the start, reaches the end (Quick Actions, and the events `ui-scrolled` and `ui-scroll-bottom` for event rows) |

## The scrollbar is made of parts
*Shown*: never, always, while it scrolls, or when the pointer is over it. *On the*: right, left, top or bottom. A width, a thumb as long as what is in view or a fixed length, arrows, a mark for every page. Each part is **a UI prefab you choose**: the track, the thumb, an arrow at each end, the page mark. Parts have the control's states (mouse over, pressed, selected by keys). **More above / more below** are widgets of your own too: tick them, choose a UI prefab, give them a condition (`{scroll.hidden_after} > 0`) or leave it as "when there is more that way", and `{scroll.hidden_before}`/`{scroll.hidden_after}` are the number of rows out of view.

Actions: the focus brings what it chooses into view by itself; *Quick Actions* and scripts can scroll to the top, the bottom, a row or a widget.

## Recipes
- [A long settings menu on a pad](a-long-settings-menu-on-a-pad.md) · [a carousel that snaps](a-snapping-item-carousel.md) · [a credits roll](a-credits-roll.md) · [a chat log that sticks to the bottom](a-chat-log-that-sticks-to-the-bottom.md) · [a grid inventory with a page indicator](a-grid-inventory-with-pages.md)
