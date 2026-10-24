import { definePlugin, type GameUiHost } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };
import { GameUi, uiStrings } from './game-ui';
import { ROLES, prebuiltScreens } from './screens';
import { worldMapWidget } from './world-map';
import { hudScreen } from './hud';

export * from './screens';
export * from './world-map';
export * from './hud';

export * from './game-ui';
export * from './minigame-ui';

/** The screens and heads-up display of a game, as one plugin. Games that draw everything with the UI designer do not turn it on. */
export const prebuiltScreensPlugin = definePlugin(manifest, {
  install(api) {
    api.provide('gameUi', (parent: HTMLElement, host: GameUiHost) => new GameUi(parent, host));
    api.strings(uiStrings);
    // what a plugin that re-skins the game's screens starts from
    api.provide('screens', () => prebuiltScreens().map((s) => s.screen));
    for (const r of ROLES) api.screenRole(r);
    for (const s of prebuiltScreens()) api.screen(s);
    // the heads-up display follows the project's interface layout (Story, Interface)
    api.screen({ id: 'prebuilt-hud', screen: hudScreen(null), role: 'hud', revision: 1, build: ({ layout }) => hudScreen(layout) });
    api.widget(worldMapWidget);
    // the world map is a row in the Pause menu when the project has one
    api.menuEntry({ id: 'map', menu: 'pause', label: 'Map', opens: 'map', order: 10, show: (sim) => (sim.assets.worldMap?.nodes.length ?? 0) > 0 });
  },
});
