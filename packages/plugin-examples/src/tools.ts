import { definePlaybotMove, definePlaybotStrategy, definePlugin, type PluginDefinition } from '@tilewright/plugin-sdk';
import { manifestOf } from './game';

const editorPart = (id: string, name: string, description: string, installEditor: NonNullable<PluginDefinition['installEditor']>): PluginDefinition =>
  definePlugin(manifestOf(id, name, description), { install: () => undefined, installEditor });

// ---------- a playbot strategy: a button in the Playbot panel ----------
export const strategyExample = editorPart('strategy', 'Example: a playbot strategy', 'A button that makes the bot wait ten seconds.', (api) =>
  api.playbotStrategy(
    definePlaybotStrategy({
      id: 'example-wait',
      label: 'Wait ten seconds',
      help: 'The bot stands still, to see whether anything in the scene changes by itself.',
      play(bot) {
        bot.wait(10);
        return { ok: true, kind: 'reached', seconds: 10, message: 'Waited ten seconds.' };
      },
    }),
  ),
);

// ---------- a playbot move: a step the puzzle solver may combine with others ----------
export const moveExample = editorPart('move', 'Example: a playbot move', 'Lets the solver try waiting a moment before a plate.', (api) =>
  api.playbotMove(
    definePlaybotMove({
      id: 'example-pause',
      offer: (entity) => (entity.components.pressurePlate !== undefined ? [{ ref: `id:${entity.id}`, label: `wait, then stand on "${entity.name}"` }] : []),
      perform: (bot, _game, ref) => {
        bot.wait(1);
        return bot.standOn(ref, 0.8).ok;
      },
    }),
  ),
);

// ---------- things for the assistant ----------
export const assistantExample: PluginDefinition = definePlugin(manifestOf('assistant', 'Example: for the assistant', 'A note, a tool that counts objects, a reader for .txt files and a picture maker.'), {
  install(api) {
    api.assistantNote('The Example plugin adds a Spinner behaviour; use it on things that should turn.');
    api.assistantTool({
      id: 'example_count',
      description: 'Count the objects in the open scene.',
      input: { type: 'object', properties: {} },
      kind: 'read',
      run: () => 'The example plugin cannot see the scene from here.',
    });
    api.fileReader({ id: 'example-text', label: 'Plain text', extensions: ['.txt'], read: (_name, bytes) => ({ text: new TextDecoder().decode(bytes) }) });
    api.imageProvider({
      id: 'example-checker',
      label: 'A single grey pixel (no service needed)',
      needsKey: false,
      async generate() {
        // a real provider draws the picture or asks a service; an example only needs some PNG bytes
        return Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      },
    });
  },
});
