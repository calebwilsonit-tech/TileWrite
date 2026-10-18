import { useSyncExternalStore } from 'react';

/** The library can change from several panels (Library, Hub); every panel that shows it listens here and reloads. */
let tick = 0;
const listeners = new Set<() => void>();

export const libraryChanged = (): void => {
  tick++;
  for (const l of listeners) l();
};

export const useLibraryTick = (): number =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => tick,
  );
