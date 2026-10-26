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

// ---------- rows for a list in a screen ----------
export const listSourceExample: PluginDefinition = definePlugin(manifestOf('list', 'Example: a list source', 'A list called "badges" that a screen can show: one row for every badge the player has earned.'), {
  install: (api) =>
    api.listSource({
      id: 'example-badges',
      label: 'Badges the player has earned',
      fields: { 'badge.name': 'The name of the badge' },
      rows: (sim) =>
        Object.keys(sim.runtime.vars)
          .filter((k) => k.startsWith('badge:') && sim.runtime.vars[k])
          .map((k) => ({ id: k.slice(6), scope: { 'badge.name': k.slice(6) } })),
    }),
});

// ---------- a row in another screen's menu ----------
export const menuEntryExample: PluginDefinition = definePlugin(manifestOf('menu', 'Example: a menu entry', 'Adds "Journal" to the Pause menu. It opens the screen that plays the "journal" role.'), {
  install(api) {
    api.screenRole({ id: 'journal', label: 'Journal', help: 'Opened from the Pause menu.' });
    api.menuEntry({ id: 'example-journal', menu: 'pause', label: 'Journal', opens: 'journal', order: 30, detail: (sim) => `${Object.keys(sim.runtime.vars).filter((k) => k.startsWith('note:')).length} notes` });
  },
});

// ---------- a kind of layer for the Map widget ----------
export const mapLayerExample: PluginDefinition = definePlugin(manifestOf('map-layer', 'Example: a map layer', 'A "Compass" layer for the Map widget: a north arrow in a corner, with a colour and size the designer sets.'), {
  install: (api) =>
    api.mapLayer({
      id: 'example-compass',
      label: 'Compass (a north arrow)',
      fields: [
        { key: 'colour', label: 'Colour', type: 'colour', default: '#f4efe6' },
        { key: 'size', label: 'Size (pixels)', type: 'number', default: 36 },
      ],
      draw({ ctx, settings, width, toView }) {
        const size = Number(settings.size ?? 36);
        // north is where "up the map" is in the world: a little step toward y = 0, as the map is turned now
        const from = toView(0, 1);
        const to = toView(0, 0);
        const a = Math.atan2(to.y - from.y, to.x - from.x);
        const cx = width - size;
        const cy = size;
        ctx.strokeStyle = String(settings.colour ?? '#f4efe6');
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * size * 0.5, cy + Math.sin(a) * size * 0.5);
        ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillText('N', cx + Math.cos(a) * size * 0.7 - 4, cy + Math.sin(a) * size * 0.7 + 4);
      },
    }),
});

// ---------- a place markers can come from ----------
export const markerSourceExample: PluginDefinition = definePlugin(manifestOf('marker-source', 'Example: a marker source', 'Markers for "the party": one for every object with the tag "ally", carrying its name and how hurt it is.'), {
  install: (api) =>
    api.markerSource({
      id: 'example-party',
      label: 'The party (objects tagged ally)',
      rows: (sim) =>
        sim.world.withTag('ally').flatMap((e) => {
          const t = e.get<{ x: number; y: number }>('transform');
          return t ? [{ id: `ally${e.id}`, x: t.x, y: t.y, scope: { 'marker.name': e.name, 'ally.hurt': e.get<{ hp?: number }>('state:health')?.hp ?? 0 } }] : [];
        }),
    }),
});

// ---------- a rule that reveals the fog of a map ----------
export const fogRuleExample: PluginDefinition = definePlugin(manifestOf('fog-rule', 'Example: a fog rule', 'Reveals a map around every object tagged "torch" (so lit places are known).'), {
  install: (api) =>
    api.fogRule({
      id: 'example-torches',
      label: 'Around lit torches',
      fields: [{ key: 'radius', label: 'Radius (cells)', type: 'number', default: 3 }],
      reveal(sim, settings, world, reveal) {
        const r = Number(settings.radius ?? 3);
        for (const e of sim.world.withTag('torch')) {
          const t = e.get<{ x: number; y: number }>('transform');
          if (!t) continue;
          for (let y = Math.floor(t.y - r); y <= Math.ceil(t.y + r); y++) for (let x = Math.floor(t.x - r); x <= Math.ceil(t.x + r); x++) if (x >= 0 && y >= 0 && x < world.w && y < world.h && (x - t.x) ** 2 + (y - t.y) ** 2 <= r * r) reveal(x, y);
        }
      },
    }),
});

// ---------- a piece the designer can use as a part of a control ----------
export const uiPartExample: PluginDefinition = definePlugin(manifestOf('ui-part', 'Example: a control part', 'A brass thumb for sliders, ready to pick in the designer’s list of parts.'), {
  install(api) {
    const thumb = newWidget('panel', 'brass-thumb', 'Brass thumb');
    Object.assign(thumb, { w: 22, h: 22, style: { fill: '#c9a227', border: '#6b4e0a', borderWidth: 3, radius: 60, shadow: true }, states: { pressed: { fill: '#ffe08a' }, focus: { border: '#ffffff' } } });
    api.uiPart({ name: 'Brass thumb', label: 'Brass thumb', suits: ['slider'], widget: thumb });
  },
});
