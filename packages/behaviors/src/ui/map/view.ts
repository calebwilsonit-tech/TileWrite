import type { MapSpec } from '@tilewright/runtime';
import type { FogDraw } from './fog';
import type { RegionDraw } from './layers';
import type { MapMarker } from './markers';
import type { MapRun } from './state';
import type { MapView, MapWorld, Projection } from './world';

/** What the drawing of a layer needs besides its settings (worked out by the logic; the screen only paints it). */
export type LayerData =
  | { kind: 'terrain'; colours: Uint32Array; w: number; h: number }
  | { kind: 'regions'; items: RegionDraw[]; style: string; lineWidth: number }
  | { kind: 'paths'; segs: { x1: number; y1: number; x2: number; y2: number }[]; colour: string; dash: string; lineWidth: number }
  | { kind: 'fog'; draw: FogDraw }
  | { kind: 'labels'; items: { text: string; x: number; y: number }[]; colour: string; size: number }
  | { kind: 'none' };

export interface LayerPlan {
  id: string;
  kind: string;
  index: number;
  opacity: number;
  blend: string;
  /** Shown now: its condition holds and the zoom is in its range. */
  visible: boolean;
  settings: Record<string, unknown>;
  data: LayerData;
  /** Changes when the layer has to be painted again. */
  sig: string;
}

/** The state of a Map widget, as the logic has worked it out for this frame. */
export interface MapInfo {
  id: string;
  spec: MapSpec;
  world: MapWorld;
  proj: Projection;
  view: MapView;
  /** The zoom the player and the actions set (1 = the whole world in the window when the map fits). */
  zoom: number;
  layers: LayerPlan[];
  markers: MapMarker[];
  highlight: string;
  hover: { x: number; y: number } | null;
  run: MapRun;
}
