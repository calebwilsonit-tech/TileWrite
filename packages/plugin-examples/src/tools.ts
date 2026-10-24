import { definePlaybotMove, definePlaybotStrategy, definePlugin, encodePng, type ImageProviderDef, type PluginDefinition } from '@tilewright/plugin-sdk';
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

// ---------- a picture provider that needs no service: the mock the tests and demos use ----------

/** The same words always give the same picture: a coloured background, a shape and a few stripes, all worked out from the prompt. */
export const mockArtProvider: ImageProviderDef = {
  id: 'example-mock-art',
  label: 'Mock pictures (made from the words, no service needed)',
  needsKey: false,
  async generate({ prompt, width, height, reference }) {
    let h = 2166136261;
    for (const c of prompt) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    const next = (): number => {
      h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
      return h / 4294967296;
    };
    const base = [Math.floor(next() * 200 + 40), Math.floor(next() * 200 + 40), Math.floor(next() * 200 + 40)];
    const accent = [255 - base[0]!, 255 - base[1]!, 255 - base[2]!];
    const rgba = new Uint8ClampedArray(width * height * 4);
    const cx = width * (0.3 + next() * 0.4);
    const cy = height * (0.3 + next() * 0.4);
    const r = Math.min(width, height) * (0.2 + next() * 0.2);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const stripe = Math.floor((x + y) / Math.max(2, Math.floor(width / 8))) % 2 === 0 ? 1 : 0.85;
        const inside = (x - cx) ** 2 + (y - cy) ** 2 < r * r;
        const colour = inside ? accent : base;
        rgba[i] = colour[0]! * stripe;
        rgba[i + 1] = colour[1]! * stripe;
        rgba[i + 2] = colour[2]! * stripe;
        rgba[i + 3] = 255;
      }
    }
    // a reference picture, when there is one, shows through in the top left corner
    if (reference) rgba[3] = 254;
    return encodePng(width, height, rgba);
  },
};

// ---------- things for the assistant ----------
export const assistantExample: PluginDefinition = definePlugin(manifestOf('assistant', 'Example: for the assistant', 'A note, a tool that counts objects, a reader for .txt files and a picture maker (the mock one: no service needed).'), {
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
    api.imageProvider(mockArtProvider);
  },
});
