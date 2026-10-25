import { host, placeState, type ListSourceDef, type MapNode, type MapPlaceState, type Simulation, type VariableValue } from '@tilewright/plugin-sdk';

/**
 * What the kit's screens list besides what the engine lists: the waypoints a traveller can reach, the slots of the paper doll, the
 * stats under it, and the chapters of the story. They are list sources (`api.listSource`), so a screen uses them like the engine's
 * own: `source: "parchment-waypoints"`.
 */

/** Places on the map nearer than this to the one the player is in (map units; the board is 1000 wide) are not worth a journey: they are left out. */
export const MIN_TRAVEL = 70;

export interface Waypoint {
  node: MapNode;
  state: MapPlaceState;
  /** Map units from the place the player is in (0 when the player is in none). */
  distance: number;
}

/** The place the player is in, if the world map has one for this scene. */
export function placeHere(sim: Simulation): MapNode | undefined {
  const scene = sim.runtime.scene;
  return scene === '' ? undefined : sim.assets.worldMap?.nodes.find((n) => n.scene === scene);
}

/** Every place of the map with what the player knows of it, nearest-first from the place the player is in. */
export function placesWithState(sim: Simulation): Waypoint[] {
  const map = sim.assets.worldMap;
  if (!map) return [];
  const custom = (kind: string, node: MapNode): boolean => host.ext.unlockRules.get(kind)?.met(sim.runtime.vars, node) ?? false;
  const here = placeHere(sim);
  return map.nodes
    .map((node) => ({ node, state: placeState(node, sim.runtime.vars, sim.runtime.scene, custom), distance: here ? Math.hypot(node.x - here.x, node.y - here.y) : 0 }))
    .sort((a, b) => a.distance - b.distance);
}

/** The places a traveller can go: found, open, not the one the player is in, and far enough to be worth the journey. */
export function waypoints(sim: Simulation): Waypoint[] {
  return placesWithState(sim).filter((p) => p.state === 'open' && (p.distance === 0 || p.distance >= MIN_TRAVEL));
}

export const waypointsSource: ListSourceDef = {
  id: 'parchment-waypoints',
  label: 'the places the player can travel to, leaving out the one they are in and those too close to be worth a journey',
  fields: { 'place.id': 'Place id', 'place.name': 'Its name', 'place.scene': 'Its scene', 'place.distance': 'How far from here on the map (0 when nowhere)', 'place.hint': 'A line about it ("an hour from here")' },
  rows(sim) {
    const t = sim.assets.strings;
    return waypoints(sim).map((w) => ({
      id: w.node.id,
      scope: {
        'place.id': w.node.id,
        'place.name': t.t(w.node.label),
        'place.scene': w.node.scene,
        'place.distance': Math.round(w.distance),
        'place.hint': w.distance === 0 ? '' : w.distance > 400 ? t.t('a long way') : w.distance > 200 ? t.t('a good walk') : t.t('not far'),
      },
    }));
  },
};

/** The slots of the paper doll. An item puts its name in the slot by setting a variable called `equip_<slot>` (an item's "use" can do that). */
export const SLOTS: { id: string; label: string }[] = [
  { id: 'head', label: 'Head' },
  { id: 'body', label: 'Body' },
  { id: 'hands', label: 'Hands' },
  { id: 'feet', label: 'Feet' },
  { id: 'weapon', label: 'Weapon' },
  { id: 'charm', label: 'Charm' },
];

export const equipmentSource: ListSourceDef = {
  id: 'parchment-equipment',
  label: 'the slots of the paper doll: head, body, hands, feet, weapon and charm, with what is in each (the variable equip_<slot>)',
  fields: { 'slot.id': 'Slot id', 'slot.label': 'Its name', 'slot.item': 'What is in it (or a dash)', 'slot.full': 'Is anything in it (1 or 0)' },
  rows(sim) {
    const t = sim.assets.strings;
    return SLOTS.map((s) => {
      const v = sim.runtime.vars[`equip_${s.id}`];
      const has = v !== undefined && v !== '' && v !== false && v !== 0;
      return { id: s.id, scope: { 'slot.id': s.id, 'slot.label': t.t(s.label), 'slot.item': has ? t.t(String(v)) : '-', 'slot.full': has ? 1 : 0 } };
    });
  },
};

const titleCase = (s: string): string => s.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** The stats under the paper doll: the player's health, and every variable called `stat_<name>` (`stat_attack` is "Attack"). */
export const statsSource: ListSourceDef = {
  id: 'parchment-stats',
  label: 'the paper doll’s stats: the player’s health, and every variable called stat_<name>',
  fields: { 'stat.name': 'The stat’s name', 'stat.value': 'Its value' },
  rows(sim) {
    const t = sim.assets.strings;
    const rows: { id: string; scope: Record<string, VariableValue> }[] = [];
    const player = sim.world.withTag('player')[0];
    const hp = player?.get<{ hp?: number }>('state:health')?.hp;
    const max = player?.get<{ max?: number }>('health')?.max;
    if (typeof hp === 'number') rows.push({ id: 'health', scope: { 'stat.name': t.t('Health'), 'stat.value': typeof max === 'number' ? `${Math.ceil(hp)} / ${max}` : Math.ceil(hp) } });
    for (const [k, v] of Object.entries(sim.runtime.vars).sort(([a], [b]) => a.localeCompare(b))) {
      if (!k.startsWith('stat_') || typeof v === 'boolean') continue;
      rows.push({ id: k, scope: { 'stat.name': t.t(titleCase(k.slice(5))), 'stat.value': v } });
    }
    return rows;
  },
};

/** The chapters of the story that the player has reached: the rows of a table called Chapters (a `name` column), up to the number in the variable `chapter`. */
export const chaptersSource: ListSourceDef = {
  id: 'parchment-chapters',
  label: 'the chapters the player has reached (rows of a table called Chapters, up to the variable chapter)',
  fields: { 'chapter.name': 'The chapter’s name', 'chapter.number': 'Its number', 'chapter.current': 'Is it the one the story is in (1 or 0)' },
  rows(sim) {
    const table = sim.assets.tables.get('Chapters');
    if (!table) return [];
    const now = typeof sim.runtime.vars.chapter === 'number' ? sim.runtime.vars.chapter : 1;
    const t = sim.assets.strings;
    return table.rows
      .map((r, i) => ({ id: String(r.id ?? i + 1), n: i + 1, name: String((r as Record<string, unknown>).name ?? r.id ?? `Chapter ${i + 1}`) }))
      .filter((c) => c.n <= now)
      .map((c) => ({ id: c.id, scope: { 'chapter.name': t.t(c.name), 'chapter.number': c.n, 'chapter.current': c.n === now ? 1 : 0 } }));
  },
};

/** The name of the region of the scene the player is standing in ('' when in none). */
export function regionName(sim: Simulation): string {
  const player = sim.world.withTag('player')[0];
  const at = player?.get<{ x: number; y: number }>('transform');
  if (!at) return '';
  const r = sim.runtime.regions.find((g) => at.x >= g.x && at.x < g.x + g.w && at.y >= g.y && at.y < g.y + g.h);
  return r ? sim.assets.strings.t(r.name) : '';
}
