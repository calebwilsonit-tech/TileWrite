import { definePlugin, newWidget, type PluginDefinition, type UiScreen } from '@tilewright/plugin-sdk';
import { manifestOf } from './game';

// ---------- a kind of widget for the UI designer ----------
export const widgetExample: PluginDefinition = definePlugin(manifestOf('widget', 'Example: a widget', 'A "Clock" widget that shows how long the game has run.'), {
  install: (api) =>
    api.widget({
      id: 'example-clock',
      label: 'Clock (seconds the game has run)',
      defaults: { w: 120, h: 32, text: 'time' },
      render(el, node, values) {
        const seconds = Number(values['time.seconds'] ?? 0);
        el.textContent = `${node.text || 'time'} ${seconds.toFixed(0)}s`;
      },
    }),
});

// ---------- a screen, and what it can be used as ----------
const creditsScreen = (): UiScreen => {
  const root = newWidget('panel', 'credits-root', 'Credits');
  root.layout = 'column';
  return { id: 'example-credits', name: 'Credits', root, modal: true, back: 'close', backTo: '', priority: 0, dim: 0.6, transition: 'fade', mapX: 0, mapY: 0, opensOnStart: false };
};

export const screenExample: PluginDefinition = definePlugin(manifestOf('screen', 'Example: a screen', 'A Credits screen a project can copy and make its own, and a "Credits" role to use it as.'), {
  install(api) {
    api.screenRole({ id: 'credits', label: 'Credits', help: 'Opened from the title screen and the pause menu.' });
    api.screen({ id: 'credits', screen: creditsScreen(), role: 'credits', revision: 1 });
  },
});

// ---------- words a translator should see ----------
export const stringsExample: PluginDefinition = definePlugin(manifestOf('strings', 'Example: strings', 'Tells the translation tables about the words the plugin shows.'), {
  install: (api) => api.strings(() => ['Thank you for playing', 'Press F to wave']),
});

// ---------- the screens the game draws (the heads-up display, the menus) ----------
export const gameUiExample: PluginDefinition = definePlugin(manifestOf('game-ui', 'Example: the game screens', 'Draws a one-line heads-up display instead of the engine screens.'), {
  install: (api) =>
    api.provide('gameUi', (parent: HTMLElement) => {
      const line = parent.ownerDocument.createElement('div');
      line.textContent = 'Playing';
      parent.appendChild(line);
      return { menuOpen: false, setLayout: () => undefined, openStart: () => undefined, openTitle: () => undefined, tick: () => undefined, update: () => (line.textContent = 'Playing'), dispose: () => line.remove() };
    }),
});
