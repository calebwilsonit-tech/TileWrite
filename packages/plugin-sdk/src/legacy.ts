/**
 * Names that used to be part of the engine itself and now live with the plugin that owns them. They stay reachable from the plugin SDK
 * so a plugin written against an older version keeps compiling and loading (the plugin platform only grows). New code imports them from
 * the plugin that owns them; the lines below say which. Each of those parts imports only the engine's own packages, so nothing here
 * can loop back into the SDK.
 */

// lighting: the model of lights and shadows and the questions asked of it (@tilewright/plugin-lighting/model)
export * from '@tilewright/plugin-lighting/model';
