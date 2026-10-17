import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { CURRENT_SCHEMA_VERSION, type VariableValue } from '../project/schema';

/**
 * The world map: a picture of the game's places (a hub, villages, dungeons) with paths between them. The player opens
 * it from the pause menu (or with M) and can travel to the places they may go to. Plain data in `assets/worldmap.json`.
 * Which places exist, where they sit on the map and how they unlock is the designer's choice; whether the player has
 * been somewhere is remembered in the variable `visited:<scene>`, which loading a scene sets.
 */

/** The map is drawn on a board this many units wide and tall; places have positions on it. */
export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 600;

export const MAP_ICONS = ['pin', 'town', 'dungeon', 'cave', 'forest', 'tower', 'castle', 'camp', 'harbor'] as const;
export type MapIcon = (typeof MAP_ICONS)[number];

export const MapUnlockSchema = z.discriminatedUnion('kind', [
  /** Once the player has been there. */
  z.object({ kind: z.literal('visited') }),
  /** From the start. */
  z.object({ kind: z.literal('always') }),
  /** When a flag or counter reaches a number. */
  z.object({ kind: z.literal('variable'), name: z.string().default(''), atLeast: z.number().default(1) }),
  /** When the player has lit a lantern post there (they arrive at it). */
  z.object({ kind: z.literal('lantern') }),
]);
export type MapUnlock = z.infer<typeof MapUnlockSchema>;

export const MapNodeSchema = z.object({
  id: z.string().min(1).regex(/^[A-Za-z0-9_-]+$/, 'Place ids use letters, numbers, - and _'),
  label: z.string().min(1),
  /** The scene file this place is (e.g. "scenes/cave.scene.json"). */
  scene: z.string().default(''),
  x: z.number().min(0).max(MAP_WIDTH).default(MAP_WIDTH / 2),
  y: z.number().min(0).max(MAP_HEIGHT).default(MAP_HEIGHT / 2),
  icon: z.enum(MAP_ICONS).default('pin'),
  unlock: MapUnlockSchema.default({ kind: 'visited' }),
  /** Where to appear: an object's name or "x,y" ('' = the scene's player start). */
  spawn: z.string().default(''),
  /** Not drawn at all until the player can travel there. */
  hidden: z.boolean().default(false),
});
export type MapNode = z.infer<typeof MapNodeSchema>;

export const WorldMapSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  title: z.string().default('Map'),
  nodes: z.array(MapNodeSchema).default([]),
  /** Paths between places, by place id. */
  links: z.array(z.object({ a: z.string(), b: z.string() })).default([]),
});
export type WorldMapData = z.infer<typeof WorldMapSchema>;

export function newWorldMap(): WorldMapData {
  return WorldMapSchema.parse({});
}

export function newMapNode(id: string, label: string, scene = ''): MapNode {
  return MapNodeSchema.parse({ id, label, scene });
}

export const visitedKey = (scene: string): string => `visited:${scene}`;

export function hasVisited(vars: Record<string, VariableValue>, scene: string): boolean {
  return vars[visitedKey(scene)] === true;
}

export type MapPlaceState =
  /** Not drawn. */
  | 'hidden'
  /** Drawn as a "?" (the player knows something is there, not how to get there). */
  | 'locked'
  /** The player is standing in it. */
  | 'here'
  /** The player can travel there. */
  | 'open';

/** Whether a place's unlock rule is met. `lit(scene)` says whether a lantern post is lit in that scene. */
export function isUnlocked(node: MapNode, vars: Record<string, VariableValue>, lit: (scene: string) => boolean): boolean {
  const u = node.unlock;
  switch (u.kind) {
    case 'always':
      return true;
    case 'visited':
      return hasVisited(vars, node.scene);
    case 'lantern':
      return lit(node.scene);
    case 'variable': {
      const v = vars[u.name];
      const n = typeof v === 'number' ? v : v === true ? 1 : Number(v);
      return Number.isFinite(n) && n >= u.atLeast;
    }
  }
}

export function placeState(node: MapNode, vars: Record<string, VariableValue>, currentScene: string, lit: (scene: string) => boolean): MapPlaceState {
  if (node.scene !== '' && node.scene === currentScene) return 'here';
  if (isUnlocked(node, vars, lit)) return 'open';
  return node.hidden ? 'hidden' : 'locked';
}

/** The place the arrow keys lead to from `from`: the nearest one in that direction (null if there is none). */
export function neighbourInDirection(nodes: readonly Pick<MapNode, 'id' | 'x' | 'y'>[], from: string, dir: 'left' | 'right' | 'up' | 'down'): string | null {
  const a = nodes.find((n) => n.id === from);
  if (!a) return nodes[0]?.id ?? null;
  const vec = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir] as [number, number];
  let best: { id: string; score: number } | null = null;
  for (const n of nodes) {
    if (n.id === from) continue;
    const dx = n.x - a.x;
    const dy = n.y - a.y;
    const along = dx * vec[0] + dy * vec[1];
    if (along <= 1) continue;
    const across = Math.abs(dx * vec[1] - dy * vec[0]);
    const score = along + across * 1.5; // straight ahead beats off to the side
    if (!best || score < best.score) best = { id: n.id, score };
  }
  return best?.id ?? null;
}

/** Problems with the map, in plain English. `scenes` are the project's scene files. */
export function checkWorldMap(m: WorldMapData, scenes: readonly string[]): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const n of m.nodes) {
    if (ids.has(n.id)) out.push(`Two places on the map share the id "${n.id}".`);
    ids.add(n.id);
    if (n.scene === '') out.push(`The place "${n.label}" is not linked to a scene, so the player cannot travel there.`);
    else if (!scenes.includes(n.scene)) out.push(`The place "${n.label}" leads to the scene "${n.scene}", which is not part of this project.`);
    if (n.unlock.kind === 'variable' && n.unlock.name === '') out.push(`The place "${n.label}" unlocks with a variable but none is named.`);
  }
  const sceneCount = new Map<string, number>();
  for (const n of m.nodes) if (n.scene) sceneCount.set(n.scene, (sceneCount.get(n.scene) ?? 0) + 1);
  for (const [scene, count] of sceneCount) if (count > 1) out.push(`${count} places on the map lead to the same scene "${scene}".`);
  for (const l of m.links) {
    if (!ids.has(l.a) || !ids.has(l.b)) out.push('A path on the map joins a place that does not exist.');
    else if (l.a === l.b) out.push('A path on the map joins a place to itself.');
  }
  if (m.nodes.length > 1) {
    const linked = new Set(m.links.flatMap((l) => [l.a, l.b]));
    for (const n of m.nodes) if (!linked.has(n.id)) out.push(`The place "${n.label}" has no path to any other place (it floats on its own on the map).`);
  }
  for (const s of scenes) if (m.nodes.length > 0 && !m.nodes.some((n) => n.scene === s)) out.push(`The scene "${s}" is not on the map, so the player cannot travel to it from the map.`);
  return out;
}
