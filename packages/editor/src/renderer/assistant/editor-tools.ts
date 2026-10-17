import {
  ACTIONS,
  CONDITIONS,
  actionDef,
  attachBehavior,
  behaviorList,
  checkSheet,
  conditionDef,
  describeAction,
  describeCondition,
  describeRow,
  detachBehavior,
  getBehavior,
  isBehavior,
  newAction,
  newCondition,
  type Names,
} from '@tilewright/behaviors';
import apiSource from '@tilewright/behaviors/src/scripting/api.ts?raw';
import { Bot, extractPushPuzzle, solvePush, type PlayReport } from '@tilewright/playbot';
import { DEFAULT_TILESET, FLAG, SLOPE, resolveInstance, type EntityData, type EventRow, type WireData } from '@tilewright/runtime';
import { lineDiff, type ToolOutput } from '@tilewright/assistant';
import { ToolProblem, fail, json, requireDoc, requireEditing, undoTop, type Proposal } from './tool-core';
import { prepareStoryAction, runStoryRead } from './story-tools';
import { store } from '../app/store';
import { viewportRef } from '../app/commands';
import { readCell } from '../model/cells';
import type { EditorDoc } from '../model/doc';
import { storyVariables } from '../model/story-vars';
import { validateScene } from '../model/validate';
import { api, joinPath } from '../project/api';
import { storyNameProblem } from '../project/story';
import { prefabNameProblem } from '../project/prefabs';
import { studio } from '../studio/store';
import { allPrefabs } from '../tools/prefabs';

export { ToolProblem, type Proposal };
const text = (t: string): ToolOutput => ({ content: t });

export const NOTES_FILE = 'project-notes.md';

const label = (e: { name: string; id: string }): string => `"${e.name}" (${e.id})`;

// ---------- finding objects ----------

function resolveTarget(doc: EditorDoc, ref: string): EntityData {
  const byId = doc.getEntity(ref);
  if (byId) return byId;
  const named = doc.entities.filter((e) => e.name === ref);
  if (named.length === 1) return named[0]!;
  if (named.length > 1) return fail(`Several objects are called "${ref}": ${named.map((e) => e.id).join(', ')}. Use an id.`);
  const loose = doc.entities.filter((e) => e.name.toLowerCase() === ref.toLowerCase());
  if (loose.length === 1) return loose[0]!;
  return fail(`There is no object with the id or name "${ref}". Use scene_summary to see the objects.`);
}

const transformOf = (e: EntityData): { x: number; y: number; h: number } | undefined => e.components.transform as { x: number; y: number; h: number } | undefined;

function names(doc: EditorDoc): Names {
  return { entity: (id: string) => doc.getEntity(id)?.name };
}

// ---------- reading ----------

function behavioursOf(e: EntityData): string[] {
  return Object.keys(e.components).filter((k) => isBehavior(k));
}

function summariseEntity(e: EntityData): Record<string, unknown> {
  const t = transformOf(e);
  return { id: e.id, name: e.name, tags: e.tags, ...(e.prefab ? { prefab: e.prefab } : {}), ...(t ? { x: t.x, y: t.y, h: t.h } : {}), behaviours: behavioursOf(e) };
}

function tileLegend(): { id: number; name: string }[] {
  const project = store.state.project?.project.tileset;
  if (project && project.length > 0) return project.map((t) => ({ id: t.id, name: t.name }));
  return Object.entries(DEFAULT_TILESET).map(([id, t]) => ({ id: Number(id), name: t.name }));
}

export function sceneProblems(doc: EditorDoc): { severity: string; message: string; object?: string }[] {
  const scene = validateScene(doc, new Set(studio.assets.keys()), new Set(store.state.prefabNames), storyVariables(store.story.dialogues, store.story.cutscenes), new Set(studio.sounds.map((s) => s.name))).map((p) => ({
    severity: p.severity,
    message: p.message,
    ...(p.target?.kind === 'entity' ? { object: label(doc.getEntity(p.target.id) ?? { name: '?', id: p.target.id }) } : {}),
  }));
  const puzzles = (store.state.analysis?.issues ?? []).map((i) => ({ severity: i.severity, message: i.message, ...(i.entity ? { object: label(doc.getEntity(i.entity) ?? { name: '?', id: i.entity }) } : {}) }));
  return [...scene, ...puzzles];
}

export async function readNotes(): Promise<string> {
  const p = store.state.project;
  if (!p) return '';
  const file = joinPath(p.dir, NOTES_FILE);
  try {
    return (await api().fs.exists(file)) ? await api().fs.read(file) : '';
  } catch {
    return '';
  }
}

async function writeNotes(content: string): Promise<void> {
  const p = store.state.project;
  if (!p) return fail('No project is open.');
  await api().fs.write(joinPath(p.dir, NOTES_FILE), content);
}

function eventFacts(doc: EditorDoc) {
  return {
    entityIds: new Set(doc.entities.map((e) => e.id)),
    tags: new Set(doc.entities.flatMap((e) => e.tags)),
    variables: new Set(doc.variables.map((v) => v.name)),
    prefabs: new Set(store.state.prefabNames),
    storyVariables: storyVariables(store.story.dialogues, store.story.cutscenes),
    sounds: new Set(studio.sounds.map((s) => s.name)),
  };
}

function rowText(rows: readonly EventRow[], n: Names, depth = 0): string[] {
  return rows.flatMap((r) => [`${'  '.repeat(depth)}${r.enabled ? '' : '(off) '}${describeRow(r, n)}`, ...rowText(r.children, n, depth + 1)]);
}

async function playbot(mode: 'walk_to_goal' | 'solve_to_goal'): Promise<ToolOutput> {
  const doc = requireDoc();
  const goal = doc.entities.find((e) => e.tags.includes('goal') || e.tags.includes('exit'));
  if (!goal) return { isError: true, content: 'There is no object tagged "goal" or "exit" in this scene, so the bot has nowhere to go. Place a "Goal / exit" (list_prefabs: goal) first.' };
  const ref = goal.tags.includes('goal') ? 'tag:goal' : 'tag:exit';
  const game = store.newHeadlessGame();
  if (!game || !game.sim.world.withTag('player')[0]) return { isError: true, content: 'There is no player start in this scene, so the bot has nobody to move.' };
  const bot = new Bot(game);
  let report: PlayReport;
  if (mode === 'walk_to_goal') report = bot.walkToEntity(ref, { maxSeconds: 120 });
  else {
    // a crate puzzle is solved first (the bot pushes the crates onto the plates with its own buttons), then it plays on to the goal
    const puzzle = extractPushPuzzle(doc.toScene(), store.prefabs);
    const plan = puzzle ? solvePush(puzzle) : null;
    if (plan && !plan.solvable) return text(json({ reachedGoal: false, message: plan.capped ? 'The crate puzzle is too big to solve completely.' : 'The crate puzzle cannot be solved: the crates cannot all reach the plates.' }));
    const pushed = plan ? bot.executePushes(plan.moves) : null;
    if (pushed && !pushed.ok) report = pushed;
    else {
      bot.wait(1);
      report = bot.solveToGoal(ref, { maxSeconds: 120 });
    }
  }
  store.botSay(report.ok ? 'info' : 'warn', `(Claude asked for this run) ${report.message}`);
  return text(json({ reachedGoal: report.ok, message: report.message, report }));
}

export async function runReadTool(name: string, input: Record<string, unknown>): Promise<ToolOutput> {
  try {
    switch (name) {
      case 'project_overview': {
        const p = store.state.project;
        if (!p) return fail('No project is open.');
        const doc = store.doc;
        return text(
          json({
            project: p.project.name,
            scenes: p.project.scenes,
            startScene: p.project.startScene,
            openScene: store.state.scenePath,
            scripts: [...store.scripts.keys()],
            scriptProblems: store.state.scriptProblems.length,
            conversations: [...store.story.dialogues.keys()],
            cutscenes: [...store.story.cutscenes.keys()],
            items: store.story.items.map((i) => i.id),
            prefabs: [...store.prefabs.keys()],
            problemsInOpenScene: doc ? sceneProblems(doc).length : null,
            notesFile: NOTES_FILE,
          }),
        );
      }
      case 'scene_summary': {
        const doc = requireDoc();
        const shown = doc.entities.slice(0, 400);
        return text(
          json({
            name: doc.name,
            map: { width: doc.map.width, height: doc.map.height },
            objects: shown.map(summariseEntity),
            ...(doc.entities.length > shown.length ? { omitted: doc.entities.length - shown.length } : {}),
            wires: doc.wires.map((w) => ({ id: w.id, from: `${doc.getEntity(w.from.entity)?.name ?? w.from.entity}.${w.from.output}`, to: `${doc.getEntity(w.to.entity)?.name ?? w.to.entity}.${w.to.input}` })),
            regions: doc.regions.map((r) => ({ id: r.id, name: r.name, x: r.x, y: r.y, w: r.w, h: r.h, cameraBounds: r.cameraBounds, music: r.music, darkness: r.darkness, bossActive: r.bossActive })),
            variables: doc.variables,
            eventRows: doc.events.length,
          }),
        );
      }
      case 'get_objects': {
        const doc = requireDoc();
        const out = (input.targets as string[]).map((t) => {
          const e = resolveTarget(doc, t);
          return e.prefab ? { ...(resolveInstance(e, doc.prefabs) ?? e) } : e;
        });
        return text(json(out));
      }
      case 'get_tiles': {
        const doc = requireDoc();
        const { x, y, w, h } = input as { x: number; y: number; w: number; h: number };
        const m = doc.map;
        if (x >= m.width || y >= m.height) return fail(`That is outside the map (${m.width} x ${m.height}).`);
        const x2 = Math.min(m.width, x + w);
        const y2 = Math.min(m.height, y + h);
        const layer = (read: (cx: number, cy: number) => number): number[][] => Array.from({ length: y2 - y }, (_, j) => Array.from({ length: x2 - x }, (_, i) => read(x + i, y + j)));
        return text(
          json(
            {
              rect: { x, y, w: x2 - x, h: y2 - y },
              tiles: layer((cx, cy) => readCell(m, cx, cy).tile),
              heights: layer((cx, cy) => readCell(m, cx, cy).height),
              slopes: layer((cx, cy) => readCell(m, cx, cy).slope),
              flags: layer((cx, cy) => readCell(m, cx, cy).flags),
              legend: { tiles: tileLegend(), flagBits: FLAG, slopeDirections: SLOPE, note: 'Rows are y, columns are x. A slope value is the direction the ground rises. flags is a sum of bits.' },
            },
            0,
          ),
        );
      }
      case 'get_selection': {
        const doc = requireDoc();
        const sel = store.state.selection.map((id) => doc.getEntity(id)).filter((e): e is EntityData => e !== undefined);
        return text(json({ selected: sel.map(summariseEntity), selectedRegion: store.state.selectedRegion }));
      }
      case 'get_event_sheet': {
        const doc = requireDoc();
        const n = names(doc);
        return text(
          json({
            description: rowText(doc.events, n),
            rows: doc.events,
            variables: doc.variables,
            problems: checkSheet(doc.events, eventFacts(doc), n).map((p) => p.text),
          }),
        );
      }
      case 'list_event_blocks':
        return text(
          json(
            {
              conditions: CONDITIONS.map((c) => ({ id: c.id, label: c.label, category: c.category, params: c.params.map((p) => ({ key: p.key, type: p.type, default: p.default, ...(p.options ? { options: p.options.map((o) => o.value) } : {}) })) })),
              actions: ACTIONS.map((a) => ({ id: a.id, label: a.label, category: a.category, params: a.params.map((p) => ({ key: p.key, type: p.type, default: p.default, ...(p.options ? { options: p.options.map((o) => o.value) } : {}) })) })),
              objectReferences: 'Parameters of type "entity" take "player", "picked" (inside a forEach loop), "tag:<tag>" or "id:<object id>"; an object name works too and is turned into its id.',
            },
            0,
          ),
        );
      case 'list_behaviors':
        return text(
          json(
            behaviorList()
              .filter((b) => !b.hidden)
              .map((b) => ({
                id: b.id,
                name: b.name,
                category: b.category,
                description: b.description,
                settings: b.fields.map((f) => ({ key: f.key, type: f.type, ...(f.options ? { options: f.options.map((o) => o.value) } : {}), ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) })),
                defaults: b.defaults,
                receives: b.inputs.map((s) => s.name),
                sends: b.outputs.map((s) => s.name),
              })),
            0,
          ),
        );
      case 'list_prefabs':
        return text(json(allPrefabs(store.prefabs).map((p) => ({ id: p.id, label: p.label, group: p.group, about: p.hint })), 0));
      case 'read_script': {
        const src = store.scripts.get(String(input.name));
        if (src === undefined) return { isError: true, content: `There is no script called "${String(input.name)}". The scripts are: ${[...store.scripts.keys()].join(', ') || '(none yet)'}.` };
        const problems = store.state.scriptProblems.filter((p) => p.script === input.name).map((p) => `line ${p.line}: ${p.message}`);
        return text(`${src}${problems.length ? `\n\n// Compile problems:\n${problems.map((p) => `// ${p}`).join('\n')}` : ''}`);
      }
      case 'scripting_reference':
        return text(`// Scripts are TypeScript files. defineScript is available without importing anything.\n${apiSource.replace(/^export /gm, '')}\ndeclare function defineScript(def: ScriptDef): ScriptDef;\n`);
      case 'get_problems': {
        const doc = requireDoc();
        const pc = store.state.projectCheck;
        return text(
          json({
            scene: sceneProblems(doc),
            scripts: store.state.scriptProblems,
            ...(pc ? { wholeProject: { checkedAt: new Date(pc.at).toISOString(), problems: pc.problems.map((p) => ({ severity: p.severity, scene: p.scene, message: p.message })) } } : { wholeProject: 'not checked yet' }),
            ...(store.state.runtimeError ? { lastGameCrash: store.state.runtimeError.headline } : {}),
          }),
        );
      }
      case 'run_puzzle_check': {
        const doc = requireDoc();
        const issues = store.runAnalysis(input.deep === true);
        return text(
          json({
            deep: input.deep === true,
            issues: issues.map((i) => ({ severity: i.severity, message: i.message, ...(i.entity ? { object: label(doc.getEntity(i.entity) ?? { name: '?', id: i.entity }) } : {}) })),
            summary: issues.length === 0 ? 'No bypasses, unreachable goals or stuck crates found.' : `${issues.length} thing(s) to look at.`,
          }),
        );
      }
      case 'run_playbot':
        return await playbot(input.mode as 'walk_to_goal' | 'solve_to_goal');
      case 'screenshot': {
        if (store.state.mode === 'play') return { isError: true, content: 'A screenshot is only available while the editor is not running the game.' };
        const png = await viewportRef.current?.screenshot();
        if (!png) return { isError: true, content: 'The viewport is not visible right now (the Code or Sprites workspace may be open), so no screenshot could be taken.' };
        return { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }, { type: 'text', text: 'The editor viewport right now.' }] };
      }
      case 'read_project_notes': {
        const notes = await readNotes();
        return text(notes.trim() ? notes : '(The project notes file is empty or does not exist yet.)');
      }
      default: {
        const story = await runStoryRead(name, input);
        return story ?? { isError: true, content: `"${name}" is not a reading tool.` };
      }
    }
  } catch (e) {
    if (e instanceof ToolProblem) return { isError: true, content: e.message };
    throw e;
  }
}

// ---------- changing (every one of these is previewed first) ----------

type Settings = Record<string, Record<string, unknown>>;

/** Apply `settings` (component or behaviour id -> fields) to an object's components, checking the names. */
function applySettings(e: { name: string; components: Record<string, unknown> }, settings: Settings | undefined): void {
  for (const [id, fields] of Object.entries(settings ?? {})) {
    const def = getBehavior(id);
    if (def && e.components[id] === undefined) attachBehavior(e.components, id);
    const cur = e.components[id];
    if (cur === undefined) fail(`"${e.name}" has no component or behaviour "${id}". Add it with add_behaviors first (ids are in list_behaviors).`);
    if (def) {
      const known = new Set(Object.keys(def.defaults));
      for (const k of Object.keys(fields)) if (!known.has(k)) fail(`The ${def.name} behaviour ("${id}") has no setting "${k}". Its settings are: ${[...known].join(', ') || '(none)'}.`);
    }
    e.components[id] = { ...(cur as object), ...fields };
  }
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

function placeObjects(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const list = input.objects as { prefab: string; x: number; y: number; h?: number; name?: string; tags?: string[]; facing?: number; settings?: Settings }[];
  const prefabs = allPrefabs(store.prefabs);
  const items: Omit<EntityData, 'id'>[] = [];
  const lines: string[] = [];
  for (const o of list) {
    const p = prefabs.find((x) => x.id === o.prefab) ?? prefabs.find((x) => x.label.toLowerCase() === o.prefab.toLowerCase());
    if (!p) fail(`There is no prefab "${o.prefab}". Use an id from list_prefabs.`);
    if (!doc.map.inBounds(Math.floor(o.x), Math.floor(o.y))) fail(`(${o.x}, ${o.y}) is outside the map (${doc.map.width} x ${doc.map.height}).`);
    if (p!.id === 'player' && doc.entities.some((e) => e.tags.includes('player'))) fail('The scene already has a player start. Use update_objects with move_to to move it.');
    const data = p!.make(o.x, o.y, o.h ?? doc.map.getHeight(Math.floor(o.x), Math.floor(o.y)));
    if (o.name) data.name = o.name;
    if (o.tags) data.tags = [...o.tags];
    if (o.facing !== undefined) (data.components.transform as { facing: number }).facing = o.facing;
    applySettings(data, o.settings);
    items.push(data);
    lines.push(`Place ${p!.label}${o.name ? ` "${o.name}"` : ''} at (${fmt(o.x)}, ${fmt(o.y)})${o.settings ? `, settings: ${Object.entries(o.settings).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join('; ')}` : ''}`);
  }
  const undoLabel = `Claude: place ${items.length} object${items.length === 1 ? '' : 's'}`;
  return {
    tool: 'place_objects',
    title: `Place ${items.length} object${items.length === 1 ? '' : 's'}`,
    lines,
    async apply() {
      const added = doc.addEntities(items, undoLabel);
      store.select(added.map((a) => a.id));
      return `Placed ${added.length} object(s): ${added.map(label).join(', ')}.`;
    },
    undo: undoTop(doc, items.length > 1 ? `${undoLabel} (${items.length})` : undoLabel),
  };
}

function updateObjects(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const updates = input.updates as { target: string; name?: string; tags?: string[]; move_to?: { x: number; y: number; h?: number }; settings?: Settings; add_behaviors?: string[]; remove_behaviors?: string[] }[];
  const steps: { id: string; mutate(e: EntityData): void }[] = [];
  const lines: string[] = [];
  for (const u of updates) {
    const e = resolveTarget(doc, u.target);
    const mutate = (x: EntityData): void => {
      if (u.name !== undefined) x.name = u.name;
      if (u.tags) x.tags = [...u.tags];
      if (u.move_to) {
        const t = x.components.transform as { x: number; y: number; h: number } | undefined;
        if (!t) fail(`${label(x)} has no position.`);
        if (!doc.map.inBounds(Math.floor(u.move_to.x), Math.floor(u.move_to.y))) fail(`(${u.move_to.x}, ${u.move_to.y}) is outside the map.`);
        t!.x = u.move_to.x;
        t!.y = u.move_to.y;
        t!.h = u.move_to.h ?? doc.map.getHeight(Math.floor(u.move_to.x), Math.floor(u.move_to.y));
      }
      for (const b of u.add_behaviors ?? []) {
        if (!isBehavior(b)) fail(`"${b}" is not a behaviour. Use an id from list_behaviors.`);
        attachBehavior(x.components, b);
      }
      for (const b of u.remove_behaviors ?? []) {
        if (!isBehavior(b)) fail(`"${b}" is not a behaviour, so it cannot be removed this way.`);
        detachBehavior(x.components, b);
      }
      applySettings(x, u.settings);
    };
    mutate(structuredClone(e)); // dry run: report mistakes now, not when the person clicks Apply
    steps.push({ id: e.id, mutate });
    const bits = [
      u.name !== undefined ? `rename to "${u.name}"` : '',
      u.tags ? `tags: ${u.tags.join(', ') || '(none)'}` : '',
      u.move_to ? `move to (${fmt(u.move_to.x)}, ${fmt(u.move_to.y)})` : '',
      u.add_behaviors?.length ? `add ${u.add_behaviors.join(', ')}` : '',
      u.remove_behaviors?.length ? `remove ${u.remove_behaviors.join(', ')}` : '',
      u.settings ? Object.entries(u.settings).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('; ') : '',
    ].filter(Boolean);
    lines.push(`${label(e)}: ${bits.join('; ') || 'no change'}`);
  }
  const undoLabel = `Claude: change ${steps.length} object${steps.length === 1 ? '' : 's'}`;
  return {
    tool: 'update_objects',
    title: `Change ${steps.length} object${steps.length === 1 ? '' : 's'}`,
    lines,
    async apply() {
      doc.history.batch(undoLabel, () => {
        for (const s of steps) doc.updateEntities([s.id], undoLabel, s.mutate);
      });
      return `Changed ${steps.length} object(s).`;
    },
    undo: undoTop(doc, undoLabel),
  };
}

function deleteObjects(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const targets = [...new Set((input.targets as string[]).map((t) => resolveTarget(doc, t)))];
  const ids = targets.map((t) => t.id);
  const wires = doc.wires.filter((w) => ids.includes(w.from.entity) || ids.includes(w.to.entity)).length;
  const undoLabel = `Claude: delete ${targets.length} object${targets.length === 1 ? '' : 's'}`;
  return {
    tool: 'delete_objects',
    title: `Delete ${targets.length} object${targets.length === 1 ? '' : 's'}`,
    lines: [...targets.map((t) => `Delete ${label(t)}`), ...(wires > 0 ? [`(${wires} wire${wires === 1 ? '' : 's'} attached to them go too)`] : [])],
    async apply() {
      doc.removeEntities(ids, undoLabel);
      return `Deleted ${ids.length} object(s).`;
    },
    undo: undoTop(doc, targets.length > 1 ? `${undoLabel} (${targets.length})` : undoLabel),
  };
}

function paintTiles(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const rects = input.rects as { x: number; y: number; w: number; h: number; tile?: number; height?: number; slope?: number; flags?: number }[];
  const legend = tileLegend();
  let cells = 0;
  const lines: string[] = [];
  for (const r of rects) {
    if (r.x + r.w > doc.map.width || r.y + r.h > doc.map.height) fail(`The rectangle at (${r.x}, ${r.y}) of ${r.w} x ${r.h} goes outside the map (${doc.map.width} x ${doc.map.height}).`);
    if (r.tile !== undefined && !legend.some((t) => t.id === r.tile)) fail(`There is no tile ${r.tile}. Tiles: ${legend.map((t) => `${t.id}=${t.name}`).join(', ')}.`);
    cells += r.w * r.h;
    const what = [r.tile !== undefined ? `tile ${legend.find((t) => t.id === r.tile)?.name}` : '', r.height !== undefined ? `height ${r.height}` : '', r.slope !== undefined ? `slope ${r.slope}` : '', r.flags !== undefined ? `flags ${r.flags}` : ''].filter(Boolean);
    if (what.length === 0) fail('A rectangle changes nothing: give at least one of tile, height, slope or flags.');
    lines.push(`Paint ${r.w} x ${r.h} cells at (${r.x}, ${r.y}): ${what.join(', ')}`);
  }
  if (cells > 4096) fail('That is more than 4,096 cells in one go. Do it in smaller steps.');
  const undoLabel = `Claude: paint ${cells} cell${cells === 1 ? '' : 's'}`;
  return {
    tool: 'paint_tiles',
    title: `Paint ${cells} map cell${cells === 1 ? '' : 's'}`,
    lines,
    async apply() {
      const edits: { x: number; y: number; patch: Partial<{ tile: number; height: number; slope: number; flags: number }> }[] = [];
      for (const r of rects) {
        const patch = { ...(r.tile !== undefined ? { tile: r.tile } : {}), ...(r.height !== undefined ? { height: r.height } : {}), ...(r.slope !== undefined ? { slope: r.slope } : {}), ...(r.flags !== undefined ? { flags: r.flags } : {}) };
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) edits.push({ x, y, patch });
      }
      const changed = doc.paint(undoLabel, edits);
      return `Painted ${cells} cell(s); ${changed} actually changed.`;
    },
    undo: undoTop(doc, undoLabel),
  };
}

function signalNames(e: EntityData, dir: 'inputs' | 'outputs'): string[] {
  return behavioursOf(e).flatMap((id) => (getBehavior(id)?.[dir] ?? []).map((s) => s.name));
}

function wireEnds(doc: EditorDoc, w: { from: string; output: string; to: string; input: string }): { from: EntityData; to: EntityData } {
  const from = resolveTarget(doc, w.from);
  const to = resolveTarget(doc, w.to);
  const outs = signalNames(from, 'outputs');
  const ins = signalNames(to, 'inputs');
  if (!outs.includes(w.output)) fail(`${label(from)} cannot send "${w.output}". Its signals: ${outs.join(', ') || '(it sends none - does it have the right behaviour?)'}.`);
  if (!ins.includes(w.input)) fail(`${label(to)} cannot receive "${w.input}". Its inputs: ${ins.join(', ') || '(it receives none - does it have the right behaviour?)'}.`);
  return { from, to };
}

function connectWires(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const wires = input.wires as { from: string; output: string; to: string; input: string }[];
  const planned = wires.map((w) => {
    const { from, to } = wireEnds(doc, w);
    return { from: { entity: from.id, output: w.output }, to: { entity: to.id, input: w.input } as WireData['to'], text: `Wire ${label(from)}.${w.output} -> ${label(to)}.${w.input}` };
  });
  const undoLabel = `Claude: connect ${planned.length} wire${planned.length === 1 ? '' : 's'}`;
  return {
    tool: 'connect_wires',
    title: `Connect ${planned.length} wire${planned.length === 1 ? '' : 's'}`,
    lines: planned.map((p) => p.text),
    async apply() {
      let made = 0;
      doc.history.batch(undoLabel, () => {
        for (const p of planned) if (doc.addWire(p.from, p.to)) made++;
      });
      return `Connected ${made} wire(s)${made < planned.length ? ` (${planned.length - made} already existed)` : ''}.`;
    },
    undo: undoTop(doc, undoLabel),
  };
}

function removeWires(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const found: WireData[] = [];
  const lines: string[] = [];
  for (const w of input.wires as { from: string; output: string; to: string; input: string }[]) {
    const from = resolveTarget(doc, w.from);
    const to = resolveTarget(doc, w.to);
    const wire = doc.wires.find((x) => x.from.entity === from.id && x.from.output === w.output && x.to.entity === to.id && x.to.input === w.input);
    if (!wire) fail(`There is no wire from ${label(from)}.${w.output} to ${label(to)}.${w.input}. scene_summary lists the wires.`);
    found.push(wire!);
    lines.push(`Remove wire ${label(from)}.${w.output} -> ${label(to)}.${w.input}`);
  }
  const undoLabel = `Claude: remove ${found.length} wire${found.length === 1 ? '' : 's'}`;
  return {
    tool: 'remove_wires',
    title: `Remove ${found.length} wire${found.length === 1 ? '' : 's'}`,
    lines,
    async apply() {
      doc.history.batch(undoLabel, () => {
        for (const w of found) doc.removeWire(w.id);
      });
      return `Removed ${found.length} wire(s).`;
    },
    undo: undoTop(doc, undoLabel),
  };
}

// ----- event sheets -----

interface RowInput {
  comment?: string;
  mode?: 'all' | 'any';
  once?: boolean;
  forEach?: string;
  repeat?: number;
  enabled?: boolean;
  conditions: { type: string; params?: Record<string, unknown>; negate?: boolean }[];
  actions: { type: string; params?: Record<string, unknown> }[];
  children?: RowInput[];
}

/** An object reference as the editor stores it: a name becomes "id:<id>" so renaming the object does not break the row. */
function normaliseRef(doc: EditorDoc, ref: string): string {
  if (ref === '' || ref === 'player' || ref === 'picked' || ref.startsWith('tag:') || ref.startsWith('id:')) return ref;
  const name = ref.startsWith('name:') ? ref.slice(5) : ref;
  const hits = doc.entities.filter((e) => e.name === name);
  if (hits.length === 1) return `id:${hits[0]!.id}`;
  if (hits.length > 1) return fail(`Several objects are called "${name}" (${hits.map((h) => h.id).join(', ')}); use "id:<id>" in the event sheet.`);
  return fail(`The event sheet refers to "${ref}", but no object has that name. Use "player", "tag:<tag>", "id:<id>" or the exact name of an object that exists.`);
}

function buildParams(doc: EditorDoc, kind: 'condition' | 'action', type: string, given: Record<string, unknown> | undefined): Record<string, unknown> {
  const def = kind === 'condition' ? conditionDef(type) : actionDef(type);
  if (!def) return fail(`There is no ${kind} "${type}". list_event_blocks has every id.`);
  const params = kind === 'condition' ? newCondition(type).params : newAction(type).params;
  for (const [k, v] of Object.entries(given ?? {})) {
    const spec = def.params.find((p) => p.key === k);
    if (!spec) fail(`The ${kind} "${type}" has no parameter "${k}". Its parameters: ${def.params.map((p) => p.key).join(', ') || '(none)'}.`);
    if (spec!.type === 'select' && spec!.options && !spec!.options.some((o) => o.value === String(v))) fail(`"${String(v)}" is not an option for "${k}" of ${kind} "${type}". Options: ${spec!.options.map((o) => o.value).join(', ')}.`);
    params[k] = spec!.type === 'entity' ? normaliseRef(doc, String(v)) : v;
  }
  return params;
}

function buildRow(doc: EditorDoc, r: RowInput): EventRow {
  return {
    id: doc.newId('r'),
    enabled: r.enabled ?? true,
    comment: r.comment ?? '',
    mode: r.mode ?? 'all',
    once: r.once ?? false,
    forEach: r.forEach ? normaliseRef(doc, r.forEach) : '',
    repeat: r.repeat ?? 1,
    conditions: r.conditions.length > 0 ? r.conditions.map((c) => ({ type: c.type, params: buildParams(doc, 'condition', c.type, c.params), negate: c.negate ?? false })) : [newCondition('always')],
    actions: r.actions.map((a) => ({ type: a.type, params: buildParams(doc, 'action', a.type, a.params) })),
    children: (r.children ?? []).map((c) => buildRow(doc, c)),
  };
}

function setEventSheet(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const rows = (input.rows as RowInput[]).map((r) => buildRow(doc, r));
  const variables = input.variables as { name: string; value: number | string | boolean }[] | undefined;
  const n = names(doc);
  const before = rowText(doc.events, n).join('\n');
  const after = rowText(rows, n).join('\n');
  const problems = checkSheet(rows, { ...eventFacts(doc), variables: new Set((variables ?? doc.variables).map((v) => v.name)) }, n).map((p) => p.text);
  const undoLabel = 'Claude: change the event sheet';
  const lines = [`The event sheet goes from ${doc.events.length} row${doc.events.length === 1 ? '' : 's'} to ${rows.length}.`, ...(variables ? [`Scene variables: ${variables.map((v) => `${v.name} = ${v.value}`).join(', ') || '(none)'}`] : []), ...problems.map((p) => `Warning: ${p}`)];
  return {
    tool: 'set_event_sheet',
    title: 'Change the event sheet',
    lines,
    diff: { name: 'Event sheet', lines: lineDiff(before, after) },
    async apply() {
      doc.history.batch(undoLabel, () => {
        doc.setEvents(undoLabel, rows);
        if (variables) doc.setVariables(undoLabel, variables);
      });
      return `The event sheet now has ${rows.length} row(s).${problems.length ? ` The sheet checker still reports: ${problems.join(' | ')}` : ' The sheet checker found no problems.'}`;
    },
    undo: undoTop(doc, undoLabel),
  };
}

type RowOperation = { op: 'add'; row: RowInput; after?: string } | { op: 'update'; id: string; row: Partial<RowInput> } | { op: 'remove'; id: string };

/** Add, change and remove single rows of the event sheet. */
function editEventRows(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const ops = input.operations as RowOperation[];
  let rows = structuredClone(doc.events) as EventRow[];
  const index = (id: string): number => {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) fail(`There is no top-level row with the id "${id}". The rows are: ${rows.map((r) => r.id).join(', ') || '(none)'} (get_event_sheet shows them).`);
    return i;
  };
  const lines: string[] = [];
  for (const op of ops) {
    if (op.op === 'add') {
      const row = buildRow(doc, op.row);
      if (op.after === undefined || op.after === 'end') rows.push(row);
      else if (op.after === 'start') rows.unshift(row);
      else rows.splice(index(op.after) + 1, 0, row);
      lines.push(`Add a row${op.row.comment ? ` ("${op.row.comment}")` : ''}`);
    } else if (op.op === 'update') {
      const at = index(op.id);
      const r = rows[at]!;
      const patch = op.row;
      if (patch.comment !== undefined) r.comment = patch.comment;
      if (patch.mode !== undefined) r.mode = patch.mode;
      if (patch.once !== undefined) r.once = patch.once;
      if (patch.forEach !== undefined) r.forEach = patch.forEach ? normaliseRef(doc, patch.forEach) : '';
      if (patch.repeat !== undefined) r.repeat = patch.repeat;
      if (patch.enabled !== undefined) r.enabled = patch.enabled;
      if (patch.conditions) r.conditions = patch.conditions.length > 0 ? patch.conditions.map((c) => ({ type: c.type, params: buildParams(doc, 'condition', c.type, c.params), negate: c.negate ?? false })) : [newCondition('always')];
      if (patch.actions) r.actions = patch.actions.map((a) => ({ type: a.type, params: buildParams(doc, 'action', a.type, a.params) }));
      if (patch.children) r.children = patch.children.map((c) => buildRow(doc, c));
      lines.push(`Change the row ${op.id}`);
    } else {
      rows.splice(index(op.id), 1);
      lines.push(`Remove the row ${op.id}`);
    }
  }
  rows = rows.map((r) => r);
  const n = names(doc);
  const before = rowText(doc.events, n).join('\n');
  const after = rowText(rows, n).join('\n');
  const problems = checkSheet(rows, eventFacts(doc), n).map((p) => p.text);
  const undoLabel = 'Claude: edit event rows';
  return {
    tool: 'edit_event_rows',
    title: 'Edit event rows',
    lines: [...lines, ...problems.map((p) => `Warning: ${p}`)],
    diff: { name: 'Event sheet', lines: lineDiff(before, after) },
    async apply() {
      doc.setEvents(undoLabel, rows);
      return `The event sheet now has ${rows.length} row(s).${problems.length ? ` The sheet checker still reports: ${problems.join(' | ')}` : ' The sheet checker found no problems.'}`;
    },
    undo: undoTop(doc, undoLabel),
  };
}

/** Turn an object into a prefab. */
function createPrefab(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const e = resolveTarget(doc, String(input.object));
  const name = String(input.name).trim();
  const bad = prefabNameProblem(name, store.state.prefabNames);
  if (bad) fail(bad);
  const undoLabel = `Make prefab "${name}"`;
  return {
    tool: 'create_prefab',
    title: `Make the prefab "${name}"`,
    lines: [`Turn ${label(e)} into the prefab "${name}"; it becomes the first instance. Objects made from the prefab follow it except for settings changed on them.`],
    async apply() {
      const ok = await store.createPrefab(e.id, name);
      return ok ? `Made the prefab "${name}" from ${label(e)}. place_objects can now place it with prefab "${name}".` : fail('The prefab could not be made (the Problems panel or a toast says why).');
    },
    async undo() {
      if (store.doc !== doc || doc.history.undoLabel !== undoLabel) return false;
      doc.undo();
      await store.removePrefab(name);
      return true;
    },
  };
}

// ----- scripts and notes -----

function writeScript(input: Record<string, unknown>): Proposal {
  requireDoc();
  const name = String(input.name).trim();
  const source = String(input.source);
  const bad = storyNameProblem(name, [], 'script');
  if (bad) fail(bad);
  const previous = store.scripts.get(name);
  const body = source.endsWith('\n') ? source : `${source}\n`;
  return {
    tool: 'write_script',
    title: previous === undefined ? `New script "${name}"` : `Change the script "${name}"`,
    lines: [previous === undefined ? `Create assets/scripts/${name}.script.ts (it becomes the behaviour script_${name.replace(/[^A-Za-z0-9]+/g, '_')})` : `Replace the source of assets/scripts/${name}.script.ts`],
    diff: { name: `${name}.script.ts`, lines: lineDiff(previous ?? '', body) },
    async apply() {
      if (previous === undefined) await store.newScript(name, body);
      else {
        store.putScript(name, body);
        await store.flushScripts();
        await store.recompileScripts();
      }
      const problems = store.state.scriptProblems.filter((p) => p.script === name);
      return problems.length === 0 ? `Saved "${name}". It compiles with no problems.` : `Saved "${name}", but it has problems:\n${problems.map((p) => `line ${p.line}: ${p.message}`).join('\n')}\nFix them with another write_script.`;
    },
    async undo() {
      if (previous === undefined) await store.removeScript(name);
      else {
        store.putScript(name, previous);
        await store.flushScripts();
        await store.recompileScripts();
      }
      return true;
    },
  };
}

function writeProjectNotes(input: Record<string, unknown>): Proposal {
  if (!store.state.project) fail('No project is open.');
  const next = String(input.text);
  return {
    tool: 'write_project_notes',
    title: 'Change the project notes',
    lines: [`Update ${NOTES_FILE}, which Claude reads at the start of every conversation.`],
    diff: { name: NOTES_FILE, lines: [] }, // filled in by prepareAction (needs the current file)
    async apply() {
      await writeNotes(next);
      return 'Saved the project notes.';
    },
  };
}

/** Check an action tool call and prepare its preview. Throws a ToolProblem for mistakes Claude can fix. */
export async function prepareAction(name: string, input: Record<string, unknown>): Promise<Proposal> {
  switch (name) {
    case 'place_objects':
      return placeObjects(input);
    case 'update_objects':
      return updateObjects(input);
    case 'delete_objects':
      return deleteObjects(input);
    case 'paint_tiles':
      return paintTiles(input);
    case 'connect_wires':
      return connectWires(input);
    case 'remove_wires':
      return removeWires(input);
    case 'set_event_sheet':
      return setEventSheet(input);
    case 'edit_event_rows':
      return editEventRows(input);
    case 'create_prefab':
      return createPrefab(input);
    case 'write_script':
      return writeScript(input);
    case 'write_project_notes': {
      const p = writeProjectNotes(input);
      const before = await readNotes();
      const prev = before;
      p.diff = { name: NOTES_FILE, lines: lineDiff(before, String(input.text)) };
      p.undo = async () => {
        await writeNotes(prev);
        return true;
      };
      return p;
    }
    default: {
      const story = await prepareStoryAction(name, input);
      return story ?? fail(`"${name}" is not a tool that changes the project.`);
    }
  }
}

export { describeAction, describeCondition };
