import { C, behaviorDef, definePlugin, type TransformIso } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };

/**
 * Room camera: the picture holds still on one object instead of following the player, at a zoom the object chooses.
 * Put it on a marker in the middle of a room and the whole room is one still picture, however the player walks about in it.
 * It uses the same two settings of the view a cutscene's "move the camera" step uses, so nothing else in the engine changes;
 * while a cutscene directs the camera, the cutscene wins (it runs later in the tick).
 */
export interface RoomCamera {
  /** How much bigger than life the room is drawn (1 = as the editor shows it). */
  zoom: number;
  /** Off: the camera goes back to following the player. */
  on: boolean;
}

export const roomCamera = behaviorDef<RoomCamera>({
  id: 'roomCamera',
  name: 'Room Camera',
  category: 'Control schemes',
  description: 'The camera holds still on this object (at its height) instead of following the player, at the zoom you choose. Put it on a marker in the middle of a room for a game where each room is one picture.',
  phase: 'actuator',
  defaults: { zoom: 1.5, on: true },
  fields: [
    { key: 'zoom', label: 'Zoom', type: 'number', min: 0.25, max: 4, step: 0.05 },
    { key: 'on', label: 'Hold the camera here', type: 'boolean' },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  summary: (s) => (s.on ? `Holds the camera here at ${s.zoom} times.` : 'Switched off: the camera follows the player.'),
  update(ctx, e, s) {
    const view = ctx.runtime.view;
    const mine = ctx.runtime.scratch.get('roomCamera.owner') === e.id;
    if (!s.on) {
      // let go only of a camera this object was holding
      if (mine) {
        view.cameraTarget = null;
        view.cameraZoom = null;
        ctx.runtime.scratch.delete('roomCamera.owner');
      }
      return;
    }
    const t = e.require<TransformIso>(C.Transform);
    // the view's target is a point on the ground (height 0); looking at something `h` levels up is looking at the ground half that many cells nearer the top of the picture
    view.cameraTarget = { x: t.x - t.h / 2, y: t.y - t.h / 2 };
    view.cameraZoom = s.zoom;
    ctx.runtime.scratch.set('roomCamera.owner', e.id);
  },
});

export const roomCameraPlugin = definePlugin(manifest, {
  install(api) {
    api.assistantNote('Room camera: the Room Camera behaviour on a marker in the middle of a room holds the picture still there at a chosen zoom, instead of following the player.');
    api.behaviors(roomCamera);
  },
});
