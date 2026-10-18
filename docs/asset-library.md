# Your asset library and asset packs

The **Library** panel (bottom dock, next to Structures) is a personal collection that lives outside any project, in a folder next to Tilewright's settings. Every project on this computer can use it. (To keep it somewhere else, for example a synced folder, set the `TILEWRIGHT_LIBRARY` environment variable to that folder before starting Tilewright.)

## What you can keep
Tiles, tilesets (with their edge variants and autotile rules), tall props, wall and floor attachments, characters, animations, interface pieces (the prefabs made in the UI designer), structures, behaviours (with the custom components and data tables they use) and sounds.

Everything an item needs comes with it. A tile brings its pictures; a tileset brings its variants and rules; a structure brings the tiles its blocks use and the pictures of the objects inside; an attachment brings its other side; a behaviour brings the components and tables it names.

## Saving to the library
In the **Library** panel, under *Save to the library*: choose *What* (the kind), tick the things to keep, give it a name, tags, a licence and an author, and press **Save to the library**. Choose *Save as -> A new version of ...* to add a version to an item you already have.

Every save keeps the old version. In the item's details, **Versions** lists them all; **Use this one** makes an older one the version projects get. Newer ones stay in the list.

## Finding things
Search by name, tag, kind, author or notes; filter by kind or tag; click a folder to see what is in it. Type a name in *New folder* and press Enter to make a folder; the item's details move it into one. Thumbnails show the first picture.

## Adding to a project
Press **Add to project** on an item. The window lists what it brings in and what already exists in the project under the same name, then asks two things:

- **How:** *Link* keeps the project following the library, so **Update linked items** brings in a newer version later. *Copy* makes the pieces yours from then on.
- **What to do about names that already exist:** *Keep both* (the new ones get a number, and tiles, structures and rules that depend on them follow the new names), *Replace* (the project's pieces take the library's; placed tiles follow), or *Skip*.

Tile numbers never collide: a pack's tile numbers are changed to free ones, and structures made of those tiles are rewritten to match. If the pack was drawn for a different tile size, the window says it will not line up until the project's tile size matches.

What a project took from the library is written in `assets/library-links.json`.

## Asset packs (.twpack files)
A pack is one file holding the items and what they need. **Save as a pack file** in an item's details writes it anywhere; **Import a pack file** reads one into your library. Packs can be shared by any means: a chat, a shared folder, the community hub. The file lists its licence and author, and importing refuses a pack that points outside the project's assets folder or is damaged, with a plain message.

### Packs with code
A pack with scripts or plugins is marked **has code**. It is never installed silently: the add window shows a warning and you must tick *I have looked at it and I trust it* first.

## Recipes
**Keep a tile set for the next game.** Tile studio -> make the set -> Library -> *What: Tileset* -> tick *grass* -> name it "Meadow" -> tags `grass, outdoors` -> Save. In a new project: Library -> *Add to project* -> *Link*.

**Fix the tree in every game at once.** Redraw the tree, Library -> *Save as: A new version of "Oak"*. In each project press **Update linked items**.

**Share a house.** Save the structure to the library, open its details, **Save as a pack file...**, and send the `.twpack`.

Tested by `packages/editor/src/renderer/library/*.test.ts` and `e2e/p2-library.spec.ts`.
