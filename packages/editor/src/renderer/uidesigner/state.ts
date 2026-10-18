import { useSyncExternalStore } from 'react';
import type { UiDoc, VariableValue } from '@tilewright/runtime';
import { store } from '../app/store';

export const RESOLUTIONS: { id: string; label: string; w: number; h: number }[] = [
  { id: '16:9', label: '16:9 widescreen (1280 x 720)', w: 1280, h: 720 },
  { id: '16:10', label: '16:10 (1280 x 800)', w: 1280, h: 800 },
  { id: '21:9', label: '21:9 ultrawide (1680 x 720)', w: 1680, h: 720 },
  { id: '4:3', label: '4:3 (960 x 720)', w: 960, h: 720 },
  { id: 'phone', label: 'Phone, sideways (844 x 390)', w: 844, h: 390 },
];

export interface DesignerState {
  screenId: string | null;
  /** The UI prefab being designed instead of a screen. */
  prefab: string | null;
  selected: string | null;
  resolution: string;
  mode: 'layout' | 'focus' | 'flow';
  showSafe: boolean;
  /** Made-up values for the names the screen reads, so the preview shows something real. */
  preview: Record<string, VariableValue>;
  past: UiDoc[];
  future: UiDoc[];
}

let state: DesignerState = { screenId: null, prefab: null, selected: null, resolution: '16:9', mode: 'layout', showSafe: false, preview: {}, past: [], future: [] };
const listeners = new Set<() => void>();

const emit = (): void => listeners.forEach((l) => l());

export const designer = {
  get state(): DesignerState {
    return state;
  },
  set(patch: Partial<DesignerState>): void {
    state = { ...state, ...patch };
    emit();
  },
  /** Change the document; one undo step. */
  edit(next: UiDoc): void {
    if (next === store.uiDoc || JSON.stringify(next) === JSON.stringify(store.uiDoc)) return;
    state = { ...state, past: [...state.past, store.uiDoc].slice(-100), future: [] };
    store.setUiDoc(next);
    emit();
  },
  /** Change the document while a drag is going on: no undo step yet. */
  live(next: UiDoc): void {
    store.setUiDoc(next);
  },
  /** The drag is over: the document before it becomes one undo step. */
  commit(before: UiDoc): void {
    if (JSON.stringify(before) === JSON.stringify(store.uiDoc)) return;
    state = { ...state, past: [...state.past, before].slice(-100), future: [] };
    emit();
  },
  undo(): void {
    const prev = state.past[state.past.length - 1];
    if (!prev) return;
    state = { ...state, past: state.past.slice(0, -1), future: [store.uiDoc, ...state.future] };
    store.setUiDoc(prev);
    emit();
  },
  redo(): void {
    const next = state.future[0];
    if (!next) return;
    state = { ...state, past: [...state.past, store.uiDoc], future: state.future.slice(1) };
    store.setUiDoc(next);
    emit();
  },
  reset(): void {
    state = { ...state, screenId: null, prefab: null, selected: null, past: [], future: [] };
    emit();
  },
};

export function useDesigner<T>(selector: (s: DesignerState) => T): T {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => selector(state),
  );
}
