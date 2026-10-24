# Add a row to the pause menu, and a screen it opens

The Pause screen has a list called *menu:pause*. Every plugin can add rows to it with `api.menuEntry`, and the row opens the screen that plays a part.

```ts
import { definePlugin, screenKit } from '@tilewright/plugin-sdk';

const { menuScreen, repeat, row, resetIds } = screenKit;

export default definePlugin(manifest, {
  install(api) {
    // 1. a part for the new screen to play
    api.screenRole({ id: 'journal', label: 'Journal', help: 'Opened from the Pause menu.' });

    // 2. the screen: a list of the player's notes (see "a list from your game")
    resetIds();
    const note = row('note', 'Note', '{note.title}', '', []);
    api.screen({
      id: 'journal',
      role: 'journal',
      revision: 1,
      screen: menuScreen({ id: 'journal', name: 'Journal', role: 'journal', rows: [repeat('notes', 'Notes', 'notes', note, { empty: 'Nothing written yet.' })] }),
    });

    // 3. the row in the Pause menu
    api.menuEntry({
      id: 'journal', menu: 'pause', label: 'Journal', opens: 'journal', order: 30,
      detail: (sim) => `${Object.keys(sim.runtime.vars).filter((k) => k.startsWith('note:')).length} notes`,
      show: () => true,
    });
  },
});
```

- `order` puts the row among the others (smaller is higher; the world map is 10, travel 20).
- `show` hides it while it makes no sense.
- The row opens `role:journal`, so a project that makes its own Journal screen gets its own, and one that does nothing gets yours.
- The example `packages/plugin-examples/src/ui.ts` (menu) is this, tested.
