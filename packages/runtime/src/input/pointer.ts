import { DEFAULT_ISO, gridToScreen, type ViewRotation } from '../iso/math';
import type { InputState, InputMapDef } from './input';

/**
 * The mouse (or a finger) as game input. It goes through the same action path as buttons, so recordings, replays and the
 * playbot treat a click like any other press: the game host works out which cell is under the pointer and puts it in the
 * snapshot, and the simulation only ever reads the snapshot.
 *
 * Cells are stored plus one (0 means "not over the world", for example over a menu), so cell 0 is not lost.
 */
export const POINTER_BINDINGS: InputMapDef = {
  pointer_primary: ['ptr:left'],
  pointer_secondary: ['ptr:right'],
  pointer_middle: ['ptr:middle'],
  pointer_cx: ['ptr:cx'],
  pointer_cy: ['ptr:cy'],
  /** Position in the game picture, in pixels, plus one. */
  pointer_sx: ['ptr:sx'],
  pointer_sy: ['ptr:sy'],
  /** Where the camera looks and how big the picture is, so the simulation can say where things are on screen (box selection). */
  pointer_camx: ['ptr:camx'],
  pointer_camy: ['ptr:camy'],
  pointer_zoom: ['ptr:zoom'],
  pointer_vw: ['ptr:vw'],
  pointer_vh: ['ptr:vh'],
  pointer_wheel_up: ['ptr:wheelUp'],
  pointer_wheel_down: ['ptr:wheelDown'],
  /** Held with a click: add to a selection, queue a command. */
  modifier_shift: ['key:ShiftLeft', 'key:ShiftRight'],
  modifier_ctrl: ['key:ControlLeft', 'key:ControlRight'],
};

export const POINTER_ACTIONS = Object.keys(POINTER_BINDINGS);

export interface CameraReading {
  x: number;
  y: number;
  zoom: number;
  w: number;
  h: number;
}

const CAM_OFFSET = 100000;

export interface PointerReading {
  /** The cell under the pointer, or null when it is not over the world. */
  cell: { x: number; y: number } | null;
  /** Where it is in the picture (pixels). */
  screen: { x: number; y: number };
  /** The pointer is over the game's picture (not outside the window or over something else). */
  inside: boolean;
  primary: { down: boolean; pressed: boolean; released: boolean };
  secondary: { down: boolean; pressed: boolean; released: boolean };
  wheel: number;
  /** The camera: the point of the picture in the middle (in projection pixels), its zoom and the picture's size. Null when the host did not say. */
  camera: CameraReading | null;
  /** Any of shift, alt, control held (queue a command, add to a selection). */
  shift: boolean;
}

/** What the pointer is doing this tick. */
export function readPointer(input: InputState): PointerReading {
  const cx = input.value('pointer_cx');
  const cy = input.value('pointer_cy');
  return {
    cell: cx > 0 && cy > 0 ? { x: cx - 1, y: cy - 1 } : null,
    screen: { x: Math.max(0, input.value('pointer_sx') - 1), y: Math.max(0, input.value('pointer_sy') - 1) },
    inside: input.value('pointer_sx') > 0 && input.value('pointer_sy') > 0,
    primary: { down: input.down('pointer_primary'), pressed: input.pressed('pointer_primary'), released: input.released('pointer_primary') },
    secondary: { down: input.down('pointer_secondary'), pressed: input.pressed('pointer_secondary'), released: input.released('pointer_secondary') },
    wheel: (input.pressed('pointer_wheel_up') ? 1 : 0) - (input.pressed('pointer_wheel_down') ? 1 : 0),
    camera: input.value('pointer_vw') > 0 ? { x: input.value('pointer_camx') - CAM_OFFSET, y: input.value('pointer_camy') - CAM_OFFSET, zoom: input.value('pointer_zoom') / 1000, w: input.value('pointer_vw'), h: input.value('pointer_vh') } : null,
    shift: input.down('modifier_shift'),
  };
}

/** The snapshot values that describe a camera (what the game host sends every tick). */
export function cameraSnapshot(c: CameraReading): Record<string, number> {
  return { pointer_camx: Math.round(c.x) + CAM_OFFSET, pointer_camy: Math.round(c.y) + CAM_OFFSET, pointer_zoom: Math.round(c.zoom * 1000), pointer_vw: Math.round(c.w), pointer_vh: Math.round(c.h) };
}

/** Where a place in the world is in the picture, in pixels, for this camera and view (the same maths the renderer uses). */
export function pictureOf(cam: CameraReading, view: ViewRotation, map: { width: number; height: number } | null, x: number, y: number, h: number): { x: number; y: number } {
  const p = gridToScreen(x, y, h, { ...DEFAULT_ISO, view, mapW: map?.width ?? 0, mapH: map?.height ?? 0 });
  return { x: (p.x - cam.x) * cam.zoom + cam.w / 2, y: (p.y - cam.y) * cam.zoom + cam.h / 2 };
}

/** The snapshot values for a pointer over a cell (what the playbot and tests press). */
export function pointerSnapshot(cell: { x: number; y: number } | null, buttons: { primary?: boolean; secondary?: boolean; shift?: boolean; screen?: { x: number; y: number } } = {}): Record<string, number> {
  const out: Record<string, number> = {};
  if (cell) {
    out.pointer_cx = cell.x + 1;
    out.pointer_cy = cell.y + 1;
  }
  if (buttons.screen) {
    out.pointer_sx = Math.round(buttons.screen.x) + 1;
    out.pointer_sy = Math.round(buttons.screen.y) + 1;
  }
  if (buttons.primary) out.pointer_primary = 1;
  if (buttons.secondary) out.pointer_secondary = 1;
  if (buttons.shift) out.modifier_shift = 1;
  return out;
}
