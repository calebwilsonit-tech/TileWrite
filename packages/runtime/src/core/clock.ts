/**
 * The scene clock: how game time passes. Real-time and turn-based are equal citizens.
 * - `realtime`: the world moves every tick (at 1x, 2x, 4x or 8x speed).
 * - `paused`: nothing moves (the interface still works).
 * - `turns`: behaviours that move things by themselves stop (patrols, chases, projectiles); whoever's turn it is acts, and
 *   the turn system (see turns.ts) decides when the next unit goes.
 * The clock is part of the saved, replayable state.
 */

export type ClockMode = 'realtime' | 'paused' | 'turns';

export const CLOCK_SPEEDS = [1, 2, 4, 8] as const;

export interface SceneClock {
  mode: ClockMode;
  /** How many simulation ticks the game host runs for each real tick (1, 2, 4 or 8). */
  speed: number;
  /** Ticks that have passed while the world was moving (never while paused, in a turn-based phase, or while a conversation was open). */
  elapsed: number;
}

export const newClock = (): SceneClock => ({ mode: 'realtime', speed: 1, elapsed: 0 });

export function setClockMode(clock: SceneClock, mode: ClockMode): void {
  clock.mode = mode;
}

/** The nearest allowed speed (anything below 1 is 1, above 8 is 8). */
export function setClockSpeed(clock: SceneClock, speed: number): void {
  clock.speed = CLOCK_SPEEDS.reduce((best, s) => (Math.abs(s - speed) < Math.abs(best - speed) ? s : best), 1 as number);
}

/** Game seconds that have passed at the clock's pace. */
export const clockSeconds = (clock: SceneClock): number => clock.elapsed / 60;

/**
 * A day/night style cycle read off the clock: `dayLength` game seconds per day. Returns the day number (from 0), and the hour
 * (0-24, noon is 12) with `startHour` as the hour the game begins at.
 */
export function timeOfDay(clock: SceneClock, dayLength: number, startHour = 8): { day: number; hour: number; fraction: number } {
  const days = clockSeconds(clock) / Math.max(1, dayLength) + startHour / 24;
  return { day: Math.floor(days), hour: (days % 1) * 24, fraction: days % 1 };
}
