import { host } from '@tilewright/behaviors';
import { COMMANDS, type Command } from '../app/commands';
import { store } from '../app/store';
import { api } from '../project/api';

const PREFIX = 'plugin.';

/** The commands the plugins that are on add to the palette: one to import for each importer, one to export for each exporter. */
function commandsOfPlugins(): Command[] {
  const out: Command[] = [];
  for (const imp of host.editor.importers.values()) {
    out.push({
      id: `${PREFIX}import.${imp.id}`,
      label: `Import: ${imp.label}…`,
      category: 'Plugins',
      keys: '',
      run: () =>
        void (async () => {
          const file = await api().importFile(`Import ${imp.label}`, imp.extensions.map((e) => e.replace(/^\./, '')));
          if (!file) return;
          try {
            const said = await imp.import(file.name, file.bytes, host.editorHostFor(imp.plugin));
            store.notify('info', said || `Imported ${file.name}.`);
          } catch (e) {
            store.notify('error', `${imp.label}: ${e instanceof Error ? e.message : String(e)}`);
          }
        })(),
    });
  }
  for (const exp of [...host.ext.exporters.values()]) {
    out.push({
      id: `${PREFIX}export.${exp.id}`,
      label: `Export as ${exp.label}…`,
      category: 'Plugins',
      keys: '',
      run: () =>
        void (async () => {
          const file = await api().importFile(`Choose a ${exp.from} file to turn into ${exp.label}`, [exp.from.replace(/^\./, '')]);
          if (!file) return;
          try {
            const made = await exp.export(file.name, new TextDecoder().decode(file.bytes));
            const text = typeof made === 'string' ? made : new TextDecoder().decode(made);
            const base = file.name.replace(/\.[^.]*$/, '').replace(/\.table$/, '');
            const where = await api().saveFile(`Save ${exp.label}`, `${base}${exp.extension}`, text);
            if (where) store.notify('info', `Saved ${where}.`);
          } catch (e) {
            store.notify('error', `${exp.label}: ${e instanceof Error ? e.message : String(e)}`);
          }
        })(),
    });
  }
  return out;
}

/** Keep the palette's plugin commands in step with the plugins that are on. */
export function syncPluginCommands(): void {
  for (let i = COMMANDS.length - 1; i >= 0; i--) if (COMMANDS[i]!.id.startsWith(PREFIX)) COMMANDS.splice(i, 1);
  COMMANDS.push(...commandsOfPlugins());
}

export function watchPluginCommands(): () => void {
  syncPluginCommands();
  return host.onChange(syncPluginCommands);
}
