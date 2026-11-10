import { describe, expect, it } from 'vitest';
import { flatScene, player, rig, thing, usePlugin } from '@tilewright/plugin-sdk/testing';
import { roomCameraPlugin, type RoomCamera } from './index';

describe('room camera', () => {
  it('holds the view on its object at its zoom, and lets go when switched off', () => {
    const t = usePlugin(roomCameraPlugin);
    const { scene } = flatScene();
    const marker = thing('m', 'Middle', 6, 4, { roomCamera: { zoom: 2 } });
    (marker.components.transform as { h: number }).h = 2;
    scene.entities.push(player('p', 1.5, 1.5), marker);
    const r = rig(scene);
    r.run(2);
    // a point two levels up is drawn where the ground one cell nearer the top of the picture is
    expect(r.sim.runtime.view.cameraTarget).toEqual({ x: 5, y: 3 });
    expect(r.sim.runtime.view.cameraZoom).toBe(2);
    r.get('m').require<RoomCamera>('roomCamera').on = false;
    r.run(2);
    expect(r.sim.runtime.view.cameraTarget).toBeNull();
    expect(r.sim.runtime.view.cameraZoom).toBeNull();
    t.off();
  });

  it('does not let go of a camera something else is holding', () => {
    const t = usePlugin(roomCameraPlugin);
    const { scene } = flatScene();
    scene.entities.push(player('p', 1.5, 1.5), thing('m', 'Middle', 6, 4, { roomCamera: { zoom: 2, on: false } }));
    const r = rig(scene);
    r.sim.runtime.view.cameraTarget = { x: 9, y: 9 }; // a cutscene, say
    r.sim.runtime.view.cameraZoom = 1.5;
    r.run(2);
    expect(r.sim.runtime.view.cameraTarget).toEqual({ x: 9, y: 9 });
    expect(r.sim.runtime.view.cameraZoom).toBe(1.5);
    t.off();
  });
});
