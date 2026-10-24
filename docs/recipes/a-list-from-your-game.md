# Show a list from your game in a screen

A list widget repeats a piece of screen for every row of something. The game offers the save slots, the controls, the places on the world map, the quick slots, the carried items, any table of yours, and what plugins add. To show your own, a plugin adds a **list source**:

```ts
api.listSource({
  id: 'badges',
  label: 'Badges the player has earned',
  // what each name in a row is, for the designer's "Bind to..." list
  fields: { 'badge.name': 'The name of the badge' },
  rows: (sim) =>
    Object.keys(sim.runtime.vars)
      .filter((k) => k.startsWith('badge:') && sim.runtime.vars[k])
      .map((k) => ({ id: k.slice(6), scope: { 'badge.name': k.slice(6) } })),
});
```

In the UI designer: add a **List**, choose *Repeats for: Badges the player has earned*, put a **Text** inside it with the words `{badge.name}`. The first widget inside is what every row looks like. Write something in *Words when there is nothing to show* and it appears when the list is empty. A row can have actions (a button inside, or the row itself): they run with the row's names in view, so `{badge.name}` works in an action too.

A source is just a function of the running game: it is called every frame while a screen shows it, so keep it cheap. If it throws, the plugin gets the blame (the Problems panel names it) and the list shows nothing.

Without a plugin: a **table** (Data workspace) is a list source too, `each row of the table "Badges"`, with `{row.name}` and the other columns.
