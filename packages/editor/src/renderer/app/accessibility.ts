import { PALETTE, setColourBlindSafe } from '../viewport/palette';

/** Settings that make the editor easier to see and use; remembered with the other app settings. */
export interface Accessibility {
  /** Everything in the window (menus, panels, the map) is drawn this many times bigger. */
  zoom: number;
  /** Overlays use colours that stay apart for red-green and blue-yellow colour blindness. */
  colourBlind: boolean;
  /** No pulsing or sliding in the editor's own interface. */
  reduceMotion: boolean;
}

export const ZOOMS = [1, 1.25, 1.5, 1.75, 2];
export const DEFAULT_ACCESSIBILITY: Accessibility = { zoom: 1, colourBlind: false, reduceMotion: false };

export function cleanAccessibility(raw: unknown): Accessibility {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const zoom = typeof r.zoom === 'number' && ZOOMS.includes(r.zoom) ? r.zoom : DEFAULT_ACCESSIBILITY.zoom;
  return { zoom, colourBlind: r.colourBlind === true, reduceMotion: r.reduceMotion === true };
}

export function applyAccessibility(a: Accessibility): void {
  (window.tilewright as unknown as { ui?: { setZoom(factor: number): void } }).ui?.setZoom(a.zoom);
  document.documentElement.classList.toggle('reduce-motion', a.reduceMotion);
  setColourBlindSafe(a.colourBlind);
  (window as unknown as { __palette?: typeof PALETTE }).__palette = PALETTE; // for the end-to-end tests
  document.dispatchEvent(new CustomEvent('tw:palette'));
  void import('./commands').then((m) => m.viewportRef.current?.requestRedraw());
}
