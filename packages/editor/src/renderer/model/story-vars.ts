import '../../bundled';
import type { CutsceneData, DialogueData, EntityData, PrefabData, PrefabNode, TableData } from '@tilewright/runtime';

/**
 * Variables that conversations and cutscenes set. A conversation can set "accepted" and an event row can check it, even though
 * no row sets it, so the sheet checker must not call it "never set".
 */
export function storyVariables(dialogues: ReadonlyMap<string, DialogueData>, cutscenes: ReadonlyMap<string, CutsceneData>): Set<string> {
  const out = new Set<string>();
  for (const d of dialogues.values()) for (const n of d.nodes) if (n.type === 'set' && n.variable) out.add(n.variable);
  for (const c of cutscenes.values()) for (const s of c.steps) if (s.type === 'setVariable' && s.name) out.add(s.name);
  return out;
}

/** "wood:2, stone:1" -> ["wood", "stone"]. */
const resourceNames = (text: unknown): string[] =>
  typeof text === 'string'
    ? text
        .split(',')
        .map((p) => p.split(':')[0]!.trim())
        .filter(Boolean)
    : [];

const fromComponents = (components: Record<string, unknown>, out: Set<string>): void => {
  const p = components.producer as { makes?: string; uses?: string } | undefined;
  if (p) for (const n of [...resourceNames(p.makes), ...resourceNames(p.uses)]) out.add(n);
  const pickup = components.pickup as { variable?: string } | undefined;
  if (pickup?.variable) out.add(pickup.variable);
};

const fromNode = (node: PrefabNode, out: Set<string>): void => {
  fromComponents(node.components, out);
  for (const c of node.children) fromNode(c, out);
};

/**
 * Variables that things in the game make by themselves: resources that Producers make and use, what a pickup adds, and what a
 * table's "makes" column gives (villagers' activities). Rows may check them without setting them.
 */
export function madeVariables(entities: Iterable<Pick<EntityData, 'components'>>, prefabs: Iterable<PrefabData>, tables: Iterable<TableData>): Set<string> {
  const out = new Set<string>();
  for (const e of entities) fromComponents(e.components, out);
  for (const p of prefabs) fromNode(p.root, out);
  for (const t of tables) if (t.columns.some((c) => c.id === 'makes')) for (const r of t.rows) for (const n of resourceNames(r.makes)) out.add(n);
  return out;
}
