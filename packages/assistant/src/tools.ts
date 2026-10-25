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

const condition = z
  .union([
    z.object({ kind: z.literal('variable'), name: z.string(), op: z.enum(['=', '!=', '>', '>=', '<', '<=']).optional(), value: z.union([z.number(), z.string(), z.boolean()]).optional() }),
    z.object({ kind: z.literal('item'), item: z.string(), atLeast: z.number().optional() }),
  ])
  .describe('A condition: {"kind":"variable","name":"accepted","op":">=","value":1} or {"kind":"item","item":"key","atLeast":1}.');
const nextId = z.string().optional().describe('The id of the step that follows (leave out to end the conversation here).');
const dialogueNode = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('line'), speaker: z.string().optional(), text: z.string(), next: nextId }),
  z.object({
    id: z.string().min(1),
    type: z.literal('choice'),
    speaker: z.string().optional(),
    prompt: z.string().optional(),
    options: z.array(z.object({ text: z.string(), next: nextId, if: condition.optional().describe('Only offer this option when it holds.') })).min(1).max(8),
  }),
  z.object({ id: z.string().min(1), type: z.literal('set'), variable: z.string().min(1), op: z.enum(['set', 'add', 'toggle']).optional(), value: z.union([z.number(), z.string(), z.boolean()]).optional(), next: nextId }),
  z.object({ id: z.string().min(1), type: z.literal('give'), item: z.string().min(1), amount: z.number().optional().describe('Negative takes items away.'), next: nextId }),
  z.object({ id: z.string().min(1), type: z.literal('branch'), if: condition, then: nextId, else: nextId }),
  z.object({ id: z.string().min(1), type: z.literal('end') }),
]);
const cutsceneStep = z
  .object({
    type: z.enum(['wait', 'waitInput', 'say', 'dialogue', 'cameraTo', 'cameraReset', 'move', 'face', 'fade', 'animation', 'shake', 'sound', 'music', 'setVariable', 'give', 'message']),
    id: z.string().optional(),
    async: z.boolean().optional().describe('True lets the next step start at once (keep going).'),
  })
  .catchall(z.unknown())
  .describe('A cutscene step. Other keys depend on the type: wait {seconds}, say {speaker,text}, dialogue {dialogue}, cameraTo {target,seconds,zoom}, cameraReset {seconds}, move {who,to,speed}, face {who,toward}, fade {to,seconds,color}, animation {who,clip}, shake {amount,seconds}, sound {name}, music {name}, setVariable {name,value}, give {item,amount}, message {text}. Objects are "player", "name:Keeper", "tag:guard", "id:e3" or a point "x,y".');
const eventRow = z.object({ ...rowFields, children: z.array(leafRow).optional().describe('Sub-events that run only when this row holds (one level).') });

/** A colour of a drawing palette, by number: 1 is the first colour, 2 the second... (0 is none). */
const colorNumber = z.number().int().min(0).max(35);
const strokeFill = {
  fill: colorNumber.optional().describe('The colour inside (0 or missing: none).'),
  stroke: colorNumber.optional().describe('The colour of the outline (0 or missing: none).'),
  strokeWidth: z.number().min(0.5).max(64).optional().describe('How thick the outline is, in pixels (default 1).'),
};
const drawShape = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rect'), x: z.number(), y: z.number(), w: z.number().min(0), h: z.number().min(0), radius: z.number().min(0).optional(), rotation: z.number().optional().describe('Degrees.'), ...strokeFill }),
  z.object({ type: z.literal('ellipse'), cx: z.number(), cy: z.number(), rx: z.number().min(0), ry: z.number().min(0), rotation: z.number().optional(), ...strokeFill }),
  z.object({ type: z.literal('path'), points: z.array(z.object({ x: z.number(), y: z.number() })).min(2).max(200), closed: z.boolean().optional().describe('Join the last point back to the first (needed for a fill).'), smooth: z.boolean().optional().describe('Curve through the points.'), ...strokeFill }),
]);
const drawLayer = z
  .object({
    name: z.string().min(1).max(30),
    rows: z.array(z.string()).max(512).optional().describe('Pixels: one text row per row of the picture, "." clear, "1" the first palette colour... "9", then "a"... "z".'),
    shapes: z.array(drawShape).max(200).optional().describe('Rectangles, ellipses and paths that stay editable in the studio. Colours are palette numbers. Drawn in order, later ones on top.'),
    fills: z.array(z.object({ x: z.number().int().min(0), y: z.number().int().min(0), color: colorNumber })).max(50).optional().describe('Flood fills, after the rows: the area around the pixel (x, y) that has the same colour is filled with the colour.'),
    svg: z.string().max(60000).optional().describe('A drawing in SVG: it is drawn at the size of the picture and its colours snapped to the palette.'),
  })
  .describe('One layer, from the bottom up. Give rows, or shapes, or an svg (fills can go with rows, or alone on an empty layer).');
const paletteColors = z.array(z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)).min(1).max(35).describe('Colours as "#rrggbb" (or "#rrggbbaa"). Colour 1 is the first.');
const tileProps = z
  .object({
    walkable: z.boolean().optional(),
    water: z.boolean().optional(),
    pit: z.boolean().optional(),
    stair: z.boolean().optional(),
    blocksLight: z.boolean().optional(),
    tags: z.array(z.string().max(30)).max(10).optional(),
  })
  .describe('What the tile is, besides how it looks.');

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
    name: 'story_overview',
    kind: 'read',
    description: 'The story data of the project: every conversation (start, number of steps, problems the checker found), every cutscene (steps, problems), every language with how many lines it has translated, and the data the plugins that are on keep (a list each, such as items or minigames; write one back with its write_<name> tool).',
    schema: z.object({}),
  },
  {
    name: 'get_dialogue',
    kind: 'read',
    description: 'The full steps of one conversation, and the problems the checker found in it.',
    schema: z.object({ name: z.string().min(1) }),
  },
  {
    name: 'get_cutscene',
    kind: 'read',
    description: 'The full steps of one cutscene, and the problems the checker found in it.',
    schema: z.object({ name: z.string().min(1) }),
  },
  {
    name: 'get_translations',
    kind: 'read',
    description: 'The text of the game that can be translated (conversation lines, cutscene lines, items, messages, the game menus) with where each comes from, and for one language (if you give its code) which lines already have a translation.',
    schema: z.object({ language: z.string().optional().describe('A language code like "fr"; leave out to see only the text.') }),
  },
  {
    name: 'read_project_notes',
    kind: 'read',
    description: 'The project notes file: design notes and rules the user wants every answer to respect (for example "no puzzle may be bypassable").',
    schema: z.object({}),
  },

  {
    name: 'project_index',
    kind: 'read',
    description: 'Every file of the project by kind (scenes, sprites, sounds, pictures, screens, scripts, translations, notes...), so you know what exists and where. Then read any of them with read_project_file.',
    schema: z.object({}),
  },
  {
    name: 'list_project_files',
    kind: 'read',
    description: 'The files and folders directly inside one folder of the project (leave the folder out for the top). Paths are always relative to the project folder.',
    schema: z.object({ folder: z.string().optional().describe('A folder like "assets/sprites"; empty for the project folder.') }),
  },
  {
    name: 'project_references',
    kind: 'read',
    description: 'What uses what in the project. With a path: the files that file uses (a scene: its sprites, prefabs, tables, sounds) and the files that use it, and where in each it was found. With no path: the sprites, structures, tables, sounds and pictures that nothing uses, and the files used by the most others. Ask this BEFORE you delete, rename or replace a file or an asset, and to find leftovers. References are found by exact names and paths written in the files; one built from pieces in a script is not seen.',
    schema: z.object({ path: z.string().optional().describe('A file path from project_index, like "assets/sprites/tree.sprite.json".') }),
  },
  {
    name: 'search_project',
    kind: 'read',
    description: 'Search the project: for words inside its text files (scenes, conversations, screens, scripts, notes, tables, translations...) and for files by name or kind. "query" is looked for in file names and in the text; with "kind" alone you get every file of that kind (for example every sprite, or every sound). Answers give the path and line, so read_project_file or the specific tools can follow. Use it to find where something is used before changing or deleting it.',
    schema: z.object({
      query: z.string().max(200).optional().describe('Words to look for (a file name, or text inside files). Leave out to list a kind.'),
      where: z.enum(['both', 'names', 'text']).optional().describe('"names" looks only at file names, "text" only inside files; default both.'),
      kind: z.string().optional().describe('Only this kind of file: scenes, sprites, structures, tables, screens, story, scripts, sounds, images, documents, languages, notes, other.'),
      folder: z.string().optional().describe('Only inside this folder, like "assets/sprites".'),
      caseSensitive: z.boolean().optional(),
      regex: z.boolean().optional().describe('The query is a regular expression (for text).'),
      limit: z.number().int().min(1).max(100).optional().describe('Most matching lines to show (default 40).'),
    }),
  },
  {
    name: 'read_project_file',
    kind: 'read',
    description: 'Read one file of the project by its path (from project_index or list_project_files). Text files come back as text; a picture (PNG, JPEG, GIF, WebP, and BMP, PSD, Aseprite and SVG turned into PNG; a big one made smaller) comes back as a picture you can see, with its size, frames and the colours in it; a PDF comes back as the document itself (its pages), or its text when it is too big to send whole; a sprite comes back as a description and a picture of its first frame; a scene, a screens file, a conversation and the project file come back as their text AND a picture drawn from it (the map of a scene with its objects, regions and wires, and its logic graphs; each screen as a wireframe; a conversation as boxes and arrows; the tiles); a file a plugin can read comes back as that plugin explains it. Sounds cannot be heard: you get the length (MP3 too), levels in decibels, clipping, silence at the ends, any loop points stored in the file and a picture of the waveform, and must not guess how a sound sounds. A path may not leave the project folder.',
    schema: z.object({ path: z.string().min(1).describe('The path from the project folder, like "assets/screens.json".'), offset: z.number().int().min(0).optional().describe('For a long text file: start reading this many characters in (the reply says when there is more).') }),
  },
  {
    name: 'tile_template',
    kind: 'read',
    description: 'The canvas for a ground tile in this project (the size follows the project tile shape): its width and height, the guide polygons of the faces, and the canvas as rows of characters where T is the top face, L the left, R the right and "." is outside (cut away). Ask for kind "floor" (a flat diamond) or "block" (a cube with a top and two sides, with its height in levels). Use it before draw_tile.',
    schema: z.object({ kind: z.enum(['floor', 'block']), levels: z.number().min(0.5).max(4).optional() }),
  },
  {
    name: 'list_image_providers',
    kind: 'read',
    description: 'The ways this editor can make a picture from words (a plugin adds each one), and whether each needs the person to have set up a key. If there are none, you can still draw small pictures yourself with draw_sprite.',
    schema: z.object({}),
  },
  {
    name: 'list_plugins',
    kind: 'read',
    description: 'The plugins the game can switch on, which are on now, what each adds (behaviours, event blocks, buttons, screens) and what it needs. A new game has none on: turn-based play, control schemes (click to move, hotspots, grid cursor, box-select units, builder, camera), simulation helpers (producers, calendar, waves, villagers), combat, inventory, story, AI and lighting are all plugins. Check this before using a behaviour that is not listed by list_behaviors.',
    schema: z.object({}),
  },
  {
    name: 'list_templates',
    kind: 'read',
    description: 'The starting points a new project can be made from (empty, action adventure, tactics, builder, roguelike, point and click, and others) with what each switches on. Templates only matter when making a project; they cannot be applied to an open one.',
    schema: z.object({}),
  },
  {
    name: 'get_tables',
    kind: 'read',
    description: 'The data tables of the project (columns and rows): wave lists, building menus, loot tables, item stats. Event rows, behaviours and interface widgets read from them.',
    schema: z.object({ names: z.array(z.string()).max(20).optional().describe('Only these tables; leave out for all.') }),
  },
  {
    name: 'get_ui_screens',
    kind: 'read',
    description: 'The interface screens made in the UI designer (title, pause, settings, HUD...), each with the role it plays. Without a name: each screen and its widget outline. With a name: that screen\'s complete data.',
    schema: z.object({ screen: z.string().optional() }),
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
    name: 'write_dialogue',
    kind: 'act',
    description: 'Create a conversation or replace all of one. Steps join up through `next` (and option `next`, branch `then` and `else`); `start` is the id of the first step. Item ids must exist in the item list; variables are created by the conversation itself. Start from get_dialogue to change an existing one.',
    schema: z.object({ name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/, 'Letters, digits, spaces, _ and - only.'), start: z.string().min(1), nodes: z.array(dialogueNode).min(1).max(120) }),
  },
  {
    name: 'write_cutscene',
    kind: 'act',
    description: 'Create a cutscene or replace all of one: a list of steps that run one after another (a step marked async lets the next start at once). Start from get_cutscene to change an existing one.',
    schema: z.object({ name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/, 'Letters, digits, spaces, _ and - only.'), skippable: z.boolean().optional(), steps: z.array(cutsceneStep).min(1).max(120) }),
  },
  {
    name: 'write_skins',
    kind: 'act',
    description: 'Replace the project\'s whole list of player skins (start from story_overview). A skin has an id (letters, digits, - and _), a name, an optional colour as a number (-1 keeps the original), an optional sprite name, and when it is available: unlock {"kind":"always"} or {"kind":"variable","name":"won","atLeast":1} or {"kind":"item","item":"cape"}.',
    schema: z.object({
      skins: z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            color: z.number().int().min(-1).max(0xffffff).optional(),
            sprite: z.string().optional(),
            unlock: z.union([z.object({ kind: z.literal('always') }), z.object({ kind: z.literal('variable'), name: z.string(), atLeast: z.number().optional() }), z.object({ kind: z.literal('item'), item: z.string() })]).optional(),
          }),
        )
        .max(40),
    }),
  },
  {
    name: 'write_world_map',
    kind: 'act',
    description: 'Create or replace the world map the player opens with M (places joined by paths) or remove it. Each place has an id, a label, a scene file (as project_overview lists scenes), x (0-1000) and y (0-600) on the board, an icon (pin, town, dungeon, cave, forest, tower, castle, camp, harbor), unlock ({"kind":"visited"} default, "always", {"kind":"variable","name":...,"atLeast":1} or a rule a plugin brought, such as the kinds the plugin notes name) and optionally spawn (an object name or "x,y") and hidden. Paths join two place ids.',
    schema: z.object({
      remove: z.boolean().optional().describe('True removes the map (nothing else is needed).'),
      title: z.string().optional(),
      nodes: z
        .array(
          z.object({
            id: z.string().regex(/^[A-Za-z0-9_-]+$/),
            label: z.string().min(1),
            scene: z.string(),
            x: z.number().min(0).max(1000).optional(),
            y: z.number().min(0).max(600).optional(),
            icon: z.enum(['pin', 'town', 'dungeon', 'cave', 'forest', 'tower', 'castle', 'camp', 'harbor']).optional(),
            unlock: z.union([z.object({ kind: z.literal('visited') }), z.object({ kind: z.literal('always') }), z.looseObject({ kind: z.string() }), z.object({ kind: z.literal('variable'), name: z.string(), atLeast: z.number().optional() })]).optional(),
            spawn: z.string().optional(),
            hidden: z.boolean().optional(),
          }),
        )
        .max(60)
        .optional(),
      links: z.array(z.object({ a: z.string(), b: z.string() })).max(200).optional(),
    }),
  },
  {
    name: 'write_mixer',
    kind: 'act',
    description: 'Change the project\'s sound mix: only what you name changes. buses {master, music, sfx, voice} are levels 0-1.5; ducking {enabled, amount, attack, release} lowers the music while a voice-bus sound plays; sounds maps a sound name to {volume 0-2, bus "sfx"|"voice", pitchVariation, volumeVariation, cooldown, variants [other sound names]}; music maps a sound name to {volume, loopStart, loopEnd (seconds), fade}. Sound names are the files in Assets > Sounds.',
    schema: z.object({
      buses: z.record(z.string(), z.number()).optional(),
      ducking: z.record(z.string(), z.unknown()).optional(),
      sounds: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
      music: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    }),
  },
  {
    name: 'write_ui_layout',
    kind: 'act',
    description: 'Change the look of the game\'s own screen (assets/ui.json). theme (only what you name changes): font ("serif"|"sans"|"mono"|"rounded"), text, accent, panel, border, highlight (colours as #rrggbb), radius 0-28 (corner roundness), scale 0.75-2 (size of menus, conversation box and display). widgets, when given, is the whole list of pieces (start from story_overview): the pieces the plugins that are on add (story_overview lists the layout, with them: hearts, a light bar, quick slots, boss bars...), toasts, and your own counter / bar / text. A piece has id, kind, anchor ("default" leaves it where the game puts it, or tl tc tr cl c cr bl bc br), x and y (pixels inward from that edge, from the middle for c), scale 0.5-3, visible, and for your own: label, variable (the flag or counter shown), max or maxVariable (a bar is full at this), color, text (with {variable}). Missing built-ins come back by themselves. reset:true goes back to the standard screen.',
    schema: z.object({
      reset: z.boolean().optional(),
      theme: z
        .object({
          font: z.enum(['serif', 'sans', 'mono', 'rounded']).optional(),
          text: z.string().optional(),
          accent: z.string().optional(),
          panel: z.string().optional(),
          border: z.string().optional(),
          highlight: z.string().optional(),
          radius: z.number().optional(),
          scale: z.number().optional(),
        })
        .optional(),
      widgets: z
        .array(
          z
            .object({
              id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
              kind: z.enum(['hearts', 'lightbar', 'slots', 'bosses', 'toasts', 'counter', 'bar', 'text']),
            })
            .catchall(z.unknown()),
        )
        .max(40)
        .optional(),
    }),
  },
  {
    name: 'write_controls',
    kind: 'act',
    description: 'Change the keys and buttons a new player starts with (assets/input.json; players can still rebind them in Settings). overrides maps a built-in action (move_left, move_right, move_up, move_down, run, interact, jump, pause, and the buttons the plugins that are on add: list_plugins says which) to its bindings and replaces that action\'s list. actions, when given, is the whole list of the game\'s own actions {id: lower_case_name, label, bindings}; event rows ("a button is pressed", type the action name) and scripts (input.pressed("name")) can use them. Bindings look like "key:KeyF", "key:Space", "key:ArrowUp", "mouse:0" or "pad:button0".',
    schema: z.object({
      overrides: z.record(z.string(), z.array(z.string())).optional(),
      resetOverrides: z.boolean().optional().describe('True first forgets every built-in change.'),
      actions: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), label: z.string().min(1), bindings: z.array(z.string()).max(8).optional() })).max(40).optional(),
    }),
  },
  {
    name: 'set_project_settings',
    kind: 'act',
    description: 'Change the game\'s name, the scene it starts in (a scene file as project_overview lists them), or the title screen shown first (New game, Continue, Load game, Settings, Quit) with a line under the name.',
    schema: z.object({ name: z.string().min(1).optional(), startScene: z.string().optional(), titleScreen: z.boolean().optional(), subtitle: z.string().optional() }),
  },
  {
    name: 'edit_event_rows',
    kind: 'act',
    description: 'Change single rows of the open scene\'s event sheet without sending the whole sheet: operations run in order. {"op":"add","row":{...},"after":"<row id>"|"start"|"end"}, {"op":"update","id":"<row id>","row":{...the fields to change; conditions/actions/children you give replace the old ones...}}, {"op":"remove","id":"<row id>"}. Row ids come from get_event_sheet. Rows have the same shape as in set_event_sheet.',
    schema: z.object({
      operations: z
        .array(
          z.discriminatedUnion('op', [
            z.object({ op: z.literal('add'), row: eventRow, after: z.string().optional() }),
            z.object({ op: z.literal('update'), id: z.string().min(1), row: z.object({ ...Object.fromEntries(Object.entries(rowFields).map(([k, v]) => [k, (v as z.ZodType).optional()])), children: z.array(leafRow).optional() }) }),
            z.object({ op: z.literal('remove'), id: z.string().min(1) }),
          ]),
        )
        .min(1)
        .max(40),
    }),
  },
  {
    name: 'create_prefab',
    kind: 'act',
    description: 'Turn an object in the open scene into a prefab (a reusable template; the object becomes its first instance). Objects made from a prefab follow it except for settings changed on them.',
    schema: z.object({ object: target, name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/, 'Letters, digits, spaces, _ and - only.') }),
  },
  {
    name: 'set_regions',
    kind: 'act',
    description: 'Replace the open scene\'s regions (rooms): each has a name and a rectangle of cells, and can keep the camera inside it, play music (a sound name), darken it (0 to 1) and make bosses inside it only act while the player is there. Read scene_summary first and send every region back, changed. Regions without an id are new.',
    schema: z.object({
      regions: z
        .array(
          z.object({
            id: z.string().optional(),
            name: z.string(),
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            w: z.number().int().min(1),
            h: z.number().int().min(1),
            cameraBounds: z.boolean().optional(),
            music: z.string().optional(),
            darkness: z.number().min(0).max(1).optional(),
            bossActive: z.boolean().optional(),
          }),
        )
        .max(60),
    }),
  },
  {
    name: 'write_translation',
    kind: 'act',
    description: 'Add or change translations for a language: a map from the original text (exactly as get_translations shows it, keeping {placeholders}) to its translation. Give `name` (the language\'s own name, like "Français") when the language is new. Existing translations you do not mention stay.',
    schema: z.object({ language: z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, 'A code like fr, de or pt-br.'), name: z.string().optional(), strings: z.record(z.string(), z.string()) }),
  },
  {
    name: 'set_plugins',
    kind: 'act',
    description: 'Switch plugins on or off for the game (ids from list_plugins). Plugins a plugin needs are switched on with it. Turn on what the game needs: for example "turns" and "controls" for a tactics game, "controls" and "sim" for a town builder.',
    schema: z.object({ enable: z.array(z.string()).max(20).optional(), disable: z.array(z.string()).max(20).optional() }),
  },
  {
    name: 'write_table',
    kind: 'act',
    description: 'Create a data table or replace one completely. Column types: text, number, boolean, color, select (with options), ref (a row of another table: give table), sprite, prefab, sound. Every row needs an id and a value for each column id. Example: {"name":"Waves","columns":[{"id":"enemy","type":"prefab"},{"id":"count","type":"number"}],"rows":[{"id":"w1","enemy":"Goblin","count":5}]}.',
    schema: z.object({
      name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/, 'Letters, digits and _, starting with a letter.'),
      description: z.string().optional(),
      columns: z.array(z.object({ id: z.string(), label: z.string().optional(), type: z.enum(['text', 'number', 'boolean', 'color', 'select', 'ref', 'sprite', 'prefab', 'sound']).optional(), options: z.array(z.string()).optional(), table: z.string().optional(), default: z.union([z.string(), z.number(), z.boolean()]).optional() })).min(1).max(40),
      rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))).max(500),
    }),
  },
  {
    name: 'set_variables',
    kind: 'act',
    description: 'Set the open scene\'s starting variables (numbers, text or yes/no): gold, lives, a verb. Variables you name are added or changed; others stay.',
    schema: z.object({ variables: z.array(z.object({ name: z.string().min(1), value: z.union([z.number(), z.string(), z.boolean()]) })).min(1).max(40) }),
  },
  {
    name: 'generate_map',
    kind: 'act',
    description: 'Make the open scene\'s map procedurally from a seed: "dungeon" (rooms and corridors), "cave", "island" or "town". The same seed always gives the same map. Replaces the tiles; objects stay. atStart makes a new map every time the game (or a new run) starts instead of keeping this one.',
    schema: z.object({ kind: z.enum(['dungeon', 'cave', 'island', 'town']), width: z.number().int().min(8).max(512), height: z.number().int().min(8).max(512), seed: z.number().int().min(0).optional(), lockSeed: z.boolean().optional(), atStart: z.boolean().optional() }),
  },
  {
    name: 'write_ui_screen',
    kind: 'act',
    description: 'Add an interface screen, or replace the one with the same id/name. `screen` is {id,name,role?,root,modal?,dim?,opensOnStart?} where role says what the screen is used as ("title", "pause", "settings", "save", "load", "map", "inventory", "hud" or a role a plugin offers: a screen with a role replaces the built-in one the game would show, whatever its name) and root is a widget {id,name,type,anchor,x,y,w,h,layout,gap,padding,text,value,children:[...]}. Widget types: panel, label, button, image, bar, slider, checkbox, choice, tabs, list, grid... (get_ui_screens shows real examples). Text can hold {variable} or {Table.row.column}. A label can have `empty` (text shown when its value is empty); the style of a widget can have `scroll`, `maxH` and `scale`. Screens that came from a plugin carry `from`; to change one, write a copy with the same role (the original stays and can be reverted to). Read get_ui_screens first and copy its shapes.',
    schema: z.object({ screen: z.record(z.string(), z.unknown()) }),
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
  {
    name: 'submit_plan',
    kind: 'act',
    description: 'Show the user a plan before you build something bigger than a few small changes: a title and the steps you will take, in plain words. The user approves or rejects it. Depending on their permission setting, nothing may be changed until a plan is approved, and once it is you carry on with its steps without asking about each one. Keep steps short and in the order you will do them; name anything that is hard to take back.',
    schema: z.object({
      title: z.string().min(1).max(120),
      steps: z.array(z.string().min(1).max(300)).min(1).max(25),
      risks: z.array(z.string().max(300)).max(8).optional().describe('Anything the user should know before saying yes (it replaces something, it is hard to undo).'),
    }),
  },
  {
    name: 'draw_sprite',
    kind: 'act',
    description: 'Draw a picture as a new sprite in the project: up to 256 x 256. Give a palette of colours and then draw with any of: "rows" (pixel art as one text row per row of pixels; each character is a colour: "." is transparent, "1" the first palette colour, "2" the second, ... "9", then "a" the tenth ... "z"), and "layers" from the bottom up, each with rows, or shapes (rectangles, ellipses, paths with fills and outlines that stay editable in the studio), or an svg (drawn at the size of the picture, colours snapped to the palette), plus flood fills. Every row must be exactly "width" characters. For an animation give more frames of the rows in moreFrames. The user sees the picture before approving, and the sprite is opened in the sprite studio for touch-ups. Use read_project_file on existing sprites to see what they look like first, and keep a consistent style. For tiles of the ground use draw_tile instead. For larger or painted pictures use generate_image when list_image_providers offers one.',
    schema: z.object({
      name: z.string().min(1).max(40).describe('Letters, numbers, spaces, - and _.'),
      width: z.number().int().min(1).max(256),
      height: z.number().int().min(1).max(256),
      palette: paletteColors.optional().describe('Required unless the only layers are svg ones (then the colours of the drawing become the palette).'),
      rows: z.array(z.string()).min(1).max(256).optional().describe('The first frame as pixel rows, top row first (a layer called Pixels, below the others).'),
      moreFrames: z.array(z.array(z.string()).min(1).max(256)).max(15).optional().describe('Further frames of an animation (same size, same palette), for rows.'),
      layers: z.array(drawLayer).max(12).optional(),
      frameMs: z.number().int().min(20).max(2000).optional().describe('How long each frame shows, in milliseconds (default 120).'),
      replace: z.boolean().optional().describe('True to replace an existing sprite of that name.'),
    }),
  },
  {
    name: 'draw_tile',
    kind: 'act',
    description: 'Make a ground tile that works in the world: a floor tile (a flat diamond) or a block (a top and two sides). Call tile_template first for the size and the faces of this project, then draw on that canvas (same drawing tools as draw_sprite: palette, layers of rows, shapes, svg, fills; anything outside the faces is cut away). "faces" fills the top, left and right with flat colours first (palette numbers) so you only draw the detail. The tile is added to the tile palette (its pictures cut for the top and sides, ready to paint with), shown to the user on a patch of ground to see how it repeats, and opened in the tile studio. It can be painted with at once.',
    schema: z.object({
      name: z.string().min(1).max(40).describe('The tile name. Letters, numbers, spaces, - and _.'),
      kind: z.enum(['floor', 'block']),
      levels: z.number().min(0.5).max(4).optional().describe('For a block: how many levels tall (0.5 or 1 are the usual).'),
      palette: paletteColors,
      faces: z.object({ top: colorNumber.optional(), left: colorNumber.optional(), right: colorNumber.optional() }).optional().describe('Flat base colours for the faces, as palette numbers. For a block the left and right default to a darker version of the top.'),
      rows: z.array(z.string()).min(1).max(256).optional().describe('Pixel rows of the whole canvas (see tile_template), drawn over the faces.'),
      layers: z.array(drawLayer).max(12).optional(),
      props: tileProps.optional(),
      tileName: z.string().min(1).max(40).optional().describe('The name in the palette if it should differ from the sprite name.'),
      replace: z.boolean().optional().describe('True to replace a tile and sprites of that name.'),
    }),
  },
  {
    name: 'generate_image',
    kind: 'act',
    description: 'Make a picture from words with one of the image providers (list_image_providers says which exist; the person may need to have set one up) and add it to the project as a sprite. The user sees the picture before approving. Larger pictures cost the provider more.',
    schema: z.object({
      provider: z.string().min(1).describe('The id of a provider from list_image_providers.'),
      prompt: z.string().min(1).max(1500),
      name: z.string().min(1).max(40).describe('The sprite name to save it as.'),
      width: z.number().int().min(8).max(512),
      height: z.number().int().min(8).max(512),
      reference: z.string().optional().describe('The name of an existing sprite to start from or match the style of.'),
      as: z.enum(['sprite', 'floor-tile', 'block-tile']).optional().describe('What the picture becomes: a plain sprite (default), or a floor tile or a block tile that goes through the tile import: fitted to the tile shape of this project, its colours matched to the tiles already there, and added to the tile palette.'),
      source: z.enum(['texture', 'picture']).optional().describe('For a tile: a texture is flat and seen from above (grass, stone: it is laid on the diamond or the block); a picture already has the isometric angle (its background is taken away and it is fitted). Default texture.'),
      columns: z.number().int().min(1).max(16).optional().describe('For a tile: the picture is a sheet with this many tiles across (default 1).'),
      rows: z.number().int().min(1).max(16).optional().describe('For a tile: and this many down.'),
      levels: z.number().min(0.5).max(4).optional().describe('For a block tile: how many levels tall.'),
      replace: z.boolean().optional(),
    }),
  },
  {
    name: 'place_blocks',
    kind: 'act',
    description: 'Put solid blocks in the world, or take them away. Each box is a block of cells: x and y are map cells, z is the level it starts at (0 is the floor), w along x, d along y, h levels up. tile is a tile id from get_tiles. Stairs and ramps are blocks of their shape. At most 3000 cells at a time. Use this for walls, towers, floors in the air, bridges and steps; use paint_tiles for the ground itself.',
    schema: z.object({
      boxes: z
        .array(
          z.object({
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            z: z.number().int().min(0).max(254).optional(),
            w: z.number().int().min(1).max(64).optional(),
            d: z.number().int().min(1).max(64).optional(),
            h: z.number().int().min(1).max(64).optional(),
            tile: z.number().int().min(1).optional().describe('Required unless remove is true.'),
            shape: z.enum(['cube', 'stairs', 'ramp']).optional(),
            rot: z.number().int().min(0).max(3).optional().describe('Which way stairs and ramps face (0 to 3).'),
            solid: z.boolean().optional().describe('False makes a block that can be walked through.'),
          }),
        )
        .min(1)
        .max(40),
      remove: z.boolean().optional().describe('True takes the blocks in these boxes away instead.'),
    }),
  },
  {
    name: 'set_gravity',
    kind: 'act',
    description: 'Choose which way gravity pulls in the open scene ("-z" is down, the usual; "+z" is up; "-x", "+x", "-y", "+y" are the four sideways ways) and whether the game may place and break blocks while it runs (a builder or digging game). Gravity in any direction other than down needs the project\'s compatibility switch "Bodies collide with every block" (Project settings, Compatibility); say so if it is off.',
    schema: z.object({
      direction: z.enum(['-z', '+z', '-x', '+x', '-y', '+y']).optional(),
      blocksEditable: z.boolean().optional().describe('May the game place and break blocks while it runs.'),
      editLimit: z.number().int().min(1).max(100000).optional().describe('How many block edits one run of the game may make (default 200).'),
    }),
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
