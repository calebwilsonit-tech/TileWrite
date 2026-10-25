import fs from 'node:fs';
import path from 'node:path';
import startersFile from './starters.generated.json' with { type: 'json' };

/** One of the examples as a plugin of its own (see scripts/make-starters.mjs, which makes starters.generated.json from packages/plugin-examples). */
export interface Starter {
  /** What to say after --starter. */
  id: string;
  /** The extension point (or points) the plugin API names it by. */
  point: string;
  title: string;
  description: string;
  /** Packages the source needs besides the plugin SDK, with versions. */
  deps: Record<string, string>;
  /** The plugin's src/index.ts. */
  source: string;
}

export const STARTERS = startersFile as Starter[];

export interface ScaffoldOptions {
  /** Where the plugin SDK is (a folder or a version), for the new plugin's package.json. */
  sdk?: string | undefined;
  description?: string;
  /** Start from the plugin that shows one extension point (see `STARTERS`) instead of the general one. */
  starter?: string | undefined;
}


export function starterNamed(id: string): Starter {
  const s = STARTERS.find((x) => x.id === id || x.point === id);
  if (!s) throw new Error(`There is no starter called "${id}". The starters are: ${STARTERS.map((x) => x.id).join(', ')}.`);
  return s;
}

const idOf = (name: string): string =>
  path
    .basename(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, 'plugin-$1') || 'my-plugin';

const titleOf = (id: string): string => id.replace(/(^|-)([a-z])/g, (_m, sep: string, c: string) => `${sep ? ' ' : ''}${c.toUpperCase()}`);
const camelOf = (id: string): string => id.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/** The files of a new plugin: a game part with a behaviour and an event block, an editor part with a panel, a test, and the build. */
export function templateFiles(id: string, opts: ScaffoldOptions = {}): Record<string, string> {
  const starter = opts.starter ? starterNamed(opts.starter) : null;
  const title = titleOf(id);
  const behavior = `${camelOf(id)}Pulse`;
  const manifest = {
    id,
    name: title,
    version: '0.1.0',
    description: opts.description ?? (starter ? `${title}: ${starter.description}` : `${title}: a plugin for Tilewright.`),
    author: '',
    license: 'MIT',
    engine: '^1.0.0',
    dependencies: {},
    permissions: [],
    entry: starter ? { runtime: 'plugin.cjs' } : { runtime: 'plugin.cjs', editor: 'editor.cjs' },
    changelog: 'CHANGELOG.md',
  };
  const files: Record<string, string> = {
    'plugin.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'package.json': `${JSON.stringify(
      {
        name: id,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: { build: 'node build.mjs', dev: 'node build.mjs --watch', test: 'vitest run', pack: 'node build.mjs --pack' },
        dependencies: { '@tilewright/plugin-sdk': opts.sdk ? (/^[.\\/]|^[A-Za-z]:/.test(opts.sdk) ? `file:${opts.sdk}` : opts.sdk) : '*', ...(starter?.deps ?? {}) },
        devDependencies: { esbuild: '^0.28.0', typescript: '^6.0.0', vitest: '^5.0.0' },
      },
      null,
      2,
    )}\n`,
    'tsconfig.json': `${JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: true, lib: ['ES2022', 'DOM'] }, include: ['src', 'tests'] }, null, 2)}\n`,
    'src/index.ts': `import { behaviorDef, definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };

/** A behaviour: something an object does on its own. This one makes its object turn, and says so in a variable. */
export const ${behavior} = behaviorDef<{ speed: number }>({
  id: '${behavior}',
  name: 'Pulse',
  category: '${title}',
  description: 'Turns the object a little every tick.',
  phase: 'actuator',
  defaults: { speed: 1 },
  fields: [{ key: 'speed', label: 'How fast it turns', type: 'number', min: 0, max: 8, step: 0.5 }],
  inputs: [],
  outputs: [],
  requires: {},
  update(ctx, entity, settings) {
    const t = entity.get<{ facing: number }>('transform');
    if (t) t.facing = (t.facing + Math.round(settings.speed)) % 8;
    ctx.runtime.vars.${camelOf(id)}Ticks = ctx.tick;
  },
});

export default definePlugin(manifest, {
  install(api) {
    api.behavior(${behavior});
    api.condition({
      id: '${camelOf(id)}Started',
      label: '${title} has started',
      category: '${title}',
      params: [],
      describe: () => '${title} has started',
      test: (ctx) => Number(ctx.runtime.vars.${camelOf(id)}Ticks ?? 0) > 0,
    });
  },
});
`,
    'src/editor.ts': `// The editor part runs in a sandbox: it draws a panel with plain elements, and asks the editor for things only as far as plugin.json allows.
declare const Tilewright: { editor: { panel(def: { id: string; title: string; mount(el: any, host: any): void }): void } };

Tilewright.editor.panel({
  id: 'hello',
  title: '${title}',
  mount(el, host) {
    const text = document.createElement('p');
    text.textContent = 'Hello from ${title}.';
    const button = document.createElement('button');
    button.textContent = 'Count the objects';
    button.addEventListener('click', () => {
      void host.entities().then((list: unknown[]) => (text.textContent = \`\${list.length} objects in the scene\`));
    });
    el.appendChild(text);
    el.appendChild(button);
  },
});
`,
    'tests/plugin.test.ts': `import { describe, expect, it } from 'vitest';
import { flatScene, player, rig, thing, usePlugin } from '@tilewright/plugin-sdk/testing';
import plugin, { ${behavior} } from '../src/index';

describe('${title}', () => {
  it('adds its behaviour and its event block', () => {
    const t = usePlugin(plugin);
    expect(t.contents().behaviors).toEqual(['${behavior}']);
    expect(t.contents().conditions).toEqual(['${camelOf(id)}Started']);
    t.off();
  });

  it('makes an object turn when a game runs', () => {
    const t = usePlugin(plugin);
    const { scene } = flatScene();
    scene.entities.push(player('p', 3.5, 3.5), thing('s', 'Spinner', 8.5, 8.5, { ${behavior}: { speed: 1 } }));
    const game = rig(scene);
    const before = (game.get('s').get('transform') as { facing: number }).facing;
    game.run(5);
    expect((game.get('s').get('transform') as { facing: number }).facing).not.toBe(before);
    expect(${behavior}.id).toBe('${behavior}');
    t.off();
  });
});
`,
    'build.mjs': `// Builds plugin.cjs (the game part) and editor.cjs (the editor part). \`node build.mjs --watch\` rebuilds when you save;
// \`node build.mjs --pack\` also makes ${id}.bundle.json, one file you can install from an address.
import { build, context } from 'esbuild';
import fs from 'node:fs';

const watch = process.argv.includes('--watch');
const pack = process.argv.includes('--pack');
// the game part may only use the plugin SDK, which the editor gives it: leave it out of the file
const game = { entryPoints: ['src/index.ts'], outfile: 'plugin.cjs', bundle: true, format: 'cjs', platform: 'neutral', target: 'es2022', external: ['@tilewright/plugin-sdk'], logLevel: 'info' };
const hasEditor = fs.existsSync('src/editor.ts');
const editor = { entryPoints: ['src/editor.ts'], outfile: 'editor.cjs', bundle: true, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'info' };

if (watch) {
  for (const o of hasEditor ? [game, editor] : [game]) await (await context(o)).watch();
} else {
  await build(game);
  if (hasEditor) await build(editor);
  if (pack) {
    const files = {};
    for (const f of ['plugin.json', 'plugin.cjs', 'editor.cjs', 'CHANGELOG.md']) if (fs.existsSync(f)) files[f] = fs.readFileSync(f, 'utf8');
    fs.writeFileSync('${id}.bundle.json', JSON.stringify({ files }));
    console.log('Made ${id}.bundle.json');
  }
}
`,
    'CHANGELOG.md': `# Changes

## 0.1.0
- The first version.
`,
    'README.md': `# ${title}

A plugin for Tilewright.

- \`npm install\`, then \`npm run build\` makes \`plugin.cjs\` (the game part) and \`editor.cjs\` (the editor part).
- \`npm test\` runs the tests in \`tests/\` against the plugin SDK's test helpers.
- In Tilewright: Project settings, Plugins, **Open a folder for development**, and choose this folder. \`npm run dev\` rebuilds when you save, and the editor picks the change up.
- \`npm run pack\` makes one file (\`${id}.bundle.json\`) people can install from an address.

\`plugin.json\` says what the plugin is and what it may do (\`permissions\`). The game part can use the plugin SDK and nothing else; the editor part runs in a sandbox.
See docs/plugins in the Tilewright repository for every kind of thing a plugin can add.
`,
    '.gitignore': 'node_modules\nplugin.cjs\neditor.cjs\n*.bundle.json\n',
  };
  if (!starter) return files;
  // a starter is one of the examples (the plugin that shows what one extension point does), as the game part, with a test that loads it
  delete files['src/editor.ts'];
  files['src/index.ts'] = starter.source;
  files['tests/plugin.test.ts'] = `import { describe, expect, it } from 'vitest';
import { usePlugin } from '@tilewright/plugin-sdk/testing';
import plugin from '../src/index';

describe('${title}', () => {
  it('turns on and off without leaving anything behind', () => {
    const t = usePlugin(plugin);
    expect(t.contents()).not.toBeNull();
    t.off();
  });
});
`;
  files['README.md'] = `# ${title}

A plugin for Tilewright, started from the example for \`${starter.point}\`: ${starter.description}

- \`src/index.ts\` is the whole plugin. Change it, and read the matching part of docs/plugins/extension-points.md in the Tilewright repository.
- \`npm install\`, then \`npm run build\` makes \`plugin.cjs\`; \`npm test\` runs the test in \`tests/\`.
- In Tilewright: Project settings, Plugins, **Open a folder for development**, and choose this folder. \`npm run dev\` rebuilds when you save.
`;
  return files;
}

/** Make the folder. Refuses to write over a folder that already has things in it. */
export function scaffold(dir: string, opts: ScaffoldOptions = {}): { dir: string; id: string; files: string[] } {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) throw new Error(`"${dir}" is not empty, so nothing was made. Choose a new folder.`);
  const id = idOf(dir);
  const files = templateFiles(id, opts);
  for (const [name, text] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
  }
  return { dir, id, files: Object.keys(files) };
}
