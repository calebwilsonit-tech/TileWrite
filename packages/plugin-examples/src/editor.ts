import { TileMap, baseProject, definePlugin, playerEntity, sceneFrom, thing, type PluginDefinition, type ProblemDef } from '@tilewright/plugin-sdk';
import { manifestOf } from './game';

/** These need the editor, so they are the plugin's editor part (installEditor): they are never part of an exported game. */
const editorPart = (id: string, name: string, description: string, installEditor: NonNullable<PluginDefinition['installEditor']>): PluginDefinition =>
  definePlugin(manifestOf(id, name, description), { install: () => undefined, installEditor });

// ---------- a panel ----------
export const panelExample = editorPart('panel', 'Example: a panel', 'A panel that counts the objects in the open scene.', (api) =>
  api.panel({
    id: 'example-object-count',
    title: 'Object count',
    mount(el, host) {
      const show = (): void => {
        el.textContent = `${host.entities().length} objects in the scene`;
      };
      show();
      const timer = setInterval(show, 1000);
      return () => clearInterval(timer);
    },
  }),
);

// ---------- a tool ----------
export const toolExample = editorPart('tool', 'Example: a tool', 'A Tool that reports the cell you click.', (api) =>
  api.tool({ id: 'example-probe', label: 'Probe', help: 'Click a cell to see its position.', onCell: (cell, host, ev) => ev.kind === 'down' && host.notify('info', `Cell ${cell.x}, ${cell.y}`) }),
);

// ---------- an importer ----------
export const importerExample = editorPart('importer', 'Example: an importer', 'Brings a .coords file (lines of "x,y") in as markers.', (api) =>
  api.importer({ id: 'example-coords', label: 'Coordinates', extensions: ['.coords'], import: (name, bytes) => `${name}: ${new TextDecoder().decode(bytes).split('\n').filter(Boolean).length} points read` }),
);

// ---------- an exporter ----------
export const exporterExample = editorPart('exporter', 'Example: an exporter', 'Turns a data table into a CSV file.', (api) =>
  api.exporter({
    id: 'example-csv',
    label: 'Table as CSV',
    extension: '.csv',
    from: '.table.json',
    export(_name, text) {
      const t = JSON.parse(text) as { columns: { id: string }[]; rows: Record<string, unknown>[] };
      const cols = t.columns.map((c) => c.id);
      return [cols.join(','), ...t.rows.map((r) => cols.map((c) => String(r[c] ?? '')).join(','))].join('\n');
    },
  }),
);

// ---------- an export target ----------
export const exportTargetExample = editorPart('export-target', 'Example: an export target', 'A target that asks for a start scene.', (api) =>
  api.exportTarget({
    id: 'example-folder',
    label: 'A plain folder',
    platforms: ['win32', 'linux', 'darwin'],
    check: (project) => (project.startScene ? [] : ['The project has no start scene.']),
    describe: () => 'Copies the game into a folder you can zip.',
  }),
);

// ---------- an inspector section ----------
export const inspectorExample = editorPart('inspector', 'Example: an inspector', 'Draws the Score component as a number box.', (api) =>
  api.inspector({
    component: 'exampleScore',
    render(el, value, change) {
      const input = el.ownerDocument.createElement('input');
      input.type = 'number';
      input.value = String(value.points ?? 0);
      input.onchange = () => change({ ...value, points: Number(input.value) });
      el.appendChild(input);
    },
  }),
);

// ---------- a prefab for the Place tool ----------
export const prefabExample = editorPart('prefab', 'Example: a prefab', 'A beacon you can place.', (api) =>
  api.prefab({ id: 'example-beacon', label: 'Beacon', hint: 'A tall pillar of light.', group: 'Examples', make: (x, y, h) => thing('Beacon', ['beacon'], { color: 0xffe08a, w: 0.4, d: 0.4, height: 2 }, x, y, h) }),
);

// ---------- a check for the Problems panel ----------
export const validatorExample = editorPart('validator', 'Example: a check', 'Warns about objects called "TODO".', (api) =>
  api.validator({
    id: 'example-todo',
    check: (scene): ProblemDef[] => scene.entities.filter((e) => e.name.startsWith('TODO')).map((e) => ({ id: `todo-${e.id}`, severity: 'warning' as const, message: `"${e.name}" is still a to-do.`, entity: e.id })),
  }),
);

// ---------- a starter project ----------
export const templateExample: PluginDefinition = definePlugin(manifestOf('template', 'Example: a template', 'A "Small arena" starter.'), {
  templates: [
    {
      id: 'example-arena',
      name: 'Small arena (example)',
      description: 'A flat arena with a player.',
      build(name) {
        const map = new TileMap(16, 16);
        map.fill(1, 0);
        return { project: baseProject(name, []), scene: sceneFrom(map, [playerEntity('e1', 8.5, 8.5)]) };
      },
    },
  ],
  install: () => undefined,
});
