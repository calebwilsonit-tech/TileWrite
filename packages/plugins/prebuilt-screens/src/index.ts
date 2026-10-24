import { definePlugin, type GameUiHost } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };
import { GameUi, uiStrings } from './game-ui';

export * from './game-ui';
export * from './minigame-ui';

/** The screens and heads-up display of a game, as one plugin. Games that draw everything with the UI designer do not turn it on. */
export const prebuiltScreensPlugin = definePlugin(manifest, {
  install(api) {
    api.provide('gameUi', (parent: HTMLElement, host: GameUiHost) => new GameUi(parent, host));
    api.strings(uiStrings);
  },
});
