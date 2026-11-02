# A chat log that sticks to the bottom

1. A **List** *Log*, 420 by 180, *Repeats for* your lines (a table, a list source of your plugin, or `var:chat_lines`, which makes as many rows as that variable says). Its first widget is a **Text** line, fixed height 28, `Message {index}`.
2. *Scrolling*: tick **Scrolls**; *Stays at* **the end as rows arrive**; *Moving* **at once**; add a scrollbar if you like.

New lines push the log up and the newest stays in view. When the player scrolls up to read, the log **lets go** and stays where they put it however many lines arrive; scrolling back to the bottom picks the newest again. (`e2e/p4-ui-scroll-examples.spec.ts`.) Show "N new messages" with a *more below* widget: tick *A widget when there is more after*, choose a UI prefab with the text `{scroll.hidden_after} new`.
