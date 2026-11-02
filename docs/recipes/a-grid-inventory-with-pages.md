# A grid inventory with a page indicator

1. A **Panel** *Bag box* in a column. In it a **Text** *Page counter*: `Page {bag.page} of {bag.pages}`, and a **Grid** *Slots* (400 by 280, 5 columns, *Repeats for* your slots, say `slots:40`) whose first widget is a 70 by 70 **Button**.
2. On the grid: *Scrolling*: tick **Scrolls**, *Sticks to* **pages**, *Moving* **at once** (or eases), *Keep its position in variables named* `bag`. Add a scrollbar with **A mark for every page** (the page mark is a UI prefab of your own).

The shoulder buttons (the page buttons) go a whole page at a time, from page to page, and the last page can be a part of one: the counter says "Page 3 of 3" when the end is in view. The arrows walk the slots and the grid follows the chosen one. `{bag.page}`, `{bag.pages}`, `{bag.row}` and `{bag.count}` are plain variables: put them in a text, a bar or a condition. (`e2e/p4-ui-scroll-examples.spec.ts`.)
