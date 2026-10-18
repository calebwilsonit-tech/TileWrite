# Your own data and building blocks (no code)

Everything here lives in the **Data** panel (next to Problems, Story and Events) and is saved in the project folder as plain files, so it can be shared and versioned. Nothing is built into the engine about what a "unit", a "building" or a "card" is: you describe them.

## Data tables (`assets/tables/<Name>.table.json`)
A table is a spreadsheet. Every row has an **id**; the other columns have a name and a kind: text, number, yes/no, colour, one-of-a-list, **a row of another table**, sprite, prefab, sound. Make *Units* with columns `name`, `hp`, `speed`, `cost`; *Buildings* with `cost`, `produces`, `rate`; *Waves* with `enemy`, `count`, `delay`. **Edit as CSV** shows the table as comma-separated text (a spreadsheet program can open it) and applies your changes back; new columns in the text become new text columns.

Read a cell anywhere you can type a value, as `{Table.row.column}`, for example `{Units.knight.hp}`:
- in a message: "A {Units.knight.name} costs {Units.knight.cost} gold";
- in an event row's variable value: *set gold to* `{gold} - {Units.knight.cost}` (see "Doing sums" below);
- in the *A variable compares* condition (the variable name may itself be a cell, `Units.knight.hp`);
- in the UI designer's bindings (when bound to a label or bar).

Names can be built from other names: `{Units.{self.kind}.hp}` reads the row named by a setting called *kind*.

**For each row of a table**: in an event row, *Repeat for -> each row of the table "Waves"* runs the row once per table row, with `{row.id}` and `{row.<column>}` holding that row's cells while it runs.

The project check reports duplicate rows and columns, a list column with no choices, a row-of-another-table cell that names a missing row, and sprites, prefabs and sounds that do not exist.

## Doing sums
A value typed into *Change a variable* or *A variable compares* may be arithmetic: `{gold} - {Units.knight.cost}`, `({a} + 2) * 3`, `min({hp}, 10)`. Allowed: numbers, `+ - * / %`, brackets, and `min max floor ceil round abs sqrt`. It cannot run anything else; a name that does not exist leaves the text as it was.

Names you can use: a flag or counter (`gold`), a table cell (`Units.knight.hp`), an object's field (`@Player.health.hp`: the first object called Player, its health behaviour, its hp), a custom behaviour's setting (`self.speed`), the current table row (`row.hp`).

## Custom components (`assets/components/<Name>.component.json`)
A component is a named set of typed settings an object carries (*Stats*: hp, team; *Crop*: days, ripe). **Data -> Components -> Create**, add fields (number, yes/no, text, one-of-a-list, colour, sprite, sound, prefab, a row of a table). Then in the Inspector choose it from the Add menu under *Custom components*; its fields appear as settings, are saved in prefabs and scenes, and event rows read them with `{@Name.Stats.hp}` or the *Set a property* action. A component name may not clash with one the engine uses.

## Custom behaviours (`assets/behaviors/<Name>.behavior.json`)
A behaviour is event rows with settings of their own that run for **every object that has it**. Inside, *This object* (and *the picked object*) is the object, and `{self.<setting>}` is that object's own setting, so ten objects with the same behaviour can each have a different speed or price. A behaviour can declare signals it receives and sends (so wires can connect to it) and sits in the Add menu under the group you name. Example, *Wander*: setting `idle` (number); row: *Every few seconds* -> *Teleport this object ...*.

## Custom events (`assets/events.json`)
Name the things that can happen in your game (`wave-cleared`). The *Emit* action and the *An event happened* condition offer these names.

## Packs
Everything above, plus prefabs, sprites and screens, can be bundled and shared; see [packs-and-plugins.md](packs-and-plugins.md).

## Tested by
`packages/runtime/src/data/data.test.ts` (tables, CSV, names, arithmetic), `packages/behaviors/src/custom.test.ts`, `e2e/p2-data.spec.ts`.
