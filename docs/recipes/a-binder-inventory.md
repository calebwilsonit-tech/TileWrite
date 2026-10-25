# An inventory that is an open book (the binder)

Turn on the **Parchment UI kit** (Project settings, Plugins) and the Inventory button opens a book: on the left page a paper doll with equipment slots and stats, on the right a grid of item cards. It is made of ordinary designer widgets, so you can build the same thing without the kit, or press **Customize** on the kit's screen and change it.

## How the page is put together
1. **A screen** used as *Inventory* (the part the inventory button opens). The game waits while it is open; Back closes it.
2. **The book** is one *Panel* arranged in a **row** with three children: the left page, a thin *Panel* for the spine, the right page. Both pages are Panels arranged in a **column** with a heading, a flourish and what belongs on the page.
3. **The left page.** A row holds the **paper doll** (a *plugin widget*, "Paper doll", a drawn outline; any *Image* of your own works as well) and a *List* of the equipment slots. A second *List* below it is the stats.
   - The slots come from the kit's list source `parchment-equipment`: head, body, hands, feet, weapon, charm. What is in a slot is the variable `equip_<slot>` (`equip_weapon`), so anything that sets the variable fills the slot. An **item's own "use" setting does it**: in Story, Items, give the sword *Use: set the variable* `equip_weapon` to `Iron sword`, and untick *Used up when used*.
   - The stats come from `parchment-stats`: the player's health and every variable called `stat_<name>` (`stat_attack` shows as "Attack"). Change them with a Quick Action *Change a variable*.
4. **The right page.** A *Grid* with *Repeats for* `the items the player carries`, **4 columns**, a fixed height and **scroll** switched on. Its one child is the card: a *Panel* in free layout with a name, a count (`x{item.count}`), a gold border for *mouse over* and *selected by keys*, and a second Panel on top that is shown only when `{binder_pick} = {item.id}` (the "chosen" frame).
5. **What a card does.** *When clicked*: *Use an item* (`{item.id}`) and *Change a variable* `binder_pick` to `{item.id}`. *When pointed at* (also when chosen with the keys): *Change a variable* `binder_name` to `{item.name}` and `binder_detail` to `{item.detail}`. *When changed* (A and D): *Put an item in a quick slot*. Under the grid, two Texts show `{binder_name}` and `{binder_detail}`, each *shown only when* it has words.
6. **Keys.** W, A, S, D (and the pad) move between the cards, E uses one. Left and right on a card change its quick slot.

## Things to know
- A card is only there for an item the player carries; with none, the grid says what its *Empty text* says.
- Equipment is just variables: nothing in the engine has "equipment". A game with armour sets `equip_body` and a `stat_defence` when the armour is used.
- Tested in `packages/bundled-plugins/src/suite/parchment.test.ts` ("the binder") and played in `e2e/p4-parchment-kit.spec.ts`.
