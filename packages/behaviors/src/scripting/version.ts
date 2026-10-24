/**
 * The version of the scripting API (api.ts), in semver terms. Scripts are the owner's own code, so the API is public:
 * names are only ever added (a minor version), never removed or renamed; a name that is replaced stays as an alias that says
 * what to use instead (a deprecation warning in the console); only a new major version may break a script.
 *
 * 1.0.0  the API as it was when scripts were first written
 * 1.1.0  gravity (`game.gravity`, `me.gravity`) and blocks (`game.setBlock`, `game.breakBlock`, `game.blockAt`)
 * 1.2.0  collision layers by name (`game.layer`), the ones plugins add included
 */
export const SCRIPT_API_VERSION = '1.2.0';
