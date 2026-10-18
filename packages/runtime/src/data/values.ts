import type { VariableValue } from '../project/schema';
import type { World } from '../scene/world';
import { readCell, type Tables } from './tables';

/**
 * One way to name a piece of game data, used by event sheets, behaviours, the logic graph and the UI's bindings:
 * - `coins`, `item:key`, `visited:...`: a flag or counter (a variable);
 * - `Units.knight.hp`: a cell of a data table (table, row, column);
 * - `@Player.health.hp`: a field of a component of the first object with that name;
 * - `self.speed` and `row.cost`: the settings of the custom behaviour being run, and the row a table loop is on (these are
 *   ordinary variables that exist while that logic runs).
 */
export interface ValueSource {
  vars: Record<string, VariableValue>;
  tables: Tables;
  world: World;
}

/** The value of a name, or undefined when nothing by that name exists. */
export function resolveValue(src: ValueSource, name: string): VariableValue | undefined {
  const direct = src.vars[name];
  if (direct !== undefined) return direct;
  if (name.startsWith('@')) return entityField(src.world, name.slice(1));
  if (name.includes('.')) return readCell(src.tables, name);
  return undefined;
}

/** `Player.health.hp` -> that field of the first object called Player. */
export function entityField(world: World, path: string): VariableValue | undefined {
  const [entity, component, ...rest] = path.split('.');
  if (!entity || !component) return undefined;
  const e = world.all().find((x) => x.name === entity);
  let v: unknown = e?.get(component);
  for (const key of rest) {
    if (v === null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[key];
  }
  return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' ? v : undefined;
}

/** Put `{name}` in a text as the value of that variable, table cell or object field; unknown names are left as written. */
export function fillValues(text: string, src: ValueSource): string {
  let out = text;
  // names may be built from other names ({Units.{self.unit}.hp}): fill the innermost first, a few times over
  for (let pass = 0; pass < 4 && out.includes('{'); pass++) {
    const next = out.replace(/\{([^{}]+)\}/g, (m, name: string) => {
      const v = resolveValue(src, name.trim());
      if (v === undefined) return m;
      return typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
    });
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Every name a text refers to (for the checker and the binding picker). */
export function namesIn(text: string): string[] {
  return [...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]!.trim());
}
