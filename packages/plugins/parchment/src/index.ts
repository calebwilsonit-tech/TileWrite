import { definePlugin, type PluginDefinition, type UiScreen } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };
import { parchmentLook, parchmentScreen } from './look';
import { PARCHMENT } from './palette';
import { kitScreens, kitWords } from './screens';
import { chaptersSource, equipmentSource, statsSource, waypointsSource } from './sources';
import { dollWidget, flourishWidget, mapWidget, regionWidget, slipsWidget } from './widgets';

export { PARCHMENT, parchmentLook, parchmentScreen, flourishWidget };
export * from './screens';
export * from './sources';
export * from './widgets';

/** The roles of the engine's own screens the kit re-skins (the rest it builds itself, see screens.ts). */
const RESKINNED = ['save', 'load', 'settings', 'controls'] as const;

/**
 * The Parchment UI kit: a plugin that gives the game an old-paper look, and brings screens a game of that kind wants, each built
 * with the general tools of the UI designer and nothing else: a binder inventory (an open book with a paper doll and a satchel), a
 * parchment map with a chapter list and waypoints, a pause menu with Travel and Restart pages, a title whose New game asks for a
 * difficulty that is then locked for the save, and a heads-up display. Save, Load, Settings and Controls are the engine's own screens
 * with the paper look. The recipes in docs/recipes/ say how each page is put together.
 */
export const parchmentPlugin: PluginDefinition = definePlugin(manifest, {
  install(api) {
    for (const w of [flourishWidget, dollWidget, mapWidget, regionWidget, slipsWidget]) api.widget(w);
    for (const s of [waypointsSource, equipmentSource, statsSource, chaptersSource]) api.listSource(s);
    api.strings(kitWords);
    // the screens the kit builds: they play the roles they say, ahead of the engine's own
    for (const { screen, role } of kitScreens()) {
      if (role) api.screen({ id: screen.id, screen, role, revision: 1, priority: 10 });
      else api.screen({ id: screen.id, screen, revision: 1, priority: 10 });
    }
    // the engine's own screens it only re-skins
    const base = api.use<() => UiScreen[]>('prebuilt-screens', 'screens');
    for (const screen of base?.() ?? []) {
      if (!(RESKINNED as readonly string[]).includes(screen.role ?? '')) continue;
      api.screen({ id: `parchment-${screen.role}`, screen: parchmentScreen(screen), role: screen.role, revision: 1, priority: 10 });
    }
  },
});
