import { MAP_HEIGHT, MAP_WIDTH, newMapNode, newWorldMap, type MapNode, type WorldMapData } from '@tilewright/runtime';

/** Edits of the world map as pure functions (each returns a new map). */

/** A readable name for a scene file: "scenes/dark-cave.scene.json" becomes "Dark cave". */
export function sceneLabel(path: string): string {
  const base = path.replace(/^.*\//, '').replace(/\.scene\.json$/, '').replace(/[-_]+/g, ' ').trim();
  return base ? base[0]!.toUpperCase() + base.slice(1) : 'Place';
}

const idFor = (label: string): string => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'place';

export function freshPlaceId(m: WorldMapData, label: string): string {
  const base = idFor(label);
  let id = base;
  for (let n = 2; m.nodes.some((x) => x.id === id); n++) id = `${base}-${n}`;
  return id;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * A first map from a project's scenes: the first scene is the hub in the middle, the others sit round it on a ring and
 * are joined to it. The player can always travel to the hub; the others open once they have been visited.
 */
export function mapFromScenes(scenes: readonly string[], startScene = scenes[0] ?? ''): WorldMapData {
  let m = newWorldMap();
  const ordered = [startScene, ...scenes.filter((s) => s !== startScene)].filter((s, i, a) => s !== '' && a.indexOf(s) === i);
  ordered.forEach((scene, i) => {
    const label = sceneLabel(scene);
    const id = freshPlaceId(m, label);
    const node = newMapNode(id, label, scene);
    if (i === 0) {
      node.x = MAP_WIDTH / 2;
      node.y = MAP_HEIGHT / 2;
      node.icon = 'town';
      node.unlock = { kind: 'always' };
    } else {
      const angle = ((i - 1) / Math.max(1, ordered.length - 1)) * Math.PI * 2 - Math.PI / 2;
      node.x = Math.round(MAP_WIDTH / 2 + Math.cos(angle) * 330);
      node.y = Math.round(MAP_HEIGHT / 2 + Math.sin(angle) * 210);
      node.icon = 'dungeon';
    }
    m = { ...m, nodes: [...m.nodes, node] };
    if (i > 0) m = { ...m, links: [...m.links, { a: m.nodes[0]!.id, b: id }] };
  });
  return m;
}

export function addPlace(m: WorldMapData, scene: string, label = sceneLabel(scene)): { map: WorldMapData; id: string } {
  const id = freshPlaceId(m, label);
  const node = newMapNode(id, label, scene);
  // new places appear in an empty-ish spot, not on top of the last one
  const n = m.nodes.length;
  node.x = clamp(120 + (n * 170) % (MAP_WIDTH - 240), 40, MAP_WIDTH - 40);
  node.y = clamp(110 + Math.floor((n * 170) / (MAP_WIDTH - 240)) * 130, 40, MAP_HEIGHT - 60);
  return { map: { ...m, nodes: [...m.nodes, node] }, id };
}

export function updatePlace(m: WorldMapData, id: string, patch: Partial<MapNode>): WorldMapData {
  return { ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

/** Move a place, snapped to a 10-unit grid and kept on the board. */
export function movePlace(m: WorldMapData, id: string, x: number, y: number, snap = 10): WorldMapData {
  return updatePlace(m, id, { x: clamp(Math.round(x / snap) * snap, 0, MAP_WIDTH), y: clamp(Math.round(y / snap) * snap, 0, MAP_HEIGHT) });
}

/** Give a place a new id everywhere it is used (its paths follow). Returns the map unchanged when the id is taken or not valid. */
export function renamePlaceId(m: WorldMapData, id: string, to: string): WorldMapData {
  if (!/^[A-Za-z0-9_-]+$/.test(to) || (to !== id && m.nodes.some((n) => n.id === to))) return m;
  return { ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, id: to } : n)), links: m.links.map((l) => ({ a: l.a === id ? to : l.a, b: l.b === id ? to : l.b })) };
}

export function removePlace(m: WorldMapData, id: string): WorldMapData {
  return { ...m, nodes: m.nodes.filter((n) => n.id !== id), links: m.links.filter((l) => l.a !== id && l.b !== id) };
}

export const hasLink = (m: WorldMapData, a: string, b: string): boolean => m.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

export function addLink(m: WorldMapData, a: string, b: string): WorldMapData {
  if (a === b || hasLink(m, a, b) || !m.nodes.some((n) => n.id === a) || !m.nodes.some((n) => n.id === b)) return m;
  return { ...m, links: [...m.links, { a, b }] };
}

export function removeLink(m: WorldMapData, a: string, b: string): WorldMapData {
  return { ...m, links: m.links.filter((l) => !((l.a === a && l.b === b) || (l.a === b && l.b === a))) };
}

/** The places a place is joined to. */
export function neighboursOf(m: WorldMapData, id: string): string[] {
  return m.links.flatMap((l) => (l.a === id ? [l.b] : l.b === id ? [l.a] : []));
}
