# Writing plugins

A **plugin** adds something to Tilewright: a kind of behaviour, new event blocks, a tool, a panel, a whole kind of game. Everything about one kind of game in Tilewright (combat, inventory, story, turns, the reference game's mechanics...) is a plugin written the way yours will be, with the same plugin SDK, so there is nothing the engine's own plugins can do that yours cannot.

- [Extension points](extension-points.md): everything a plugin can add, each with a small working example.
- The examples: `packages/plugin-examples/src` (one file group per area; each example is a complete plugin and is tested). Switch them on in **Project settings → Plugins → Examples** to see them in the editor.
- [Recipes](../recipes.md): building things with plugins in the editor.

## The plugins that ship with Tilewright

Each is written the way yours will be. Its guide lives in its own folder.

| Plugin | What it adds | Guides |
| --- | --- | --- |
| Combat and AI | Health, damage, melee and ranged attacks, guards that see and hear, bosses | [ai-and-combat.md](../../packages/plugins/combat/docs/ai-and-combat.md) |
| Story and Inventory | Conversations, cutscenes, minigames, the world map, items, quick slots | [story-systems.md](../../packages/plugins/story/docs/story-systems.md) |
| Turns | Turn-based play | [time-and-turns.md](../../packages/plugins/turns/docs/time-and-turns.md) |
| Simulation | Resources, production chains, day and night, waves, routes, villagers with needs, fire and growth | [simulation-helpers.md](../../packages/plugins/sim/docs/simulation-helpers.md) |
| The reference game (echoes, lanterns, words) | The mechanics of the sample game "The Last Storytender", and how that whole game was built and tested | [echoes-light-words.md](../../packages/plugins/storytender/docs/echoes-light-words.md), [reference_game.md](../../packages/plugins/storytender/docs/reference_game.md), [acceptance.md](../../packages/plugins/storytender/docs/acceptance.md) |

## Your first plugin

```
npm create tilewright-plugin my-plugin       # or: node packages/create-tilewright-plugin/bin.mjs my-plugin --sdk <path to packages/plugin-sdk>
cd my-plugin
npm install
npm run build        # plugin.cjs (the game part) and editor.cjs (the editor part)
npm test
```

To start from the example for one kind of thing a plugin can add (a widget, a screen layer, a kind of data, a check, a panel...) instead, add the starter's name: `npm create tilewright-plugin my-plugin -- --starter widget`; `--starters` lists all of them. Each is the tested example of the matching row of [extension-points.md](extension-points.md), with its own manifest, test and build.

In Tilewright open **Project settings → Plugins → Open a folder for development…** and choose the folder. The editor asks whether to allow it (see *Trust*), then uses the plugin where it is: `npm run dev` rebuilds when you save and the editor reloads the plugin at once. Switch it on in the project with its tick box.

A plugin is a folder:

| File | What it is |
| --- | --- |
| `plugin.json` | The manifest: id, name, version, description, author, the plugin platform versions it works with (`engine`), the plugins it needs (`dependencies`), what it asks to be allowed to do (`permissions`), and its files (`entry`). |
| the game part (`plugin.cjs`) | One CommonJS file. It runs in the editor and in the exported game. It may use the plugin SDK (`require('@tilewright/plugin-sdk')`) and nothing else: bundle the rest into the file. |
| the editor part (`editor.cjs`) | Optional. Panels, tools, importers and exporters. It never goes into an exported game, and runs in a sandbox (see *Isolation*). |
| `CHANGELOG.md` | Shown to the person when the plugin is updated. |

The game part exports the plugin: `module.exports.default = sdk.definePlugin(manifest, { install(api) { ... } })`. Everything `install` adds is remembered against the plugin, so turning the plugin off takes it all out again.

## The manifest

```json
{
  "id": "farming",
  "name": "Farming",
  "version": "1.2.0",
  "description": "Crops that grow.",
  "author": "A. Friend",
  "engine": "^1.0.0",
  "dependencies": { "inventory": "^1.0.0" },
  "permissions": ["project.read", "network:api.example.com"],
  "entry": { "runtime": "plugin.cjs", "editor": "editor.cjs" },
  "changelog": "CHANGELOG.md"
}
```

Versions are semver and ranges work as in npm (`^1.2.0`, `~1.2.3`, `>=1.0.0 <2.0.0`, `1.x`). A plugin whose `engine` range does not include the editor's plugin platform version (`ENGINE_VERSION`, 1.0.0) is refused with a sentence saying so. A plugin that needs another is turned on only with it.

## Trust

A plugin's game part is a program with the same access to the game as the engine. So the editor **never runs it until the person has looked at it and said yes**: Project settings → Plugins shows what it is, who made it, and the permissions it asks for, each with its own tick box. The yes is for exactly that code: a new version, or one changed byte, asks again. Only the editor's own plugins (those with `"builtin": true`, which a downloaded plugin cannot claim) run without asking.

## Permissions

Everything beyond adding things goes through the api, and the api checks the permission the person granted:

| Permission | Lets the plugin |
| --- | --- |
| `project.read` | read the open project's files and see its objects |
| `project.write` | change and make files in the project |
| `network` or `network:<host>` | make requests (`api.fetch`) to that host only |
| `clipboard` | read and write the clipboard |
| `programs` | run another program (the person is asked each time, with the command in front of them). Off by default and marked dangerous. |

A refused call throws a plain sentence naming the plugin and the permission it needs; the plugin is turned off and the editor says so.

## Isolation and crashes

- The **editor part** runs in a Web Worker with no page, no network and no access to the editor. It draws with a small stand-in for the page (a few kinds of elements, text, a few attributes and styles, click/input/change events) whose changes the editor draws for real, and calls the editor only through the permission-checked api. Panels, tools, importers and exporters work this way. (Prefabs, checks and inspectors are synchronous and so belong to the game part.)
- The **game part** runs in the game's own world, because it has to take part in every tick. It is wrapped: an error in a behaviour, a block or a system is recorded against the plugin (the Problems panel and the Console say which plugin) and does not take the editor or the game down. A plugin that crashes while an editor part runs is turned off at once.
- What the game part can and cannot reach. It runs in the editor's own window (it has to: behaviours run inside the simulation, every tick), so it is kept away from the editor's door to the computer in three ways. (1) The door (files, the assistant's keys, the hub, plugin downloads, other programs) is handed over once, at startup, to the editor's own code, before any plugin runs; `window.tilewright` holds nothing after that, and neither do the editor's test handles (`window.__store` and the like exist only in the editor's own tests). (2) When a plugin runs a program, the main process works out which plugin asks from what is on the computer (its manifest and what you allowed it) and names that plugin in the question; a plugin that was not allowed to run programs never gets as far as the question. (3) A plugin is tried out in a worker with a pretend SDK before it is started; code that never returns (a loop at the top of the file or in `install`) is refused after four seconds with a plain message instead of freezing the editor, and a plugin that keeps the game waiting for more than a quarter of a second in one call, three times, is turned off. An editor part that stops answering is stopped the same way.
- What it still can do. A game part that runs in the editor's window is JavaScript in that window, so it can still reach the page itself (the DOM and what React keeps there) by determined means. Isolating it fully would mean running the simulation across a boundary; it is not done. This is why a plugin's code must be approved by you, exact byte for exact byte, before it runs, and why only plugins you trust should be approved. The end-to-end test `e2e/p4-hostile-plugin.spec.ts` runs a plugin that tries every route to the door it can think of and checks it finds none.

## Updating, going back, missing plugins

Installed plugins live in a store with a folder per id and version. **Plugins → What changed** shows the changelog; **Go back to 1.0.0** keeps an older version in use (until you choose the newest again); **Remove** takes a version or the whole plugin away. A project that lists a plugin which is not installed keeps what that plugin added in its scenes, shows "needs plugin X" in the Plugins tab and at export, and starts working again once the plugin is installed. An exported game carries the game part of the plugins it uses (`plugins.json`) with the permissions its author allowed.

## Testing

`@tilewright/plugin-sdk/testing` gives you the same helpers the engine's own tests use:

```ts
import { flatScene, player, rig, thing, usePlugin } from '@tilewright/plugin-sdk/testing';
import plugin from '../src/index';

const t = usePlugin(plugin);                 // the plugin is on; t.contents() says what it added
const { scene } = flatScene();
scene.entities.push(player('p', 3.5, 3.5), thing('s', 'Spinner', 8.5, 8.5, { mySpinner: { speed: 2 } }));
const game = rig(scene);                     // a small game with the plugin on
game.run(60);                                // 60 ticks
t.off();
```

`pluginFromFiles({ 'plugin.json': ..., 'plugin.cjs': ... })` loads a plugin the way the editor loads one from a folder.

## Stability

The plugin SDK is versioned (`ENGINE_VERSION`). Within a major version names are only ever added: `compat/baselines/sdk-api.json` lists every name the SDK has had (exports, api methods, extension tables) and a test fails if one disappears. A thing that is replaced stays under its old name. The scripting API has its own version (`SCRIPT_API_VERSION`) with the same rule.

## Plugins that came with Tilewright

`packages/plugins/<id>`: combat, inventory, story, ai, lighting, storytender (the reference game), turns, controls, sim and the prebuilt screens. They are written against the same SDK; read them for larger examples. The core never imports them (`packages/bundled-plugins/src/neutral.test.ts` checks it, and checks that the core mentions none of the reference game's words).
