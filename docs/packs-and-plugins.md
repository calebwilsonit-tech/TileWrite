# Packs and the plugin API

A **pack** is a group of things a project can switch on: behaviours, event-sheet blocks, systems that run every tick, buttons, and additions to the editor. The engine's own optional parts and the reference game's mechanics are packs, and so is anything a programmer writes against the same plugin API. An empty project switches none on.

## Switching packs on and off
**Project settings -> Packs** (the **Project settings...** button at the bottom of the Inspector) lists every pack with a tick box, what it needs and the behaviours it adds. Turning one off hides its behaviours and blocks from the pickers and removes the buttons it added from the Controls tab; objects that still use a hidden behaviour do nothing, and the Problems panel says "this belongs to the Combat pack, which is switched off". A project made before packs existed has no list and plays with everything on until you change a box.

| Pack | Adds |
| --- | --- |
| **Combat** | Health, Damage on Touch, Melee Attack, Ranged Attack, Dodge, Projectile; the health condition; damage and heal actions; the attack and dodge buttons |
| **Inventory** | Pickup; has-item condition; give and take item actions; inventory and quick-slot buttons |
| **Story** | NPC Talk, Cutscene Trigger, Minigame Station; start-dialogue, play-cutscene, play-minigame actions; the map button |
| **AI** | Vision Cone, Chase, Patrol, Boss Phases, Behaviour Tree |
| **Lighting** | Light |
| **Turn-based play** | Turn Taker, Grid Mover, Unit AI; the *turn of*, *team turn* and *battle won* conditions; start battle, end turn, end battle, change action points, move a unit, attack actions; the end-turn button. See [time-and-turns.md](time-and-turns.md) |
| **Control schemes** | Click to Move, Hotspot, Grid Cursor, Commandable Unit, RTS Control, Camera Rig, Builder; the hotspot condition; order units, choose a building, set the verb, use a hotspot and turn-the-view actions; the camera-turn, building and RTS buttons. See [control-schemes.md](control-schemes.md) |
| **The Last Storytender** | Echo Recorder, Sentence Stone, Formattable Text Block, Lantern Post, Light Resource, Light Sensor, Growing Object, their event blocks, the echo button. Needs Lighting |

Everything not listed (gates, plates, levers, timers, logic gates, moving platforms, state machines, spawners, portals, the follow camera, sound sources) is core and always there.

## Writing a pack (programmers)
A pack is an object with an `install(api)` function. Everything it adds is recorded and removed again if the pack is turned off.

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
- A pack that throws while installing is left uninstalled and the editor says so.

The Storytender pack (`packages/behaviors/src/packs/storytender.ts`) is written exactly this way and is switched on in the finished sample.

## Tested by
`packages/behaviors/src/packs.test.ts` (install, remove, dependencies, a third-party pack through every part of the API), `e2e/p2-packs.spec.ts`.
