import { MAX_EXTRA_TOOLS, pluginToolKind } from '@tilewright/assistant';
import { dataKinds, dataToolOf, host } from '@tilewright/behaviors';

/** The assistant tools plugins add, as the model sees them: a name that cannot clash with the editor's, and the plugin's own wording. */
export function pluginToolName(plugin: string, id: string): string {
  return `${plugin}__${id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

export interface OfferedTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  kind: 'read' | 'act';
}

/** Every tool plugins add: the `write_<name>` tool of each kind of data that is on, then the tools the plugins wrote. */
export function pluginToolDefs(): OfferedTool[] {
  return [
    ...dataKinds().map(dataToolOf),
    ...[...host.ext.assistantTools.values()].map((t) => ({
      name: pluginToolName(t.plugin, t.id),
      description: `${t.description} (A tool added by the plugin "${t.plugin}".)`,
      input_schema: { type: 'object', ...(typeof t.input === 'object' && t.input ? t.input : { properties: {} }) },
      // a plugin cannot make its tool skip the question by calling it "read": that depends on what the plugin was allowed to do
      kind: pluginToolKind(t.kind, host.permissionsOf(t.plugin).granted),
    })),
  ];
}

/** What is passed to the model (all of them, up to the most one conversation takes) and the names of any that did not fit, to tell the person. */
export function toolsOffered(): { sent: OfferedTool[]; leftOut: string[] } {
  const all = pluginToolDefs();
  return { sent: all.slice(0, MAX_EXTRA_TOOLS), leftOut: all.slice(MAX_EXTRA_TOOLS).map((t) => t.name) };
}
