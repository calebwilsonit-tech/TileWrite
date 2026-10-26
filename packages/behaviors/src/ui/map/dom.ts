import type { Simulation } from '@tilewright/runtime';
import type { ViewNode } from '../screens-logic';

/** The map widget's drawing and pointer handling (filled in by the map work). */
export function applyMap(_sim: Simulation, _current: Map<string, ViewNode>, _elOf: (key: string) => HTMLElement | undefined, _design: boolean): void {
  /* later */
}
export function drawMaps(_sim: Simulation, _current: Map<string, ViewNode>, _elOf: (key: string) => HTMLElement | undefined): void {
  /* later */
}
export function wireMap(_sim: Simulation, _key: string, _el: HTMLElement, _first: ViewNode, _get: () => ViewNode | undefined, _design: () => boolean): void {
  /* later */
}
