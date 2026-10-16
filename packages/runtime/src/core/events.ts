export interface GameEvent {
  type: string;
  [key: string]: unknown;
}

export type EventHandler = (event: GameEvent) => void;

/**
 * Synchronous event bus plus a log of the current tick's events.
 * Handlers run immediately inside `emit`, so they must be deterministic like systems.
 * The log is cleared when the next tick begins, so tests and the debugger can inspect what just happened.
 */
export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private log: GameEvent[] = [];

  emit(type: string, data: Record<string, unknown> = {}): GameEvent {
    const event: GameEvent = { ...data, type };
    this.log.push(event);
    for (const h of [...(this.handlers.get(type) ?? [])]) h(event);
    for (const h of [...(this.handlers.get('*') ?? [])]) h(event);
    return event;
  }

  /** Subscribe to an event type ('*' for all). Returns an unsubscribe function. */
  on(type: string, handler: EventHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  beginTick(): void {
    this.log = [];
  }

  /** Events emitted so far this tick (or during the last tick, between ticks). */
  get recent(): readonly GameEvent[] {
    return this.log;
  }

  of(type: string): GameEvent[] {
    return this.log.filter((e) => e.type === type);
  }
}
