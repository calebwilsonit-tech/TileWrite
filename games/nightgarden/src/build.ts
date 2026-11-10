import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentFlags, stringifyScene, stringifyUiDoc, type ProjectData } from '@tilewright/runtime';
import { baseProject } from '@tilewright/behaviors';
import { projectText } from '../../../packages/editor/src/renderer/project/io';
import { parseRoom, type Room, type RoomDef } from './model';
import { roomScene, scenePath } from './scene';
import { roomsTable, screensDoc, uiLayout } from './ui/screens';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR = path.resolve(HERE, '..', 'project');

export interface Chapter {
  id: string;
  name: string;
  /** The line on the chapter's card. */
  line: string;
  rooms: RoomDef[];
}

/** The plugins the game needs: lights, darkness and shadows, and a camera that holds still on the room. Everything else is its own scripts. */
export const PLUGINS = ['lighting', 'room-camera'];

const ART = path.resolve(HERE, '..', 'art', 'out');

/** The ground tiles as the tile studio sent them to the palette (art/out/tiles.json), under the ids the scenes use. */
function tileset(): ProjectData['tileset'] {
  const made = JSON.parse(fs.readFileSync(path.join(ART, 'tiles.json'), 'utf8')) as (ProjectData['tileset'][number] & { want: number })[];
  return made
    .map(({ want, ...t }) => ({ ...t, id: want, ...(t.name === 'hedge' ? { wall: true } : {}) }))
    .sort((a, b) => a.id - b.id);
}

/** Write the whole game project into `dir` from the room lists. Returns the parsed rooms in play order. */
export function buildProject(chapters: Chapter[], dir = PROJECT_DIR): { rooms: Room[]; dir: string } {
  const rooms: { room: Room; chapter: Chapter }[] = [];
  for (const c of chapters) for (const def of c.rooms) rooms.push({ room: parseRoom(def), chapter: c });
  const ids = new Set<string>();
  for (const { room } of rooms) {
    if (ids.has(room.id)) throw new Error(`Two rooms share the id ${room.id}.`);
    ids.add(room.id);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const write = (rel: string, text: string): void => {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  };
  const project: ProjectData = {
    ...baseProject('Nightgarden', PLUGINS),
    tileset: tileset(),
    scenes: rooms.map(({ room }) => scenePath(room.id)),
    startScene: scenePath(rooms[0]!.room.id),
    title: { enabled: true, subtitle: 'A puzzle garden by lamplight' },
    compat: currentFlags(),
  };
  write('project.json', projectText(project));
  write('.gitignore', '.tilewright/\nsaves/\nlogs/\n');
  const flyTotal = rooms.filter(({ room }) => room.things.some((t) => t.kind === 'firefly')).length;
  rooms.forEach(({ room, chapter }, i) => {
    const next = rooms[i + 1]?.room;
    const opts = { next: next ? scenePath(next.id) : '', index: i + 1, chapter: chapter.name, chapterNo: chapters.indexOf(chapter) + 1, chapterLine: chapter.line, chapters: chapters.length, total: rooms.length, flyTotal };
    write(scenePath(room.id), stringifyScene(roomScene(room, opts)));
  });
  // the interface: its theme, its screens, the table the Rooms screen shows, and the game's own button (R)
  const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';
  write('assets/ui.json', json(uiLayout()));
  write('assets/screens.json', stringifyUiDoc(screensDoc()));
  write('assets/tables/Rooms.table.json', json(roomsTable(rooms.map(({ room, chapter }, i) => ({ id: room.id, no: i + 1, name: room.name, chapter: chapter.name, scene: scenePath(room.id) })))));
  write('assets/input.json', json({ schemaVersion: 1, overrides: {}, actions: [{ id: 'restart', label: 'Start the room again', bindings: ['key:KeyR', 'pad:button2'] }] }));
  // the pictures, exactly as the sprite studio and the tile studio saved them
  for (const f of fs.readdirSync(path.join(ART, 'sprites'))) if (f.endsWith('.sprite.json')) write(`assets/sprites/${f}`, fs.readFileSync(path.join(ART, 'sprites', f), 'utf8'));
  const scripts = path.join(HERE, 'scripts');
  const rule = /\/\* LIGHT-RULE-BEGIN \*\/\n([\s\S]*?)\/\* LIGHT-RULE-END \*\//.exec(fs.readFileSync(path.join(HERE, 'light.ts'), 'utf8'))?.[1];
  if (!rule) throw new Error('src/light.ts has lost its LIGHT-RULE marks.');
  for (const f of fs.readdirSync(scripts)) if (f.endsWith('.script.ts')) write(`assets/scripts/${f}`, fs.readFileSync(path.join(scripts, f), 'utf8').replace('/*__LIGHT_RULE__*/', rule.trim()));
  return { rooms: rooms.map((r) => r.room), dir };
}
