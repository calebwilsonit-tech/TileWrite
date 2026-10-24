import { useSyncExternalStore } from 'react';
import { host } from '@tilewright/behaviors';

let version = 0;
host.onChange(() => version++);

/** A number that changes whenever a plugin is turned on or off, or fails: a component that reads what plugins added reads this first. */
export function usePlugins(): number {
  return useSyncExternalStore(
    (notify) => host.onChange(notify),
    () => version,
  );
}
