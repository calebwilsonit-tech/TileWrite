# Switching plugins on, and the older plugin API

> The plugin platform (manifests, permissions, trust, the sandbox, `npm create tilewright-plugin`, a reference for every extension point) is described in [plugins/README.md](plugins/README.md). This page is about switching plugins on in a project, and about the older, smaller way of writing one. The older word for a plugin was "pack": project files made before format 2 call the list `packs`, and are read as `plugins` when opened. (A file of art, tiles and screens that you share is an *asset pack*: see [asset-library.md](asset-library.md).)

A **plugin** is a group of things a project can switch on: behaviours, event-sheet blocks, systems that run every tick, buttons, screens, and additions to the editor. The engine's own optional parts and the reference game's mechanics are plugins, and so is anything a programmer writes against the same plugin API. An empty project switches none on.

## Switching plugins on and off
**Project settings -> Plugins** (the **Project settings...** button at the bottom of the Inspector) lists every plugin with a tick box, what it needs and the behaviours it adds. Turning one off hides its behaviours and blocks from the pickers and removes the buttons it added from the Controls tab; objects that still use a hidden behaviour do nothing, and the Problems panel says "this belongs to the Combat plugin, which is switched off". A project made before plugins could be chosen has no list and plays with the action-adventure plugins (Combat, Inventory, Story, AI, Lighting and The Last Storytender); Turn-based play, Control schemes and Simulation helpers are new and stay off until you tick them.

| Plugin | Adds |
| --- | --- |
| **Combat** | Health, Damage on Touch, Melee Attack, Ranged Attack, Dodge, Projectile; the health condition; damage and heal actions; the attack and dodge buttons |
| **Inventory** | Pickup; has-item condition; give and take item actions; inventory and quick-slot buttons |
| **Story** | NPC Talk, Cutscene Trigger, Minigame Station; start-dialogue, play-cutscene, play-minigame actions; the map button |
| **AI** | Vision Cone, Chase, Patrol, Boss Phases, Behaviour Tree |
| **Lighting** | Light |
| **Turn-based play** | Turn Taker, Grid Mover, Unit AI; the *turn of*, *team turn* and *battle won* conditions; start battle, end turn, end battle, change action points, move a unit, attack actions; the end-turn button. See [time-and-turns.md](../packages/plugins/turns/docs/time-and-turns.md) |
| **Control schemes** | Click to Move, Hotspot, Grid Cursor, Commandable Unit, RTS Control, Camera Rig, Builder; the hotspot condition; order units, choose a building, set the verb, use a hotspot and turn-the-view actions; the camera-turn, building and RTS buttons. See [control-schemes.md](control-schemes.md) |
| **Simulation helpers** | Producer, Calendar, Wave Spawner, Path Follower, Utility Agent, Automaton; the can-afford, time-is and wave-is conditions; pay, receive and next-wave actions. See [simulation-helpers.md](../packages/plugins/sim/docs/simulation-helpers.md) |
| **The Last Storytender** | Echo Recorder, Sentence Stone, Formattable Text Block, Lantern Post, Light Resource, Light Sensor, Growing Object, their event blocks, the echo button. Needs Lighting |

Everything not listed (gates, plates, levers, timers, logic gates, moving platforms, state machines, spawners, portals, the follow camera, sound sources) is core and always there.

## The older way to write one (programmers)
> New plugins are written with `definePlugin`, a manifest and the SDK: see [plugins/README.md](plugins/README.md). What follows is the plain-object form (`Pack`, `registerPack`, `installPack`), which is deprecated but keeps working, because plugins written against it must keep loading.

A plugin written this way is an object with an `install(api)` function. Everything it adds is recorded and removed again if it is turned off.

```ts
import { behaviorDef, registerPack, installPack, type Pack } from '@tilewright/behaviors';

const farming: Pack = {
  id: 'farming', name: 'Farming', version: '1.0.0', description: 'Crops that grow.',
  install(api) {
    api.behavior(behaviorDef({ id: 'crop', name: 'Crop', category: 'Farming', description: 'Grows over time.',
      phase: 'actuator', defaults: { days: 3 }, fields: [{ key: 'days', label: 'Days to grow', type: 'number' }],
      inputs: [], outputs: [], requires: {}, update(ctx, entity, settings) { /* ... */ } }));
    api.condition({ id: 'isRipe', label: 'A crop is ripe', category: 'Farming', params: [], describe: () => 'a crop is ripe', test: () => true });
    api.action({ id: 'harvest', label: 'Harvest', category: 'Farming', params: [], describe: () => 'harvest', run: () => {} });
    api.system('grow', (ctx) => { /* runs once per tick */ });
    api.inputAction('harvest', { label: 'Harvest', bindings: ['key:KeyF', 'pad:button2'] });
    api.panel({ id: 'crop-list', title: 'Crops', mount(el, host) { el.textContent = 'hello'; } });
    api.tool({ id: 'plant', label: 'Plant', onCell(cell, host) { /* ... */ } });
    api.importer({ id: 'tmx', label: 'Tiled maps', extensions: ['.tmx'], import: (name, bytes, host) => 'made a scene' });
  },
};
registerPack(farming);
installPack('farming');
```
- `api.behavior` adds a behaviour; it appears in the Inspector's Add menu like a built-in one (settings from `fields`, signals from `inputs`/`outputs`).
- `api.condition` / `api.action` add event-sheet blocks with plain-English `describe`.
- `api.system` runs a function once per tick (mode `gameplay` by default: skipped while a conversation or menu is open).
- `api.inputAction` adds a button with its starting keys, shown in Project settings -> Controls and in the game's Controls screen.
- `api.panel`, `api.tool`, `api.importer` add to the editor; they are plain DOM and callbacks, so a plugin needs no UI framework. The editor passes an `EditorHost` (notify, the open project, scene objects, project file read and write).
- A plugin that throws while installing is left uninstalled and the editor says so.

The Storytender plugin (`packages/plugins/storytender`) is written with the same API and is switched on in the finished sample.

## Tested by
`packages/bundled-plugins/src/suite/packs.test.ts` (install, remove, dependencies, a third-party plugin through every part of the API), `e2e/p2-packs.spec.ts`.
