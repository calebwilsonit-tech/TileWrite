import { z } from 'zod';

/**
 * The editor tools Claude can call. Each has a Zod schema: the JSON Schema sent to the API is made from it,
 * and every tool input is checked against it before anything runs. The order and wording here are part of
 * the cached prompt prefix, so keep them stable (change them deliberately, not per request).
 *
 * `read` tools only look; `act` tools change the project and are always shown to the user as a preview
 * that they approve or reject.
 */

export type ToolKind = 'read' | 'act';

export interface ToolSpec {
  name: string;
  kind: ToolKind;
  description: string;
  schema: z.ZodObject;
}

const target = z.string().min(1).describe('An object id (like "e12") or its exact name (like "Gate A").');
const settings = z
  .record(z.string(), z.record(z.string(), z.unknown()))
  .describe('Component or behaviour settings to set, by id: {"gate": {"openHeight": 2}}. Only the fields you name change. Use list_behaviors for the ids and fields.');

const eventCondition = z.object({
  type: z.string().describe('A condition id from list_event_blocks.'),
  params: z.record(z.string(), z.unknown()).optional().describe('Its parameters, by key.'),
  negate: z.boolean().optional().describe('True for "is not".'),
});
const eventAction = z.object({
  type: z.string().describe('An action id from list_event_blocks.'),
  params: z.record(z.string(), z.unknown()).optional().describe('Its parameters, by key.'),
});
const rowFields = {
  comment: z.string().optional().describe('A note shown above the row.'),
  mode: z.enum(['all', 'any']).optional().describe('"all" = every condition must hold (default); "any" = at least one.'),
  once: z.boolean().optional().describe('Run the actions only on the tick the row becomes true.'),
  forEach: z.string().optional().describe('Loop over every object matching a reference like "tag:enemy"; "picked" then means that object.'),
  repeat: z.number().int().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  conditions: z.array(eventCondition).describe('When these hold (an empty list means always).'),
  actions: z.array(eventAction).describe('Do these.'),
};
const leafRow = z.object(rowFields);
const eventRow = z.object({ ...rowFields, children: z.array(leafRow).optional().describe('Sub-events that run only when this row holds (one level).') });

export const TOOLS: ToolSpec[] = [
  // ---------- read ----------
  {
    name: 'project_overview',
    kind: 'read',
    description: 'The project at a glance: its name, scenes (and which is open), scripts, conversations, cutscenes, items, prefabs, and the number of problems. Call this first when you do not know the project.',
    schema: z.object({}),
  },
  {
    name: 'scene_summary',
    kind: 'read',
    description: 'The open scene: map size, every object (id, name, tags, position x/y/h, behaviours, prefab), wires between objects, regions, variables and the number of event rows. Positions are in cells: the centre of cell (4, 7) is x=4.5, y=7.5.',
    schema: z.object({}),
  },
  {
    name: 'get_objects',
    kind: 'read',
    description: 'The complete saved data of some objects (all components and settings).',
    schema: z.object({ targets: z.array(target).min(1).max(20) }),
  },
  {
    name: 'get_tiles',
    kind: 'read',
    description: 'The map cells in a rectangle (at most 40 x 40): tile id, height, slope and flags for each, plus a legend of tile ids and flag bits. Use it before painting.',
    schema: z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1).max(40), h: z.number().int().min(1).max(40) }),
  },
  {
    name: 'get_selection',
    kind: 'read',
    description: 'The objects the user currently has selected in the editor.',
    schema: z.object({}),
  },
  {
    name: 'get_event_sheet',
    kind: 'read',
    description: 'The open scene\'s event sheet: every row (conditions and actions with their parameters, sub-events) with a plain-English description of each, plus the scene variables and any problems the sheet checker found.',
    schema: z.object({}),
  },
  {
    name: 'list_event_blocks',
    kind: 'read',
    description: 'Every condition and action an event row can use, with ids and parameters (type, default, options). Use these ids and keys when writing a sheet.',
    schema: z.object({}),
  },
  {
    name: 'list_behaviors',
    kind: 'read',
    description: 'Every behaviour (ready-made logic an object can have: gates, plates, guards, lights, scripts...): id, what it does, its settings (key, type, options), and the signals it can send and receive over wires.',
    schema: z.object({}),
  },
  {
    name: 'list_prefabs',
    kind: 'read',
    description: 'The things place_objects can put down: built-in parts (id, label, what it is) and this project\'s own prefabs.',
    schema: z.object({}),
  },
  {
    name: 'read_script',
    kind: 'read',
    description: 'The source code of a script in the project.',
    schema: z.object({ name: z.string().min(1) }),
  },
  {
    name: 'scripting_reference',
    kind: 'read',
    description: 'The TypeScript declarations of the scripting API (defineScript, the `me` and `game` objects). Read this before writing or changing a script.',
    schema: z.object({}),
  },
  {
    name: 'get_problems',
    kind: 'read',
    description: 'What the editor\'s Problems panel shows for the open scene (errors and warnings in plain English, with the object they are about), plus the last whole-project check if one was run.',
    schema: z.object({}),
  },
  {
    name: 'run_puzzle_check',
    kind: 'read',
    description: 'Run the puzzle checks on the open scene: can a gate be bypassed, is the goal unreachable, can crates get stuck. With deep=true it also searches crate puzzles for soft-locks (slower).',
    schema: z.object({ deep: z.boolean().optional() }),
  },
  {
    name: 'run_playbot',
    kind: 'read',
    description: 'Let the playbot play the open scene with only the buttons a player has. "walk_to_goal" just walks (it cannot use switches); "solve_to_goal" also uses levers and plates, and solves a crate puzzle first by pushing the crates onto the plates. Needs an object tagged "goal" or "exit". Reports whether it got there and how long it took.',
    schema: z.object({ mode: z.enum(['walk_to_goal', 'solve_to_goal']) }),
  },
  {
    name: 'screenshot',
    kind: 'read',
    description: 'A picture of the viewport as the user sees it right now.',
    schema: z.object({}),
  },
  {
    name: 'read_project_notes',
    kind: 'read',
    description: 'The project notes file: design notes and rules the user wants every answer to respect (for example "no puzzle may be bypassable").',
    schema: z.object({}),
  },

  // ---------- act (always previewed and approved by the user) ----------
  {
    name: 'place_objects',
    kind: 'act',
    description:
      'Put new objects in the open scene. `prefab` is an id from list_prefabs (for example "plate", "gate", "crate", "guard", or "prefab:Name"). x and y are in cells (centre of cell (4,7) is 4.5, 7.5); h is the floor height (defaults to the height of that cell). Use `settings` to change behaviour settings right away. Returns the new object ids.',
    schema: z.object({
      objects: z
        .array(
          z.object({
            prefab: z.string().min(1),
            x: z.number(),
            y: z.number(),
            h: z.number().optional(),
            name: z.string().optional().describe('A name to give it. Wires and event rows refer to objects by name, so give important ones unique names.'),
            tags: z.array(z.string()).optional().describe('Tags to use instead of the prefab\'s own.'),
            facing: z.number().int().min(0).max(7).optional(),
            settings: settings.optional(),
          }),
        )
        .min(1)
        .max(60),
    }),
  },
  {
    name: 'update_objects',
    kind: 'act',
    description: 'Change existing objects: rename, retag, move, change settings, add or remove behaviours.',
    schema: z.object({
      updates: z
        .array(
          z.object({
            target,
            name: z.string().optional(),
            tags: z.array(z.string()).optional().describe('Replaces the tags.'),
            move_to: z.object({ x: z.number(), y: z.number(), h: z.number().optional() }).optional(),
            settings: settings.optional(),
            add_behaviors: z.array(z.string()).optional().describe('Behaviour ids from list_behaviors.'),
            remove_behaviors: z.array(z.string()).optional(),
          }),
        )
        .min(1)
        .max(60),
    }),
  },
  {
    name: 'delete_objects',
    kind: 'act',
    description: 'Delete objects (and the wires attached to them).',
    schema: z.object({ targets: z.array(target).min(1).max(60) }),
  },
  {
    name: 'paint_tiles',
    kind: 'act',
    description: 'Change map cells in one or more rectangles: tile id, height, slope, flags. Fields you leave out stay as they are. Read get_tiles first for the ids and flag bits. Rectangles must lie inside the map.',
    schema: z.object({
      rects: z
        .array(
          z.object({
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            w: z.number().int().min(1),
            h: z.number().int().min(1),
            tile: z.number().int().min(0).optional(),
            height: z.number().int().min(0).optional(),
            slope: z.number().int().min(0).optional(),
            flags: z.number().int().min(0).optional(),
          }),
        )
        .min(1)
        .max(40),
    }),
  },
  {
    name: 'connect_wires',
    kind: 'act',
    description: 'Wire one object\'s output signal to another object\'s input (for example a plate\'s "pressed" output to a gate\'s "open" input). Signal names come from list_behaviors.',
    schema: z.object({
      wires: z.array(z.object({ from: target, output: z.string().min(1), to: target, input: z.string().min(1) })).min(1).max(60),
    }),
  },
  {
    name: 'remove_wires',
    kind: 'act',
    description: 'Remove wires between objects (matching from, output, to and input).',
    schema: z.object({
      wires: z.array(z.object({ from: target, output: z.string().min(1), to: target, input: z.string().min(1) })).min(1).max(60),
    }),
  },
  {
    name: 'set_event_sheet',
    kind: 'act',
    description: 'Replace the open scene\'s whole event sheet (and optionally its variables). Start from get_event_sheet, change what you need and send the full list back. Use ids and parameter keys from list_event_blocks; objects are referenced like "name:Gate A", "tag:enemy" or "player".',
    schema: z.object({
      rows: z.array(eventRow).max(80),
      variables: z.array(z.object({ name: z.string().min(1), value: z.union([z.number(), z.string(), z.boolean()]) })).optional().describe('If given, replaces the scene variables.'),
    }),
  },
  {
    name: 'write_script',
    kind: 'act',
    description: 'Create a script or replace its whole source. The file must be TypeScript with `export default defineScript({...})` (see scripting_reference). The script name becomes a behaviour called script_<Name> that objects can use.',
    schema: z.object({
      name: z.string().regex(/^[A-Za-z][A-Za-z0-9 _-]{0,40}$/, 'Start with a letter; letters, digits, spaces, _ and - only.'),
      source: z.string().min(1).max(60_000),
    }),
  },
  {
    name: 'write_project_notes',
    kind: 'act',
    description: 'Replace the project notes file (design notes and rules for future conversations).',
    schema: z.object({ text: z.string().max(20_000) }),
  },
];

export function getTool(name: string): ToolSpec | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** The tool list as the API wants it: JSON Schemas made from the Zod ones. */
export function toolDefinitions(): { name: string; description: string; input_schema: { type: 'object'; [k: string]: unknown }; eager_input_streaming: boolean }[] {
  return TOOLS.map((t) => {
    const { $schema: _s, ...schema } = z.toJSONSchema(t.schema, { io: 'input' }) as Record<string, unknown>;
    return { name: t.name, description: t.description, input_schema: schema as { type: 'object' }, eager_input_streaming: true };
  });
}

export type ToolCheck = { ok: true; value: Record<string, unknown> } | { ok: false; message: string };

/** Check a tool call's input before running it. The message is written for Claude, so it can fix the call. */
export function checkToolInput(name: string, input: unknown): ToolCheck {
  const tool = getTool(name);
  if (!tool) return { ok: false, message: `There is no tool called "${name}". The tools are: ${TOOLS.map((t) => t.name).join(', ')}.` };
  const r = tool.schema.safeParse(input ?? {});
  if (r.success) return { ok: true, value: r.data as Record<string, unknown> };
  return { ok: false, message: `The input for ${name} is not valid:\n${z.prettifyError(r.error)}` };
}
