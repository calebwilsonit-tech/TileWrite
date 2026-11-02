# A horizontal item carousel that snaps

A row of cards that slides sideways and always comes to rest with a whole card in the window. (`e2e/p4-ui-scroll-examples.spec.ts`.)

1. A **List** *Cards*, 460 by 130, *Arrange what is inside*: **in a row**, *Repeats for* your items (or `slots:10` to try it). Its first widget is the card: a **Button** 140 by 90, text `Card {slot}`.
2. *Scrolling*: tick **Scrolls**; *Direction* **left and right**; *Sticks to* **rows**; *When the focus moves inside* **keep it in the middle**.

Right on the pad chooses the next card and the cards ease along to put it in the middle; the offset is always a whole number of cards. Use *Sticks to* **pages** for a carousel that goes a window at a time, and *At the ends* **stretches and springs back** for a softer end. A page indicator is `{name.page}` of `{name.pages}` from *Keep its position in variables named*.
