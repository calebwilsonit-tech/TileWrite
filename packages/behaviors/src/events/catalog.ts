/**
 * The events the event sheet can react to. The core announces a few (things landing, blocks changing, crates pushed); the plugins
 * add the ones of their own kind of game through `api.event()`, and the pickers show exactly the events of the plugins that are on.
 */

export interface EventEntry {
  id: string;
  /** In the "something happens in the game" picker: "something is hurt". */
  label: string;
  /** How a row reads: defaults to the label. */
  text?: string;
  /** In the "something happens to an object" picker: "is hurt". Left out when the event is not about one object. */
  entityLabel?: string;
  /** How a row reads when it is about one object: defaults to the entity label. */
  entityText?: string;
}

const CORE: EventEntry[] = [
  { id: 'pushed', label: 'a crate is pushed' },
  { id: 'landed', label: 'something lands', entityLabel: 'lands' },
  { id: 'gravity-changed', label: 'gravity turns for something', entityLabel: 'feels gravity turn' },
  { id: 'block-placed', label: 'a block is placed' },
  { id: 'block-broken', label: 'a block is broken' },
  { id: 'fell', label: 'something falls into a pit' },
  { id: 'floor-fell', label: 'a floor crumbles' },
  { id: 'spawned', label: 'something is created' },
  { id: 'anim-event', label: 'an animation event fires' },
  { id: 'portal', label: 'the player walks through a portal' },
];

/** The choices of the two pickers. These are live lists: plugins add to them and take from them when they are turned on and off. */
export const EVENT_OPTIONS: { value: string; label: string }[] = [];
export const ENTITY_EVENT_OPTIONS: { value: string; label: string }[] = [];

const known = new Map<string, EventEntry>();

function rebuild(): void {
  EVENT_OPTIONS.length = 0;
  ENTITY_EVENT_OPTIONS.length = 0;
  for (const e of known.values()) {
    EVENT_OPTIONS.push({ value: e.id, label: e.label });
    if (e.entityLabel) ENTITY_EVENT_OPTIONS.push({ value: e.id, label: e.entityLabel });
  }
}

export function addEventEntry(e: EventEntry): void {
  known.set(e.id, e);
  rebuild();
}

export function removeEventEntry(id: string): void {
  if (CORE.some((c) => c.id === id)) return;
  known.delete(id);
  rebuild();
}

/** A row about "something happens in the game", in words. */
export const eventText = (id: string): string => known.get(id)?.text ?? known.get(id)?.label ?? `"${id}" happens`;

/** A row about one object, in words ("is hurt"). */
export const entityEventText = (id: string): string => known.get(id)?.entityText ?? known.get(id)?.entityLabel ?? id;

for (const e of CORE) known.set(e.id, e);
rebuild();
