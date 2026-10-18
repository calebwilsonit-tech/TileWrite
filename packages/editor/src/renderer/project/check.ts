import { checkDialogue, checkProjectInput, checkUiLayout, type ProjectInput, type UiLayout } from '@tilewright/runtime';
import { checkCutscene, checkMinigame, checkMixer, checkWorldMap, expandEntities, type WorldMapData, type MixerData, type MinigameData, type SkinData, type CutsceneData, type DialogueData, type LanguageData, type EventRow, type ItemData, type PrefabData, type ProjectData, type SceneData, type TableData } from '@tilewright/runtime';
import { analyseLevel, analysePushPuzzles } from '@tilewright/playbot';
import { EditorDoc } from '../model/doc';
import { validateScene } from '../model/validate';
import { madeVariables, storyVariables } from '../model/story-vars';
import { loadScene, type ProjectFs } from './io';
import { checkRules, missingTiles, ownTiles, tileArtProblems } from './tiles';
import { collectStrings, coverage, interfaceTexts } from './localization';
import { skinProblems } from './story';

export interface ProjectProblem {
  id: string;
  severity: 'error' | 'warning';
  /** Scene file the problem is in ("" for project-wide things such as dialogues). */
  scene: string;
  message: string;
  entity?: string;
  x?: number;
  y?: number;
}

export interface StoryData {
  items: readonly ItemData[];
  dialogues: ReadonlyMap<string, DialogueData>;
  cutscenes: ReadonlyMap<string, CutsceneData>;
}

const POINT = /^\s*-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?\s*$/;

function* allRows(rows: readonly EventRow[]): Generator<EventRow> {
  for (const r of rows) {
    yield r;
    yield* allRows(r.children);
  }
}

/**
 * Everything wrong with a project, in one list: each scene's own problems, puzzles that can be bypassed or
 * soft-locked, doors that lead nowhere, characters and cutscenes that name things that do not exist, and the
 * dialogues and cutscenes themselves. Run before export.
 */
export async function checkProject(
  fs: ProjectFs,
  dir: string,
  project: ProjectData,
  prefabs: ReadonlyMap<string, PrefabData>,
  story: StoryData,
  spriteNames: ReadonlySet<string> = new Set(),
  soundNames?: ReadonlySet<string>,
  languages: readonly LanguageData[] = [],
  skins: readonly SkinData[] = [],
  minigames: readonly MinigameData[] = [],
  mixer?: MixerData,
  worldMap?: WorldMapData | null,
  extras: { input?: ProjectInput; layout?: UiLayout; tables?: readonly TableData[] } = {},
): Promise<ProjectProblem[]> {
  const out: ProjectProblem[] = [];
  const scenes = new Map<string, SceneData>();
  for (const path of project.scenes) {
    try {
      scenes.set(path, await loadScene(fs, dir, path));
    } catch (e) {
      out.push({ id: `scene-unreadable-${path}`, severity: 'error', scene: path, message: e instanceof Error ? e.message : `The scene "${path}" could not be opened.` });
    }
  }
  if (!project.scenes.includes(project.startScene)) {
    out.push({ id: 'start-scene', severity: 'error', scene: '', message: `The project starts in "${project.startScene}", which is not one of its scenes. Pick a starting scene.` });
  }
  const tiles = ownTiles(project);
  for (const text of checkRules(tiles, project.autotile)) out.push({ id: `autotile:${text}`, severity: 'warning', scene: '', message: `Autotiling: ${text}` });
  const itemIds = new Set(story.items.map((i) => i.id));
  const prefabNames = new Set(prefabs.keys());
  const tables = extras.tables ?? [];
  const minigameNames = new Set(minigames.map((m) => m.name));

  for (const [path, scene] of scenes) {
    const doc = EditorDoc.fromScene(scene, prefabs);
    const lost = missingTiles(doc.map.tiles, tiles);
    if (lost.length > 0) out.push({ id: `${path}:tiles-missing`, severity: 'warning', scene: path, message: `This scene uses tile number ${lost.join(', ')}, which is not in the tile list any more, so it is drawn as a magenta square. Paint over those cells or run Autotiling -> Save and apply.` });
    for (const p of validateScene(doc, spriteNames, prefabNames, new Set([...storyVariables(story.dialogues, story.cutscenes), ...madeVariables(doc.entities, prefabs.values(), tables)]), soundNames)) {
      out.push({ id: `${path}:${p.id}`, severity: p.severity, scene: path, message: p.message, entity: p.target?.kind === 'entity' ? p.target.id : undefined, x: p.target?.x, y: p.target?.y });
    }
    for (const i of [...analyseLevel(scene, prefabs), ...analysePushPuzzles(scene, prefabs)]) {
      out.push({ id: `${path}:${i.id}`, severity: i.severity, scene: path, message: i.message, entity: i.entity, x: i.x, y: i.y });
    }
    const { entities } = expandEntities(scene.entities, prefabs);
    const at = (e: { components: Record<string, unknown> }): { x?: number; y?: number } => {
      const t = e.components.transform as { x: number; y: number } | undefined;
      return t ? { x: Math.floor(t.x), y: Math.floor(t.y) } : {};
    };
    for (const e of entities) {
      const portal = e.components.portal as { scene?: string; spawn?: string } | undefined;
      if (portal) {
        const dest = portal.scene || path;
        const spawn = portal.spawn ?? '';
        if (!portal.scene && spawn === '') {
          out.push({ id: `${path}:portal-nowhere-${e.id}`, severity: 'warning', scene: path, entity: e.id, ...at(e), message: `The portal "${e.name}" has no destination: choose a scene or a place to appear at.` });
        } else if (!project.scenes.includes(dest)) {
          out.push({ id: `${path}:portal-scene-${e.id}`, severity: 'error', scene: path, entity: e.id, ...at(e), message: `The portal "${e.name}" leads to the scene "${dest}", which is not part of this project.` });
        } else if (spawn !== '' && !POINT.test(spawn)) {
          const target = scenes.get(dest);
          if (target && !expandEntities(target.entities, prefabs).entities.some((x) => x.name === spawn)) {
            out.push({ id: `${path}:portal-spawn-${e.id}`, severity: 'warning', scene: path, entity: e.id, ...at(e), message: `The portal "${e.name}" sends the player to "${spawn}" in ${dest}, but there is no object with that name there, so they will appear at that scene's player start.` });
          }
        }
      }
      const npc = e.components.npcTalk as { dialogue?: string } | undefined;
      if (npc) {
        if (!npc.dialogue) out.push({ id: `${path}:npc-empty-${e.id}`, severity: 'warning', scene: path, entity: e.id, ...at(e), message: `"${e.name}" has no conversation chosen, so talking to it does nothing.` });
        else if (!story.dialogues.has(npc.dialogue)) out.push({ id: `${path}:npc-missing-${e.id}`, severity: 'error', scene: path, entity: e.id, ...at(e), message: `"${e.name}" talks using the dialogue "${npc.dialogue}", which does not exist (check the Story panel).` });
      }
      const station = e.components.minigameStation as { minigame?: string } | undefined;
      if (station) {
        if (!station.minigame) out.push({ id: `${path}:mg-empty-${e.id}`, severity: 'warning', scene: path, entity: e.id, ...at(e), message: `"${e.name}" has no minigame chosen, so using it does nothing.` });
        else if (!minigameNames.has(station.minigame)) out.push({ id: `${path}:mg-missing-${e.id}`, severity: 'error', scene: path, entity: e.id, ...at(e), message: `"${e.name}" plays the minigame "${station.minigame}", which does not exist (check Story -> Minigames).` });
      }
      const trig = e.components.cutsceneTrigger as { cutscene?: string } | undefined;
      if (trig && (!trig.cutscene || !story.cutscenes.has(trig.cutscene))) {
        out.push({ id: `${path}:cut-missing-${e.id}`, severity: 'error', scene: path, entity: e.id, ...at(e), message: trig.cutscene ? `"${e.name}" plays the cutscene "${trig.cutscene}", which does not exist.` : `"${e.name}" has no cutscene chosen.` });
      }
      const pickup = e.components.pickup as { item?: string } | undefined;
      if (pickup?.item && !itemIds.has(pickup.item)) {
        out.push({ id: `${path}:pickup-item-${e.id}`, severity: 'error', scene: path, entity: e.id, ...at(e), message: `"${e.name}" gives the item "${pickup.item}", which is not in the Items list.` });
      }
    }
    for (const row of allRows(scene.events)) {
      for (const a of row.actions) {
        const p = a.params;
        const name = (k: string): string => String(p[k] ?? '');
        if (a.type === 'startDialogue' && !story.dialogues.has(name('dialogue'))) out.push({ id: `${path}:row-${row.id}-dlg`, severity: 'warning', scene: path, message: `An event row starts the dialogue "${name('dialogue')}", which does not exist.` });
        if (a.type === 'playMinigame' && !minigameNames.has(name('minigame'))) out.push({ id: `${path}:row-${row.id}-mg`, severity: 'warning', scene: path, message: `An event row plays the minigame "${name('minigame')}", which does not exist.` });
        if (a.type === 'playCutscene' && !story.cutscenes.has(name('cutscene'))) out.push({ id: `${path}:row-${row.id}-cut`, severity: 'warning', scene: path, message: `An event row plays the cutscene "${name('cutscene')}", which does not exist.` });
        if ((a.type === 'giveItem' || a.type === 'takeItem') && !itemIds.has(name('item'))) out.push({ id: `${path}:row-${row.id}-item`, severity: 'warning', scene: path, message: `An event row uses the item "${name('item')}", which is not in the Items list.` });
        if (a.type === 'travel' && name('scene') !== '' && !project.scenes.includes(name('scene'))) out.push({ id: `${path}:row-${row.id}-travel`, severity: 'warning', scene: path, message: `An event row goes to the scene "${name('scene')}", which is not part of this project.` });
      }
    }
  }

  if (languages.length > 0) {
    const sources = collectStrings(story, [...scenes].map(([p, scene]) => ({ path: p, scene })), undefined, minigames, interfaceTexts(extras.layout, project));
    for (const l of languages) {
      const c = coverage(l, sources);
      if (c.missing.length > 0) out.push({ id: `language:${l.code}`, severity: 'warning', scene: '', message: `The language ${l.name} is missing ${c.missing.length} of ${c.total} lines (for example "${c.missing[0]!.text}"), so players will see those in the original text. Open Story -> Translations.` });
    }
  }

  const known = { items: itemIds, variables: new Set<string>() };
  for (const [name, d] of story.dialogues) for (const p of checkDialogue(d, known)) out.push({ id: `dialogue:${name}:${p.text}`, severity: 'warning', scene: '', message: `Dialogue "${name}": ${p.text}` });
  const cknown = { dialogues: new Set(story.dialogues.keys()), items: itemIds, ...(soundNames ? { sounds: soundNames } : {}) };
  for (const [name, c] of story.cutscenes) for (const p of checkCutscene(c, cknown)) out.push({ id: `cutscene:${name}:${p.text}`, severity: 'warning', scene: '', message: `Cutscene "${name}": ${p.text}` });
  if (worldMap && worldMap.nodes.length > 0) for (const text of checkWorldMap(worldMap, project.scenes)) out.push({ id: `worldmap:${text}`, severity: 'warning', scene: '', message: `World map: ${text}` });
  if (mixer && soundNames) for (const text of checkMixer(mixer, soundNames)) out.push({ id: `mixer:${text}`, severity: 'warning', scene: '', message: `Mixer: ${text}` });
  for (const m of minigames) for (const text of checkMinigame(m, { items: itemIds })) out.push({ id: `minigame:${m.name}:${text}`, severity: 'warning', scene: '', message: text });
  for (const text of tileArtProblems(tiles, spriteNames)) out.push({ id: `tile-art:${text}`, severity: 'warning', scene: '', message: text });
  if (extras.input) for (const text of checkProjectInput(extras.input)) out.push({ id: `controls:${text}`, severity: 'warning', scene: '', message: `Controls: ${text}` });
  if (extras.layout) for (const text of checkUiLayout(extras.layout)) out.push({ id: `interface:${text}`, severity: 'warning', scene: '', message: `Interface: ${text}` });
  for (const text of skinProblems(skins, { sprites: spriteNames, items: itemIds })) out.push({ id: `skin:${text}`, severity: 'warning', scene: '', message: text });
  return out;
}
