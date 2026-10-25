/**
 * What the assistant may do without asking, even when the person has said "just do it" (or approved a plan). Edits inside the project
 * can go ahead (the whole run can be rolled back); three kinds of change never do:
 *   - taking things away (objects, wires, event rows, blocks, behaviours, a whole map or screen layout),
 *   - changing which plugins are on (a plugin is code),
 *   - anything that goes out over the network (a picture from a paid service).
 * No Electron and no editor in here, so it is tested on its own (approval.test.ts).
 */

export type ApprovalClass = 'edit' | 'delete' | 'plugins' | 'network';

const WHY: Record<Exclude<ApprovalClass, 'edit'>, string> = {
  delete: 'Claude always asks before it takes something away.',
  plugins: 'Claude always asks before it changes which plugins are on, or runs a plugin\'s tool (a plugin is code).',
  network: 'Claude always asks before it uses the network (a service may charge for it).',
};

export const whyAsked = (cls: ApprovalClass): string => (cls === 'edit' ? '' : WHY[cls]);

/** Does a call ask for something to be taken away, whatever the tool is called? */
function removes(name: string, input: Record<string, unknown>): boolean {
  switch (name) {
    case 'delete_objects':
    case 'remove_wires':
      return true;
    case 'update_objects':
      return Array.isArray(input.updates) ? (input.updates as Record<string, unknown>[]).some((c) => Array.isArray(c.remove_behaviors) && c.remove_behaviors.length > 0) : false;
    case 'edit_event_rows':
      return Array.isArray(input.operations) ? (input.operations as Record<string, unknown>[]).some((o) => o.op === 'remove') : false;
    case 'write_world_map':
    case 'place_blocks':
      return input.remove === true;
    case 'write_ui_layout':
      return input.reset === true;
    case 'write_controls':
      return input.resetOverrides === true;
    default:
      return false;
  }
}

/** The class of a built-in tool call. Plugin tools are classified from what their plugin was granted (see `pluginToolKind`). */
export function approvalClass(name: string, input: Record<string, unknown>): ApprovalClass {
  if (name === 'set_plugins') return 'plugins';
  if (name === 'generate_image') return 'network';
  return removes(name, input) ? 'delete' : 'edit';
}

/** May this call run without the person saying yes to it? Only an edit may, and only when the person has said to go ahead. */
export const mayRunUnasked = (cls: ApprovalClass): boolean => cls === 'edit';

/**
 * How a tool a plugin added is treated. It is only "read" (runs at once) when the plugin says so AND was not granted anything
 * beyond reading the project: a plugin that can write, reach the network or run programs cannot make its own tool skip the question
 * by calling itself "read". Everything else is a change, and a change from a plugin is always asked about.
 */
export function pluginToolKind(declared: 'read' | 'change', granted: readonly string[]): 'read' | 'act' {
  if (declared === 'change') return 'act';
  return granted.every((g) => g === 'project.read') ? 'read' : 'act';
}
