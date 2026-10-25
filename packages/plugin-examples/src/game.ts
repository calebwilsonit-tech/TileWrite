import { z } from 'zod';
import { definePlugin, behaviorDef, type PluginDefinition, type SimContext, type Entity } from '@tilewright/plugin-sdk';

/** The manifest every example shares the shape of. A real plugin keeps this in its own plugin.json. */
export const manifestOf = (id: string, name: string, description: string) => ({ id: `example-${id}`, name, version: '1.0.0', description, author: 'Tilewright examples', license: 'MIT' });

// ---------- a behaviour ----------
export interface Spinner {
  /** Quarter turns a second. */
  speed: number;
}

/** A behaviour: something an object does on its own, with settings in the Inspector. This one turns its object round and round. */
export const spinnerBehavior = behaviorDef<Spinner>({
  id: 'exampleSpinner',
  name: 'Spinner',
  category: 'Examples',
  description: 'Turns the object round and round.',
  phase: 'actuator',
  defaults: { speed: 2 },
  fields: [{ key: 'speed', label: 'Quarter turns a second', type: 'number', min: 0, max: 8, step: 0.5 }],
  inputs: [],
  outputs: [],
  requires: {},
  summary: (s) => `Turns ${s.speed} quarter turns a second.`,
  update(ctx: SimContext, e: Entity, s: Spinner) {
    const t = e.get<{ facing: number }>('transform');
    if (t) t.facing = (Math.floor(ctx.tick * s.speed * (1 / 15)) + 8) % 8;
  },
});

export const behaviorExample: PluginDefinition = definePlugin(manifestOf('behavior', 'Example: a behaviour', 'Adds the Spinner behaviour to the Inspector.'), {
  install: (api) => api.behavior(spinnerBehavior),
});

// ---------- event-sheet blocks and events ----------
export const eventsExample: PluginDefinition = definePlugin(manifestOf('events', 'Example: event blocks', 'A condition, an action and an event for the event sheet.'), {
  install(api) {
    api.condition({
      id: 'exampleCounterAtLeast',
      label: 'The example counter is at least',
      category: 'Examples',
      params: [{ key: 'n', label: 'Number', type: 'number', default: 3, step: 1 }],
      describe: (p) => `the example counter is at least ${Number(p.n ?? 3)}`,
      test: (ctx, p) => Number(ctx.runtime.vars.exampleCounter ?? 0) >= Number(p.n ?? 3),
    });
    api.action({
      id: 'exampleCountUp',
      label: 'Add one to the example counter',
      category: 'Examples',
      params: [],
      describe: () => 'add one to the example counter',
      run(ctx) {
        ctx.runtime.vars.exampleCounter = Number(ctx.runtime.vars.exampleCounter ?? 0) + 1;
        ctx.events.emit('example-counted', { total: ctx.runtime.vars.exampleCounter });
      },
    });
    api.event({ id: 'example-counted', label: 'the example counter goes up', text: 'the example counter goes up' });
  },
});

// ---------- a system ----------
export const systemExample: PluginDefinition = definePlugin(manifestOf('system', 'Example: a system', 'Counts ticks in a variable.'), {
  install: (api) =>
    api.system('count-ticks', (ctx) => {
      ctx.runtime.vars.exampleTicks = ctx.tick;
    }),
});

// ---------- a button ----------
export const inputExample: PluginDefinition = definePlugin(manifestOf('input', 'Example: a button', 'A "Wave" button on F and the pad.'), {
  install: (api) => api.inputAction('example_wave', { label: 'Wave', bindings: ['key:KeyF', 'pad:button2'] }),
});

// ---------- a component ----------
export const componentExample: PluginDefinition = definePlugin(manifestOf('component', 'Example: a component', 'State an object can carry, with defaults.'), {
  install: (api) => api.component({ id: 'exampleScore', name: 'Score', description: 'Points an object has earned.', defaults: { points: 0, best: 0 } }),
});

// ---------- a collision layer ----------
export const layerExample: PluginDefinition = definePlugin(manifestOf('layer', 'Example: a collision layer', 'A layer for mist, bit 12 for ever.'), {
  install: (api) => api.collisionLayer({ name: 'example-mist', bit: 12, label: 'Mist' }),
});

// ---------- a physics modifier ----------
export const physicsExample: PluginDefinition = definePlugin(manifestOf('physics', 'Example: wind', 'A steady wind pushing every body east.'), {
  install: (api) =>
    api.physicsModifier({
      id: 'wind',
      apply(_ctx, _entity, body) {
        body.vx = (typeof body.vx === 'number' ? body.vx : 0) + 0.5;
      },
    }),
});

// ---------- a kind of block ----------
export const blockExample: PluginDefinition = definePlugin(manifestOf('block', 'Example: ice', 'A slippery block.'), {
  install: (api) => api.blockType({ id: 'example-ice', name: 'Ice', top: 0xbfe8ff, left: 0x8fc4e8, right: 0x6aa3cc, custom: { friction: 0.05 }, tags: ['slippery'] }),
});

// ---------- a group for plates and zones ----------
export const whoExample: PluginDefinition = definePlugin(manifestOf('who', 'Example: a group', 'Plates and zones can react to "Heroes".'), {
  install: (api) => api.whoFilter({ id: 'example-heroes', label: 'Heroes', match: (e) => e.tags.has('hero') }),
});

// ---------- when an object counts as defeated ----------
export const defeatExample: PluginDefinition = definePlugin(manifestOf('defeat', 'Example: defeat', 'An object with the tag "fragile" counts as defeated once it has the tag "broken".'), {
  install: (api) => api.defeatCheck({ id: 'example-fragile', defeated: (e) => e.tags.has('fragile') && e.tags.has('broken') }),
});

// ---------- a kind of data the project keeps ----------
const RecipeSchema = z.object({ name: z.string().min(1), makes: z.string().default('') });

/** A kind of data: a list of recipes kept in a file of the project. The engine loads it while this plugin is on, saves and checks it, collects its words for translation, and shows its editor as a tab of the Story panel. */
export const dataKindExample: PluginDefinition = definePlugin(manifestOf('data', 'Example: a kind of data', 'A list of recipes kept in assets/example-recipes.json: loaded, saved, checked, translated and edited by the engine.'), {
  install: (api) =>
    api.dataKind({
      id: 'example-recipes',
      label: 'Recipes',
      file: 'assets/example-recipes.json',
      listKey: 'recipes',
      noun: 'recipe',
      keyName: 'name',
      schema: RecipeSchema,
      keyOf: (r: z.infer<typeof RecipeSchema>) => r.name,
      create: (existing: readonly unknown[]) => ({ name: `Recipe ${existing.length + 1}`, makes: '' }),
      check: (records: readonly z.infer<typeof RecipeSchema>[]) => records.filter((r) => r.makes === '').map((r) => `The recipe "${r.name}" makes nothing yet.`),
      texts: (r: z.infer<typeof RecipeSchema>) => [{ text: r.name, where: `Recipe ${r.name}` }],
    }),
  // the tab that edits it (editor part only: it never goes into an exported game); a real one draws its fields with React, using props.ui
  installEditor: (api) => api.dataEditor({ kind: 'example-recipes', component: () => null }),
});

// ---------- keeping what the player carries ----------

/** The keeper of what the player carries (an inventory): conversations, cutscenes, skins and scripts ask it how many, and to give or take some. */
export const carrierExample: PluginDefinition = definePlugin(manifestOf('carrier', 'Example: pockets', 'Keeps what the player carries in the variables pocket:<name>, for conversations and cutscenes to give into.'), {
  install: (api) =>
    api.carrier({
      id: 'example-pockets',
      count: (vars, id) => (typeof vars[`pocket:${id}`] === 'number' ? (vars[`pocket:${id}`] as number) : 0),
      give(ctx, id, amount) {
        const had = typeof ctx.runtime.vars[`pocket:${id}`] === 'number' ? (ctx.runtime.vars[`pocket:${id}`] as number) : 0;
        const got = Math.max(-had, amount);
        ctx.runtime.vars[`pocket:${id}`] = had + got;
        return got;
      },
      variable: (id) => `pocket:${id}`,
    }),
});

// ---------- a layer over the world ----------
export const screenLayerExample: PluginDefinition = definePlugin(manifestOf('screen-layer', 'Example: screen layer', 'A layer drawn over the world that tints the picture while a counter named "chill" is above zero.'), {
  install: (api) => {
    api.system('chill', (ctx) => void (ctx.runtime.plugin['screen-layer'] = Number(ctx.runtime.vars.chill) > 0 ? { amount: Math.min(1, Number(ctx.runtime.vars.chill) / 10) } : undefined), 'gameplay', 'after-behaviors');
    // the layer is made when this plugin comes on, gets its data each frame, and hides when there is none
    api.screenLayer({ id: 'screen-layer', create: () => ({ objects: [], update: () => undefined, hide: () => undefined }) });
  },
});

// ---------- a method for scripts ----------
export const scriptExample: PluginDefinition = definePlugin(manifestOf('script', 'Example: a script method', 'Scripts can call game.exampleShout(text).'), {
  install: (api) => api.scriptMethod({ id: 'exampleShout', run: (ctx, _self, [text]) => void ctx.events.emit('message', { text: String(text).toUpperCase() }), fallback: undefined }),
});

// ---------- a way to unlock a place on the world map ----------
export const unlockExample: PluginDefinition = definePlugin(manifestOf('unlock', 'Example: a map rule', 'A place unlocks when the variable "gotKey" is set.'), {
  install: (api) => api.unlockRule({ id: 'example-key', label: 'once the player has the key', met: (vars) => vars.gotKey === true || Number(vars.gotKey) > 0 }),
});

// ---------- a bridge over pits ----------
export const bridgeExample: PluginDefinition = definePlugin(manifestOf('bridge', 'Example: planks', 'Objects tagged "plank" count as bridges over pits.'), {
  install: (api) =>
    api.bridgeSource({
      id: 'planks',
      possible: (entities) => {
        const out = new Set<string>();
        for (const e of entities) {
          const t = e.components.transform as { x: number; y: number } | undefined;
          if (t && e.components.plank !== undefined) out.add(`${Math.floor(t.x)},${Math.floor(t.y)}`);
        }
        return out;
      },
      movable: (e) => e.components.plank !== undefined,
    }),
});
