# A credits roll that scrolls by itself

1. A **List** *Roll*, 420 by 200, *Repeats for* `slots:30` (or a table of your credits), its first widget a centred **Text**, "Made by {row.name}".
2. *Scrolling*: tick **Scrolls**; *Scrolls by itself* **160** (pixels a second); tick **and starts again** for a loop; untick **Mouse wheel** so nobody scrolls it away.

It moves with no input at all and, at the end, starts again from the top (without *and starts again* it stops at the end). Add an action under *When it reaches the end* to close the screen or open the title: the roll is a screen like any other. Under *Reduce motion* it still moves (it is the content, not decoration); give it a speed of 0 there with a condition on a setting if you want it still.
