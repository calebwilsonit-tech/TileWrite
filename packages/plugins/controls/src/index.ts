import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };
import { events } from './events';
import { actions, conditions } from './blocks';
import { builder, cameraRig, clickToMove, commandable, gridCursor, hotspot, rtsControl } from './controls';

export * from './controls';

/** The ways a person can play: point and click, a grid cursor, RTS selection, a free camera, placing buildings. */
export const controlsPlugin = definePlugin(manifest, {
  install(api) {
    for (const e of events) api.event(e);
    api.behaviors(clickToMove, hotspot, gridCursor, commandable, rtsControl, cameraRig, builder);
    api.conditions(...conditions);
    api.actions(...actions);
    api.inputAction('camera_rotate_left', { label: 'Turn the world left', bindings: ['key:KeyQ', 'key:BracketLeft'] });
    api.inputAction('camera_rotate_right', { label: 'Turn the world right', bindings: ['key:KeyE', 'key:BracketRight'] });
    api.inputAction('build_rotate', { label: 'Turn the building', bindings: ['key:KeyR'] });
    api.inputAction('build_cancel', { label: 'Put the building away', bindings: ['key:Escape'] });
    api.inputAction('rts_stop', { label: 'Stop the selected units', bindings: ['key:KeyS'] });
    api.inputAction('rts_attack_move', { label: 'Attack-move (hold, then right-click)', bindings: ['key:KeyA'] });
  },
});
