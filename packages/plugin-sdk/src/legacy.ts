/**
 * @deprecated The whole engine, as the plugin SDK used to export it. `@tilewright/plugin-sdk` is a deliberate, smaller list now; this entry
 * keeps every name it ever had reachable so a plugin written against the old SDK still builds. Nothing here is promised to stay as it is
 * (it is the engine's inside), and new plugins should not use it: if you need a name that is only here, say so, and it can be added to the
 * list.
 */
export * from '@tilewright/runtime';
export * from '@tilewright/behaviors';
// names both packages use: this entry takes the runtime's, except EventDef and newRow (the plugin extension shape and the event sheet's row)
export type { Checkpoint, LoadResult } from '@tilewright/runtime';
export { PACKAGE_NAME, newRow as newTableRow } from '@tilewright/runtime';
export type { EventDef } from '@tilewright/behaviors';
export { newRow } from '@tilewright/behaviors';
export { Bot, Game, PointerBot, formatTime } from '@tilewright/playbot';
export type { GameSetup, PlayReport, ReportKind, WalkOptions } from '@tilewright/playbot';
export * from './playbot';

// Names that used to be part of the engine itself and now live with the plugin that owns them (the plugin platform only grows, so they
// stay reachable here). Each of those modules imports only the SDK's list, so nothing here loops back.

// lighting: the model of lights and shadows and the questions asked of it (@tilewright/plugin-lighting/model)
export * from '@tilewright/plugin-lighting/model';

// items: what the player carries, the quick slots, the shape of an item (@tilewright/plugin-inventory/items)
export * from '@tilewright/plugin-inventory/items';

// minigames: the shape of a minigame and how one is played (@tilewright/plugin-story/minigames)
export * from '@tilewright/plugin-story/minigames';
